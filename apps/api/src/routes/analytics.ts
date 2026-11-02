import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { z } from 'zod';
import { USAGE_CATEGORIES } from '@mas/shared';
import { ah, objectId, parse } from './util';
import {
  BatchGenerationModel,
  EpisodeModel,
  GenerationJobModel,
  MusicTrackModel,
  StorySourceModel,
  UsageRecordModel,
  VideoAssetModel,
} from '../models';
import { AppError, notFound } from '../lib/errors';
import { budgetStatus } from '../services/cost/budget';
import { storage, keys } from '../storage';
import { probe } from '../services/video/ffmpeg';
import { updateSettings } from '../services/settings';

export const analyticsRouter = Router();
export const dashboardRouter = Router();
export const musicRouter = Router();
export const brandingRouter = Router();

const emptyCats = () => Object.fromEntries(USAGE_CATEGORIES.map((c) => [c, 0])) as Record<string, number>;

analyticsRouter.get(
  '/summary',
  ah(async (req, res) => {
    const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
    // A bare date (YYYY-MM-DD) for `to` means "through the end of that day".
    const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? new Date(q.to.getTime() + 86_400_000 - 1) : (q.to ?? new Date());
    const from = q.from ?? new Date(to.getTime() - 30 * 86_400_000);
    const match = { createdAt: { $gte: from, $lte: to } };
    const [byCat, daily, byModel, budget, store] = await Promise.all([
      UsageRecordModel.aggregate([{ $match: match }, { $group: { _id: '$category', cost: { $sum: '$cost' } } }]),
      UsageRecordModel.aggregate([
        { $match: match },
        { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, c: '$category' }, cost: { $sum: '$cost' } } },
        { $sort: { '_id.d': 1 } },
      ]),
      UsageRecordModel.aggregate([
        { $match: match },
        { $group: { _id: { p: '$provider', m: '$model', c: '$category', u: '$unit' }, cost: { $sum: '$cost' }, quantity: { $sum: '$quantity' }, calls: { $sum: 1 } } },
        { $sort: { cost: -1 } },
      ]),
      budgetStatus(),
      storage().usage(),
    ]);
    const totals = emptyCats();
    byCat.forEach((c) => (totals[c._id] = c.cost));
    const days = new Map<string, Record<string, number>>();
    for (const d of daily) {
      const row = days.get(d._id.d) ?? emptyCats();
      row[d._id.c] = d.cost;
      days.set(d._id.d, row);
    }
    res.json({
      range: { from, to },
      totals: { byCategory: totals, total: Object.values(totals).reduce((a, b) => a + b, 0) },
      daily: [...days.entries()].map(([date, byCategory]) => ({ date, byCategory, total: Object.values(byCategory).reduce((a, b) => a + b, 0) })),
      byModel: byModel.map((m) => ({ provider: m._id.p, model: m._id.m, category: m._id.c, unit: m._id.u, cost: m.cost, quantity: m.quantity, calls: m.calls })),
      budget: { dailyLimit: budget.dailyLimit, monthlyLimit: budget.monthlyLimit, maxCostPerEpisode: budget.maxCostPerEpisode, spentToday: budget.spentToday, spentThisMonth: budget.spentThisMonth },
      storage: store,
    });
  }),
);

analyticsRouter.get(
  '/episodes',
  ah(async (_req, res) => {
    const rows = await UsageRecordModel.aggregate([
      { $match: { episodeId: { $ne: null } } },
      { $group: { _id: { e: '$episodeId', c: '$category' }, cost: { $sum: '$cost' } } },
    ]);
    const ids = [...new Set(rows.map((r) => String(r._id.e)))];
    const eps = await EpisodeModel.find({ _id: { $in: ids } }).select('episodeNumber title').lean();
    const items = eps
      .map((e) => {
        const byCategory = emptyCats();
        rows.filter((r) => String(r._id.e) === String(e._id)).forEach((r) => (byCategory[r._id.c] = r.cost));
        return { episodeId: e._id, episodeNumber: e.episodeNumber, title: e.title, byCategory, cost: Object.values(byCategory).reduce((a, b) => a + b, 0) };
      })
      .sort((a, b) => a.episodeNumber - b.episodeNumber);
    res.json({ items });
  }),
);

analyticsRouter.get(
  '/batches',
  ah(async (_req, res) => {
    const batches = await BatchGenerationModel.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      items: batches.map((b) => ({ batchId: b._id, name: b.name, createdAt: b.createdAt, status: b.status, estimated: (b.estimate as { total?: number })?.total ?? 0, actual: b.actualCost, videos: b.videoIds.length })),
    });
  }),
);

dashboardRouter.get(
  '/',
  ah(async (_req, res) => {
    const [sources, epStatus, vidStatus, active, failed, budget, recentVideos, recentJobs] = await Promise.all([
      StorySourceModel.countDocuments(),
      EpisodeModel.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      VideoAssetModel.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      GenerationJobModel.countDocuments({ status: { $in: ['queued', 'running'] } }),
      GenerationJobModel.countDocuments({ status: 'failed' }),
      budgetStatus(),
      VideoAssetModel.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(6).lean(),
      GenerationJobModel.find().select({ payload: 0, logs: { $slice: -1 } }).sort({ updatedAt: -1 }).limit(8).lean(),
    ]);
    const toMap = (rows: { _id: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
    const epBy = toMap(epStatus);
    const vBy = toMap(vidStatus);
    res.json({
      sources,
      episodes: { total: Object.values(epBy).reduce((a, b) => a + b, 0), byStatus: epBy },
      videos: { total: Object.values(vBy).reduce((a, b) => a + b, 0), byStatus: vBy },
      jobs: { active, failed },
      spend: { today: budget.spentToday, month: budget.spentThisMonth, dailyLimit: budget.dailyLimit, monthlyLimit: budget.monthlyLimit },
      recentVideos,
      recentJobs,
    });
  }),
);

// ------------------------------------------------------------------ music library (user-supplied, licensed)

const audioUpload = multer({
  dest: path.join(os.tmpdir(), 'mas-music'),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => cb(null, /^audio\//.test(f.mimetype) || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.originalname)),
});

musicRouter.get(
  '/',
  ah(async (_req, res) => {
    res.json({ items: await MusicTrackModel.find().sort({ createdAt: -1 }).lean() });
  }),
);

musicRouter.post(
  '/',
  audioUpload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new AppError('Audio file required (field "file")', 400, 'NO_FILE');
    try {
      const body = parse(
        z.object({
          title: z.string().min(1).max(120),
          mood: z.string().max(120).default(''),
          license: z.string().min(2).max(500),
          licenseUrl: z.string().url().max(500).optional().or(z.literal('')),
          attribution: z.string().max(500).optional(),
          kind: z.enum(['music', 'sfx']).default('music'),
          commercialUseConfirmed: z.enum(['true']).transform(() => true),
        }),
        req.body,
      );
      const info = await probe(req.file.path).catch(() => null);
      if (!info?.hasAudio) throw new AppError('File is not a readable audio file', 422, 'INVALID_AUDIO');
      const track = new MusicTrackModel({ ...body, duration: info.duration, filePath: 'pending' });
      track.filePath = keys.music(String(track._id), path.extname(req.file.originalname).toLowerCase() || '.mp3');
      await storage().putFile(track.filePath, req.file.path, { move: true });
      await track.save();
      res.status(201).json(track);
    } finally {
      await fsp.rm(req.file.path, { force: true });
    }
  }),
);

musicRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const t = await MusicTrackModel.findByIdAndDelete(objectId(req.params.id!));
    if (!t) throw notFound('Track');
    await storage().delete(t.filePath);
    res.status(204).end();
  }),
);

// ------------------------------------------------------------------ channel branding

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, f, cb) => cb(null, /^image\/(png|webp)$/.test(f.mimetype)) });

brandingRouter.post(
  '/logo',
  logoUpload.single('logo'),
  ah(async (req, res) => {
    if (!req.file) throw new AppError('PNG or WebP logo required (field "logo"; transparent background recommended)', 400, 'NO_FILE');
    const key = keys.branding(`logo-${Date.now()}${req.file.mimetype === 'image/webp' ? '.webp' : '.png'}`);
    await storage().put(key, req.file.buffer);
    res.json({ settings: await updateSettings('render', { logoKey: key }), url: `/api/files/${key}` });
  }),
);

brandingRouter.delete(
  '/logo',
  ah(async (_req, res) => {
    res.json({ settings: await updateSettings('render', { logoKey: '' }) });
  }),
);
