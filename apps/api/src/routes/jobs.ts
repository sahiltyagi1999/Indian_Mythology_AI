import { Router } from 'express';
import { z } from 'zod';
import { JOB_STATUSES, QUEUE_NAMES } from '@mas/shared';
import { ah, objectId, parse } from './util';
import { GenerationJobModel } from '../models';
import { notFound } from '../lib/errors';
import { cancelJob, retryJob } from '../services/jobs';
import { queueHealth } from '../queues';

export const jobsRouter = Router();

jobsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        status: z.union([z.enum(JOB_STATUSES), z.array(z.enum(JOB_STATUSES))]).optional(),
        queue: z.enum(Object.keys(QUEUE_NAMES) as [string, ...string[]]).optional(),
        batchId: z.string().optional(),
        videoId: z.string().optional(),
        episodeId: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = Array.isArray(q.status) ? { $in: q.status } : q.status;
    if (q.queue) filter.queue = q.queue;
    if (q.batchId) filter.batchId = objectId(q.batchId);
    if (q.videoId) filter.videoId = objectId(q.videoId);
    if (q.episodeId) filter.episodeId = objectId(q.episodeId);
    const [items, total, counts] = await Promise.all([
      GenerationJobModel.find(filter)
        .select({ payload: 0, logs: { $slice: -3 } })
        .sort({ updatedAt: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      GenerationJobModel.countDocuments(filter),
      GenerationJobModel.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) });
  }),
);

jobsRouter.get(
  '/health',
  ah(async (_req, res) => {
    res.json(await queueHealth());
  }),
);

jobsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const j = await GenerationJobModel.findById(objectId(req.params.id!)).lean();
    if (!j) throw notFound('Job');
    res.json(j);
  }),
);

jobsRouter.post(
  '/:id/cancel',
  ah(async (req, res) => {
    res.json(await cancelJob(String(objectId(req.params.id!))));
  }),
);

jobsRouter.post(
  '/:id/retry',
  ah(async (req, res) => {
    res.status(202).json(await retryJob(String(objectId(req.params.id!))));
  }),
);
