import { Router } from 'express';
import { z } from 'zod';
import type { FilterQuery } from 'mongoose';
import { EPISODE_STATUSES, NARRATION_STYLES, VIDEO_STATUSES } from '@mas/shared';
import { ah, objectId, parse } from './util';
import { EpisodeModel, GenerationJobModel, ScriptVersionModel, VideoAssetModel, type Episode } from '../models';
import { AppError, notFound } from '../lib/errors';
import { editScript, enqueueHinglishJob, requestRegeneration, setEpisodeStatus } from '../services/story/scripts';

export const episodesRouter = Router();

episodesRouter.get(
  '/narration-styles',
  ah(async (_req, res) => {
    res.json({ styles: NARRATION_STYLES });
  }),
);

const listSchema = z.object({
  sourceId: z.string().optional(),
  search: z.string().max(200).optional(),
  character: z.string().optional(),
  style: z.string().optional(),
  status: z.union([z.enum(EPISODE_STATUSES), z.array(z.enum(EPISODE_STATUSES))]).optional(),
  videoStatus: z.union([z.enum(VIDEO_STATUSES), z.literal('none')]).optional(),
  sort: z.enum(['episodeNumber', '-episodeNumber', 'updatedAt', '-updatedAt', 'title']).default('episodeNumber'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

episodesRouter.get(
  '/episodes',
  ah(async (req, res) => {
    const q = parse(listSchema, req.query);
    const filter: FilterQuery<Episode> = {};
    if (q.sourceId) filter.sourceId = objectId(q.sourceId);
    if (q.character) filter.characters = q.character;
    if (q.style) filter.narrationStyle = q.style;
    if (q.status) filter.status = Array.isArray(q.status) ? { $in: q.status } : q.status;
    if (q.videoStatus) filter.videoStatus = q.videoStatus;
    if (q.search) {
      const n = Number(q.search);
      const rx = new RegExp(escapeRegex(q.search), 'i');
      filter.$or = [{ title: rx }, { summary: rx }, { narrationText: rx }, { characters: rx }, ...(Number.isInteger(n) ? [{ episodeNumber: n }] : [])];
    }
    const sortField = q.sort.replace('-', '');
    const sort = { [sortField]: q.sort.startsWith('-') ? -1 : 1 } as Record<string, 1 | -1>;
    const [items, total] = await Promise.all([
      EpisodeModel.find(filter)
        .select('episodeNumber title titleHinglish hinglishVersion slug summary characters narrationStyle styleOverride status videoStatus estimatedDuration actualAudioDuration currentVersion quality.overall quality.passed updatedAt createdAt sourceId')
        .sort(sort)
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      EpisodeModel.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

episodesRouter.get(
  '/episodes/facets',
  ah(async (req, res) => {
    const match = req.query.sourceId ? { sourceId: objectId(String(req.query.sourceId)) } : {};
    const [characters, styles, statuses, videoStatuses] = await Promise.all([
      EpisodeModel.aggregate([{ $match: match }, { $unwind: '$characters' }, { $group: { _id: '$characters', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 300 }]),
      EpisodeModel.aggregate([{ $match: match }, { $group: { _id: '$narrationStyle', n: { $sum: 1 } } }]),
      EpisodeModel.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      EpisodeModel.aggregate([{ $match: match }, { $group: { _id: '$videoStatus', n: { $sum: 1 } } }]),
    ]);
    res.json({
      characters: characters.map((c) => ({ name: c._id, count: c.n })),
      styles: styles.filter((s) => s._id).map((s) => ({ id: s._id, count: s.n })),
      statuses: Object.fromEntries(statuses.map((s) => [s._id, s.n])),
      videoStatuses: Object.fromEntries(videoStatuses.map((s) => [s._id, s.n])),
    });
  }),
);

episodesRouter.get(
  '/episodes/:id',
  ah(async (req, res) => {
    const ep = await EpisodeModel.findById(objectId(req.params.id!)).lean();
    if (!ep) throw notFound('Episode');
    const [prev, next, versions, videos, jobs] = await Promise.all([
      ep.previousEpisodeId ? EpisodeModel.findById(ep.previousEpisodeId).select('episodeNumber title summary status nextEpisodeTeaser').lean() : null,
      ep.nextEpisodeId ? EpisodeModel.findById(ep.nextEpisodeId).select('episodeNumber title summary status hook').lean() : null,
      ScriptVersionModel.find({ episodeId: ep._id }).select('version createdBy changeNote createdAt quality.overall estimatedDuration contentHash').sort({ version: -1 }).lean(),
      VideoAssetModel.find({ episodeId: ep._id, deletedAt: null }).select('version status scriptVersion duration thumbnailPath videoPath createdAt').sort({ version: -1 }).lean(),
      GenerationJobModel.find({ episodeId: ep._id, queue: 'script' }).select('-payload').sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    res.json({ episode: ep, previous: prev, next, versions, videos, jobs });
  }),
);

episodesRouter.get(
  '/episodes/:id/versions/:version',
  ah(async (req, res) => {
    const v = await ScriptVersionModel.findOne({ episodeId: objectId(req.params.id!), version: Number(req.params.version) }).lean();
    if (!v) throw notFound('Script version');
    res.json(v);
  }),
);

const sceneSchema = z.object({
  sceneNumber: z.number().int(),
  narrationExcerpt: z.string(),
  visual: z.string(),
  characters: z.array(z.string()),
  environment: z.string(),
  emotion: z.string(),
});

episodesRouter.patch(
  '/episodes/:id',
  ah(async (req, res) => {
    const body = parse(
      z
        .object({
          title: z.string().min(1).max(200),
          summary: z.string().max(2000),
          hook: z.string().max(1000),
          narrationText: z.string().min(1).max(5000),
          ending: z.string().max(1000),
          nextEpisodeTeaser: z.string().max(1000),
          sceneDescriptions: z.array(sceneSchema).max(12),
          characters: z.array(z.string()).max(40),
          styleOverride: z.string().nullable(),
          changeNote: z.string().max(300),
        })
        .partial()
        .strict(),
      req.body,
    );
    res.json(await editScript(String(objectId(req.params.id!)), body));
  }),
);

episodesRouter.post(
  '/episodes/:id/:action(approve|lock|unlock|unapprove)',
  ah(async (req, res) => {
    res.json(await setEpisodeStatus(String(objectId(req.params.id!)), req.params.action as 'approve'));
  }),
);

episodesRouter.post(
  '/episodes/:id/regenerate',
  ah(async (req, res) => {
    const body = parse(z.object({ confirmProtected: z.boolean().optional(), instructions: z.string().max(2000).optional() }), req.body ?? {});
    res.status(202).json(await requestRegeneration(String(objectId(req.params.id!)), body));
  }),
);

/** (Re)creates the Hinglish reading copy for the current script version. */
episodesRouter.post(
  '/episodes/:id/hinglish',
  ah(async (req, res) => {
    const ep = await EpisodeModel.findById(objectId(req.params.id!)).select('currentVersion').lean();
    if (!ep) throw notFound('Episode');
    if (!ep.currentVersion) throw new AppError('Episode has no script yet', 409, 'CONFLICT');
    res.status(202).json(await enqueueHinglishJob(String(ep._id), ep.currentVersion, true));
  }),
);

episodesRouter.post(
  '/episodes/bulk',
  ah(async (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string()).min(1).max(1000), action: z.enum(['approve', 'lock', 'unlock', 'unapprove']) }), req.body);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of body.ids) {
      try {
        await setEpisodeStatus(String(objectId(id)), body.action);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    res.json({ results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  }),
);

episodesRouter.post(
  '/episodes/export',
  ah(async (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string()).min(1).max(2000), format: z.enum(['json', 'csv', 'txt']).default('json') }), req.body);
    const eps = await EpisodeModel.find({ _id: { $in: body.ids.map((i) => objectId(i)) } })
      .sort({ episodeNumber: 1 })
      .select('-__v')
      .lean();
    const stamp = new Date().toISOString().slice(0, 10);
    if (body.format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="mahabharat-episodes-${stamp}.json"`);
      res.json(eps);
      return;
    }
    if (body.format === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mahabharat-episodes-${stamp}.txt"`);
      res.send(
        eps
          .map(
            (e) =>
              `एपिसोड ${e.episodeNumber}: ${e.title}${e.titleHinglish ? ` (${e.titleHinglish})` : ''}\n[${e.narrationStyle} · ~${e.estimatedDuration}s · ${e.status}]\n\n${e.narrationText}${
                e.narrationHinglish ? `\n\n[Hinglish]\n${e.narrationHinglish}` : ''
              }\n\nस्रोत: ${e.sourceReferences.map((r) => `pp. ${r.pageStart}-${r.pageEnd}`).join(', ')}`,
          )
          .join('\n\n────────────────────────\n\n'),
      );
      return;
    }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['episodeNumber', 'title', 'titleHinglish', 'status', 'narrationStyle', 'characters', 'estimatedDuration', 'actualAudioDuration', 'hook', 'narrationText', 'narrationHinglish', 'nextEpisodeTeaser', 'sourcePages'];
    const rows = eps.map((e) =>
      [e.episodeNumber, e.title, e.titleHinglish, e.status, e.narrationStyle, e.characters.join('; '), e.estimatedDuration, e.actualAudioDuration ?? '', e.hook, e.narrationText, e.narrationHinglish, e.nextEpisodeTeaser, e.sourceReferences.map((r) => `${r.pageStart}-${r.pageEnd}`).join('; ')]
        .map(esc)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mahabharat-episodes-${stamp}.csv"`);
    res.send('﻿' + [header.join(','), ...rows].join('\n'));
  }),
);
