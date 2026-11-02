import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type QueueKey } from '@mas/shared';
import { env } from '../config/env';
import { logger, scrubSecrets } from '../config/logger';
import { GenerationJobModel, type GenerationJobDoc } from '../models';
import { BudgetExceededError, CancelledError, ProviderError } from '../lib/errors';
import { redisConnection } from '../queues/connection';
import type { JobData } from '../queues';
import type { UsageContext } from '../services/cost/usage';

export interface JobContext {
  bull: Job<JobData>;
  job: GenerationJobDoc;
  payload: Record<string, any>;
  usage: UsageContext;
  progress(stage: string, percent: number): Promise<void>;
  log(message: string, level?: 'info' | 'warn' | 'error'): Promise<void>;
  /** Throws CancelledError if the user cancelled. Call between expensive steps. */
  checkCancelled(): Promise<void>;
}

export type Handler = (ctx: JobContext) => Promise<void>;

/** Hooks that run when a job reaches a terminal state (used by the video pipeline to update assets). */
export type TerminalHook = (job: GenerationJobDoc, outcome: 'failed' | 'cancelled' | 'awaiting_confirmation', err: Error) => Promise<void>;

const handlers = new Map<string, Handler>();
const terminalHooks: TerminalHook[] = [];

export function registerHandler(type: string, handler: Handler) {
  handlers.set(type, handler);
}

export function onTerminal(hook: TerminalHook) {
  terminalHooks.push(hook);
}

async function pushLog(id: unknown, level: string, message: string) {
  await GenerationJobModel.updateOne({ _id: id }, { $push: { logs: { $each: [{ at: new Date(), level, message: scrubSecrets(message) }], $slice: -200 } } });
}

export async function runJob(bull: Job<JobData>, worker?: Worker) {
  const job = await GenerationJobModel.findById(bull.data.generationJobId);
  if (!job) throw new UnrecoverableError(`GenerationJob ${bull.data.generationJobId} not found`);
  if (job.status === 'completed') return; // duplicate delivery — already done
  if (job.cancelRequested) {
    await GenerationJobModel.updateOne({ _id: job._id }, { $set: { status: 'cancelled', finishedAt: new Date() } });
    return;
  }
  const handler = handlers.get(job.type);
  if (!handler) throw new UnrecoverableError(`No handler registered for job type ${job.type}`);

  const attempt = bull.attemptsMade + 1;
  await GenerationJobModel.updateOne(
    { _id: job._id },
    { $set: { status: 'running', attempts: attempt, startedAt: job.startedAt ?? new Date() }, $unset: { error: 1 } },
  );
  await pushLog(job._id, 'info', `Attempt ${attempt}/${job.maxAttempts} started`);

  const ctx: JobContext = {
    bull,
    job,
    payload: (job.payload as Record<string, any>) ?? {},
    usage: { sourceId: job.sourceId, episodeId: job.episodeId, videoId: job.videoId, batchId: job.batchId, jobId: job._id },
    async progress(stage, percent) {
      await GenerationJobModel.updateOne({ _id: job._id }, { $set: { stage, progress: Math.max(0, Math.min(100, Math.round(percent))) } });
      await bull.updateProgress(Math.round(percent)).catch(() => undefined);
    },
    log: (message, level = 'info') => pushLog(job._id, level, message),
    async checkCancelled() {
      const fresh = await GenerationJobModel.findById(job._id).select('cancelRequested').lean();
      if (fresh?.cancelRequested) throw new CancelledError();
    },
  };

  try {
    await handler(ctx);
    await GenerationJobModel.updateOne({ _id: job._id }, { $set: { status: 'completed', progress: 100, stage: 'completed', finishedAt: new Date() } });
    await pushLog(job._id, 'info', 'Completed');
  } catch (raw) {
    const err = raw as Error;
    const message = scrubSecrets(err.message ?? String(err));
    const fresh = await GenerationJobModel.findById(job._id);
    const terminal = async (status: 'failed' | 'cancelled' | 'awaiting_confirmation', retryable: boolean, code: string) => {
      await GenerationJobModel.updateOne(
        { _id: job._id },
        { $set: { status, finishedAt: new Date(), error: { message, code, at: new Date(), retryable } } },
      );
      await pushLog(job._id, status === 'failed' ? 'error' : 'warn', message);
      for (const hook of terminalHooks) await hook(fresh ?? job, status, err).catch((e) => logger.error(e, 'terminal hook failed'));
    };

    if (err instanceof CancelledError) {
      await terminal('cancelled', false, 'CANCELLED');
      throw new UnrecoverableError(message);
    }
    if (err instanceof BudgetExceededError) {
      await terminal('awaiting_confirmation', false, 'BUDGET_EXCEEDED');
      throw new UnrecoverableError(message);
    }
    if (err instanceof ProviderError && err.code === 'RATE_LIMITED' && worker) {
      // Pause this queue briefly; BullMQ re-runs the job without consuming an attempt.
      await pushLog(job._id, 'warn', `Rate limited by ${err.provider}; pausing queue 60s`);
      await GenerationJobModel.updateOne({ _id: job._id }, { $set: { status: 'queued', stage: 'rate limited — waiting' } });
      await worker.rateLimit(60_000);
      throw Worker.RateLimitError();
    }
    const retryable = err instanceof ProviderError ? err.retryable : !(err instanceof UnrecoverableError) && !(err as any).permanent;
    const lastAttempt = attempt >= (job.maxAttempts ?? 5);
    if (!retryable || lastAttempt) {
      await terminal('failed', retryable, (err as any).code ?? 'ERROR');
      throw new UnrecoverableError(message);
    }
    await GenerationJobModel.updateOne(
      { _id: job._id },
      { $set: { status: 'queued', stage: `retrying after error (attempt ${attempt})`, error: { message, code: (err as any).code ?? 'ERROR', at: new Date(), retryable: true } } },
    );
    await pushLog(job._id, 'warn', `Attempt ${attempt} failed, will retry with backoff: ${message}`);
    throw err;
  }
}

export function startWorker(queue: QueueKey, concurrency: number): Worker<JobData> {
  const worker: Worker<JobData> = new Worker<JobData>(QUEUE_NAMES[queue], (bull) => runJob(bull, worker), {
    connection: redisConnection(),
    prefix: env.QUEUE_PREFIX,
    concurrency,
    lockDuration: 120_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  worker.on('error', (err) => logger.error({ err, queue }, 'Worker error'));
  worker.on('failed', (job, err) => logger.warn({ queue, jobId: job?.id, err: err.message }, 'Job attempt failed'));
  return worker;
}
