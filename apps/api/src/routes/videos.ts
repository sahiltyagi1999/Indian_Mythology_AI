import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { VIDEO_STATUSES, VISUAL_STYLE_IDS, type VideoGenerationSettings } from '@mas/shared';
import { ah, objectId, parse } from './util';
import { BatchGenerationModel, EpisodeModel, GenerationJobModel, VideoAssetModel, VideoSceneModel } from '../models';
import { AppError, conflict, notFound } from '../lib/errors';
import { estimateBatch } from '../services/cost/estimator';
import {
  confirmBudget,
  createVideoAsset,
  deleteVideo,
  regenerateVideo,
  resolveVideoSettings,
  resumeVideo,
  retryScene,
  scheduleBatch,
  uploadSceneClip,
} from '../services/video/pipeline';
import { cancelJob } from '../services/jobs';

export const videosRouter = Router();
export const batchesRouter = Router();

const clipDir = path.join(env.STORAGE_DIR, '.uploads');
fs.mkdirSync(clipDir, { recursive: true });
const clipUpload = multer({
  dest: clipDir,
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^(video|image)\//.test(file.mimetype) || /\.(mp4|mov|webm|m4v|jpe?g|png|webp)$/i.test(file.originalname)),
});

const subtitleSchema = z
  .object({
    font: z.string().max(80),
    fontSize: z.number().min(24).max(120),
    textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    highlightColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    backgroundOpacity: z.number().min(0).max(1),
    positionFromBottom: z.number().min(0.12).max(0.6),
    animation: z.enum(['none', 'pop', 'karaoke', 'fade']),
  })
  .partial();

export const settingsSchema = z
  .object({
    voiceId: z.string().max(100),
    ttsModel: z.string().max(100),
    narrationStyleOverride: z.string().max(60).optional(),
    visualStyle: z.enum(VISUAL_STYLE_IDS as [string, ...string[]]),
    resolution: z.enum(['720p', '1080p']),
    videoProvider: z.string().max(60),
    videoModel: z.string().max(100),
    musicTrackId: z.string().max(40).optional(),
    musicVolume: z.number().min(0).max(1),
    sfxIntensity: z.number().min(0).max(1),
    subtitles: subtitleSchema,
    logoPath: z.string().max(300).optional(),
  })
  .partial();

// ------------------------------------------------------------------ videos

videosRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(VIDEO_STATUSES).optional(),
        episodeId: z.string().optional(),
        batchId: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(48),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = { deletedAt: null };
    if (q.status) filter.status = q.status;
    if (q.episodeId) filter.episodeId = objectId(q.episodeId);
    if (q.batchId) filter.batchId = objectId(q.batchId);
    const [items, total] = await Promise.all([
      VideoAssetModel.find(filter).select('-renderLog').sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
      VideoAssetModel.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

videosRouter.get(
  '/:id',
  ah(async (req, res) => {
    const video = await VideoAssetModel.findById(objectId(req.params.id!)).lean();
    if (!video) throw notFound('Video');
    const [scenes, jobs] = await Promise.all([
      VideoSceneModel.find({ videoId: video._id }).sort({ sceneNumber: 1 }).lean(),
      GenerationJobModel.find({ videoId: video._id }).select({ payload: 0, logs: { $slice: -5 } }).sort({ createdAt: 1 }).lean(),
    ]);
    res.json({ video, scenes, jobs });
  }),
);

videosRouter.post(
  '/:id/regenerate',
  ah(async (req, res) => {
    const body = parse(z.object({ reuseScenes: z.boolean().default(true), settings: settingsSchema.optional() }), req.body ?? {});
    res.status(201).json({ video: await regenerateVideo(String(objectId(req.params.id!)), { reuseScenes: body.reuseScenes, settings: body.settings as Partial<VideoGenerationSettings> }) });
  }),
);

videosRouter.delete(
  '/:id',
  ah(async (req, res) => {
    await deleteVideo(String(objectId(req.params.id!)));
    res.status(204).end();
  }),
);

videosRouter.post(
  '/:id/scenes/:n/retry',
  ah(async (req, res) => {
    res.status(202).json({ job: await retryScene(String(objectId(req.params.id!)), Number(req.params.n)) });
  }),
);

/** Upload a user-made clip or still image for one scene (field "file"). */
videosRouter.post(
  '/:id/scenes/:n/clip',
  clipUpload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new AppError('A video clip or image is required (field "file")', 400, 'NO_FILE');
    try {
      res.json({ scene: await uploadSceneClip(String(objectId(req.params.id!)), Number(req.params.n), { path: req.file.path, originalName: req.file.originalname, mimeType: req.file.mimetype }) });
    } finally {
      await fsp.rm(req.file.path, { force: true });
    }
  }),
);

videosRouter.post(
  '/:id/resume',
  ah(async (req, res) => {
    res.status(202).json({ video: await resumeVideo(String(objectId(req.params.id!))) });
  }),
);

videosRouter.post(
  '/:id/confirm-budget',
  ah(async (req, res) => {
    res.status(202).json({ video: await confirmBudget(String(objectId(req.params.id!))) });
  }),
);

// ------------------------------------------------------------------ batches

const batchBody = z.object({
  episodeIds: z.array(z.string()).min(1).max(500),
  settings: settingsSchema.default({}),
  maxConcurrency: z.number().int().min(1).max(10).default(2),
});

batchesRouter.post(
  '/estimate',
  ah(async (req, res) => {
    const body = parse(batchBody, req.body);
    const settings = await resolveVideoSettings(body.settings as Partial<VideoGenerationSettings>);
    res.json(await estimateBatch(body.episodeIds.map((id) => String(objectId(id))), settings));
  }),
);

/**
 * Starts a batch. Requires `confirm: true` (explicit user confirmation of the shown estimate);
 * if the estimate exceeds a budget, also `acknowledgeBudget: true`. Idempotent by `idempotencyKey`.
 */
batchesRouter.post(
  '/',
  ah(async (req, res) => {
    const body = parse(
      batchBody.extend({
        name: z.string().max(120).optional(),
        confirm: z.literal(true, { errorMap: () => ({ message: 'Explicit confirmation is required to start paid generation' }) }),
        acknowledgeBudget: z.boolean().default(false),
        idempotencyKey: z.string().min(8).max(100).default(() => crypto.randomUUID()),
      }),
      req.body,
    );
    const existing = await BatchGenerationModel.findOne({ idempotencyKey: body.idempotencyKey }).lean();
    if (existing) {
      res.status(200).json({ batch: existing, videos: await VideoAssetModel.find({ batchId: existing._id }).lean(), duplicate: true });
      return;
    }
    const ids = body.episodeIds.map((id) => objectId(id));
    const eps = await EpisodeModel.find({ _id: { $in: ids } }).select('episodeNumber status').lean();
    const notReady = eps.filter((e) => !['approved', 'locked'].includes(e.status));
    if (notReady.length || eps.length !== ids.length) throw conflict(`Only approved episodes can be produced (not ready: ${notReady.map((e) => e.episodeNumber).join(', ') || 'missing ids'})`);
    const settings = await resolveVideoSettings(body.settings as Partial<VideoGenerationSettings>);
    if (!settings.voiceId) throw new AppError('Select a narrator voice', 422, 'VALIDATION_ERROR');
    const estimate = await estimateBatch(ids.map(String), settings);
    if (estimate.budget.exceeds.length && !body.acknowledgeBudget) {
      throw new AppError('This batch exceeds your budget. Confirm to proceed.', 409, 'BUDGET_CONFIRMATION_REQUIRED', { exceeds: estimate.budget.exceeds, estimate });
    }
    const batch = await BatchGenerationModel.create({
      name: body.name || `Batch ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${ids.length} episode(s)`,
      idempotencyKey: body.idempotencyKey,
      episodeIds: ids,
      settings,
      maxConcurrency: body.maxConcurrency,
      status: 'running',
      estimate,
      budgetOverride: body.acknowledgeBudget,
      confirmedAt: new Date(),
    });
    const sorted = [...eps].sort((a, b) => a.episodeNumber - b.episodeNumber);
    const videos = [];
    for (const ep of sorted) {
      const v = await createVideoAsset(ep._id, settings, { batchId: batch._id, idempotencyKey: `batch:${batch._id}:${ep._id}` });
      if (body.acknowledgeBudget) await VideoAssetModel.updateOne({ _id: v._id }, { $set: { budgetOverride: true } });
      const per = estimate.perEpisode.find((p) => p.episodeId === String(ep._id));
      await VideoAssetModel.updateOne({ _id: v._id }, { $set: { estimatedCost: per?.total ?? 0 } });
      videos.push(v);
    }
    batch.videoIds = videos.map((v) => v._id);
    await batch.save();
    await scheduleBatch(batch._id);
    res.status(201).json({ batch, videos: await VideoAssetModel.find({ batchId: batch._id }).lean() });
  }),
);

batchesRouter.get(
  '/',
  ah(async (_req, res) => {
    const items = await BatchGenerationModel.find().sort({ createdAt: -1 }).limit(100).lean();
    const counts = await VideoAssetModel.aggregate([{ $match: { batchId: { $in: items.map((b) => b._id) } } }, { $group: { _id: { b: '$batchId', s: '$status' }, n: { $sum: 1 } } }]);
    res.json({
      items: items.map((b) => ({ ...b, videoCounts: Object.fromEntries(counts.filter((c) => String(c._id.b) === String(b._id)).map((c) => [c._id.s, c.n])) })),
    });
  }),
);

batchesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const batch = await BatchGenerationModel.findById(objectId(req.params.id!)).lean();
    if (!batch) throw notFound('Batch');
    res.json({ batch, videos: await VideoAssetModel.find({ batchId: batch._id }).sort({ episodeNumber: 1 }).lean() });
  }),
);

batchesRouter.post(
  '/:id/cancel',
  ah(async (req, res) => {
    const batch = await BatchGenerationModel.findById(objectId(req.params.id!));
    if (!batch) throw notFound('Batch');
    batch.status = 'cancelled';
    await batch.save();
    await VideoAssetModel.updateMany({ batchId: batch._id, status: 'queued' }, { $set: { status: 'cancelled', stage: 'cancelled' } });
    const jobs = await GenerationJobModel.find({ batchId: batch._id, status: { $in: ['queued', 'running', 'awaiting_confirmation'] } }).select('_id').lean();
    for (const j of jobs) await cancelJob(String(j._id)).catch(() => undefined);
    res.json({ batch, cancelledJobs: jobs.length });
  }),
);
