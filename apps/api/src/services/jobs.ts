import type { Types } from 'mongoose';
import type { QueueKey } from '@mas/shared';
import { GenerationJobModel, type GenerationJobDoc } from '../models';
import { getQueue } from '../queues';
import { conflict, notFound } from '../lib/errors';
import { logger } from '../config/logger';

type Id = string | Types.ObjectId | undefined | null;

export interface EnqueueInput {
  queue: QueueKey;
  type: string;
  /** Unique business key; the same key never produces two concurrent jobs. */
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  sourceId?: Id;
  episodeId?: Id;
  episodeNumber?: number;
  videoId?: Id;
  batchId?: Id;
  sceneNumber?: number;
  estimatedCost?: number;
  maxAttempts?: number;
  priority?: number;
  /** Re-run even if a completed job with this key exists (explicit user request). */
  force?: boolean;
}

const ACTIVE = ['queued', 'running'];

/**
 * Idempotent enqueue. Returns the existing job when one with the same key is queued/running (or completed,
 * unless force). Failed/cancelled jobs are re-armed and re-queued — that is how retry works.
 */
export async function enqueueJob(input: EnqueueInput): Promise<{ job: GenerationJobDoc; created: boolean; requeued: boolean }> {
  const { queue, idempotencyKey, force, priority, ...rest } = input;
  const res = await GenerationJobModel.findOneAndUpdate(
    { idempotencyKey },
    {
      $setOnInsert: {
        queue,
        idempotencyKey,
        type: rest.type,
        payload: rest.payload ?? {},
        sourceId: rest.sourceId ?? undefined,
        episodeId: rest.episodeId ?? undefined,
        episodeNumber: rest.episodeNumber,
        videoId: rest.videoId ?? undefined,
        batchId: rest.batchId ?? undefined,
        sceneNumber: rest.sceneNumber,
        estimatedCost: rest.estimatedCost ?? 0,
        maxAttempts: rest.maxAttempts ?? 5,
        status: 'queued',
      },
    },
    { upsert: true, new: true, includeResultMetadata: true },
  );
  const job = res.value!;
  const created = !res.lastErrorObject?.updatedExisting;

  if (!created) {
    if (ACTIVE.includes(job.status)) return { job, created: false, requeued: false };
    if (job.status === 'completed' && !force) return { job, created: false, requeued: false };
    // Re-arm: failed, cancelled, awaiting_confirmation, or forced re-run of completed.
    const updated = await GenerationJobModel.findOneAndUpdate(
      { _id: job._id, status: { $nin: ACTIVE } },
      {
        $set: { status: 'queued', stage: 'queued', progress: 0, cancelRequested: false, attempts: 0, ...(rest.payload ? { payload: rest.payload } : {}) },
        $unset: { error: 1, finishedAt: 1 },
        $push: { logs: { $each: [{ at: new Date(), level: 'info', message: 'Re-queued' }], $slice: -200 } },
      },
      { new: true },
    );
    if (!updated) return { job, created: false, requeued: false }; // lost a race with another requeue
    await addToBull(updated, priority);
    return { job: updated, created: false, requeued: true };
  }
  await addToBull(job, priority);
  return { job, created: true, requeued: false };
}

async function addToBull(job: GenerationJobDoc, priority?: number) {
  const run = (job.logs?.filter((l) => l.message === 'Re-queued').length ?? 0) + 1;
  const bullJobId = `${job._id}-${run}`;
  await getQueue(job.queue as QueueKey).add(
    job.type,
    { generationJobId: String(job._id) },
    { jobId: bullJobId, attempts: job.maxAttempts, priority },
  );
  await GenerationJobModel.updateOne({ _id: job._id }, { $set: { bullJobId } });
}

export async function cancelJob(id: string) {
  const job = await GenerationJobModel.findById(id);
  if (!job) throw notFound('Job');
  if (!ACTIVE.includes(job.status) && job.status !== 'awaiting_confirmation') throw conflict(`Job is already ${job.status}`);
  job.cancelRequested = true;
  if (job.bullJobId) {
    const bull = await getQueue(job.queue as QueueKey).getJob(job.bullJobId);
    const state = await bull?.getState();
    if (bull && (state === 'waiting' || state === 'delayed' || state === 'prioritized' || state === 'waiting-children')) {
      await bull.remove().catch((e) => logger.warn(e, 'Could not remove bull job'));
      job.status = 'cancelled';
      job.finishedAt = new Date();
    }
  }
  if (job.status === 'awaiting_confirmation') {
    job.status = 'cancelled';
    job.finishedAt = new Date();
  }
  job.logs.push({ at: new Date(), level: 'warn', message: 'Cancellation requested' });
  await job.save();
  return job;
}

export async function retryJob(id: string) {
  const job = await GenerationJobModel.findById(id);
  if (!job) throw notFound('Job');
  if (ACTIVE.includes(job.status)) throw conflict('Job is still active');
  return enqueueJob({ queue: job.queue as QueueKey, type: job.type, idempotencyKey: job.idempotencyKey, force: true });
}

/**
 * Resumption after a restart or Redis loss: any job Mongo believes is queued/running but which BullMQ no
 * longer knows about is re-added. BullMQ itself recovers stalled active jobs.
 */
export async function reconcileJobs() {
  const pending = await GenerationJobModel.find({ status: { $in: ACTIVE } });
  let restored = 0;
  for (const job of pending) {
    const bull = job.bullJobId ? await getQueue(job.queue as QueueKey).getJob(job.bullJobId) : null;
    const state = bull ? await bull.getState() : 'missing';
    if (state === 'missing' || state === 'unknown' || state === 'failed' || state === 'completed') {
      if (state === 'failed' || state === 'completed') {
        // Worker died between BullMQ finishing and Mongo update; trust BullMQ's terminal state on next attempt.
        await bull?.remove().catch(() => undefined);
      }
      await GenerationJobModel.updateOne({ _id: job._id }, { $set: { status: 'failed', error: { message: 'Interrupted; resuming', at: new Date(), retryable: true } } });
      await enqueueJob({ queue: job.queue as QueueKey, type: job.type, idempotencyKey: job.idempotencyKey });
      restored++;
    }
  }
  if (restored) logger.info({ restored }, 'Re-enqueued interrupted jobs');
  return restored;
}
