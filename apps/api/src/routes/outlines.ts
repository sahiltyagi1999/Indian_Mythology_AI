import { Router } from 'express';
import { z } from 'zod';
import { ah, objectId, parse } from './util';
import { StoryOutlineModel, StorySourceModel } from '../models';
import { conflict, notFound } from '../lib/errors';
import { enqueueJob } from '../services/jobs';
import { materializeEpisodes } from '../services/story/scripts';
import { ERAS } from '../services/story/outline';

export const outlinesRouter = Router();

/** Starts a new outline version for an indexed source. */
outlinesRouter.post(
  '/sources/:id/outlines',
  ah(async (req, res) => {
    const source = await StorySourceModel.findById(objectId(req.params.id!));
    if (!source) throw notFound('Source');
    const fullyIndexed = (source.stats?.chunks ?? 0) > 0 && source.stats?.embeddedChunks === source.stats?.chunks;
    if (!['indexed', 'outlined', 'analyzing'].includes(source.status) && !(source.status === 'failed' && fullyIndexed)) {
      throw conflict('Process and index the PDF before generating an outline');
    }
    const running = await StoryOutlineModel.findOne({ sourceId: source._id, status: 'generating' });
    if (running) {
      const { job } = await enqueueJob({ queue: 'outline', type: 'generate-outline', idempotencyKey: `outline:${running._id}`, sourceId: source._id, payload: { outlineId: String(running._id) } });
      res.status(200).json({ outline: running, job, resumed: true });
      return;
    }
    const last = await StoryOutlineModel.findOne({ sourceId: source._id }).sort({ version: -1 }).select('version').lean();
    const outline = await StoryOutlineModel.create({ sourceId: source._id, version: (last?.version ?? 0) + 1, status: 'generating' });
    const { job } = await enqueueJob({
      queue: 'outline',
      type: 'generate-outline',
      idempotencyKey: `outline:${outline._id}`,
      sourceId: source._id,
      payload: { outlineId: String(outline._id) },
      maxAttempts: 6,
    });
    res.status(202).json({ outline, job });
  }),
);

outlinesRouter.get(
  '/sources/:id/outlines',
  ah(async (req, res) => {
    const items = await StoryOutlineModel.find({ sourceId: objectId(req.params.id!) })
      .select('version status progress segmentsTotal segmentsProcessed approvedAt createdAt updatedAt llmModel')
      .sort({ version: -1 })
      .lean();
    res.json({ items });
  }),
);

outlinesRouter.get(
  '/outlines/eras',
  ah(async (_req, res) => {
    res.json({ eras: ERAS });
  }),
);

outlinesRouter.get(
  '/outlines/:id',
  ah(async (req, res) => {
    const o = await StoryOutlineModel.findById(objectId(req.params.id!)).select('-segments.events -segments.characters').lean();
    if (!o) throw notFound('Outline');
    res.json(o);
  }),
);

outlinesRouter.patch(
  '/outlines/:id/episodes/:n',
  ah(async (req, res) => {
    const body = parse(z.object({ title: z.string().min(1).max(200).optional(), synopsis: z.string().min(1).max(3000).optional() }), req.body);
    const o = await StoryOutlineModel.findById(objectId(req.params.id!));
    if (!o) throw notFound('Outline');
    if (o.status !== 'draft') throw conflict('Only draft outlines can be edited');
    const ep = o.episodes.find((e) => e.episodeNumber === Number(req.params.n));
    if (!ep) throw notFound('Planned episode');
    if (body.title) ep.title = body.title;
    if (body.synopsis) ep.synopsis = body.synopsis;
    await o.save();
    res.json(ep);
  }),
);

outlinesRouter.post(
  '/outlines/:id/approve',
  ah(async (req, res) => {
    const o = await StoryOutlineModel.findById(objectId(req.params.id!));
    if (!o) throw notFound('Outline');
    if (o.status !== 'draft' && o.status !== 'approved') throw conflict(`Outline is ${o.status}`);
    if (!o.episodes.length) throw conflict('Outline has no episodes');
    o.status = 'approved';
    o.approvedAt = new Date();
    await o.save();
    res.json(o);
  }),
);

/** Creates episodes from the approved outline and queues script generation (in chronological order). */
outlinesRouter.post(
  '/outlines/:id/generate-scripts',
  ah(async (req, res) => {
    const body = parse(
      z.object({ from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(2000).optional() }),
      req.body ?? {},
    );
    res.status(202).json(await materializeEpisodes(String(objectId(req.params.id!)), body));
  }),
);
