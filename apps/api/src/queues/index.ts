import { Queue, QueueEvents } from 'bullmq';
import { QUEUE_NAMES, type QueueKey } from '@mas/shared';
import { env } from '../config/env';
import { redisConnection } from './connection';

const queues = new Map<QueueKey, Queue>();

export interface JobData {
  generationJobId: string;
}

export function getQueue(key: QueueKey): Queue<JobData> {
  let q = queues.get(key);
  if (!q) {
    q = new Queue(QUEUE_NAMES[key], {
      connection: redisConnection(),
      prefix: env.QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 15_000 },
        removeOnComplete: { age: 7 * 86_400, count: 5000 },
        removeOnFail: { age: 30 * 86_400 },
      },
    });
    queues.set(key, q);
  }
  return q as Queue<JobData>;
}

export const ALL_QUEUE_KEYS = Object.keys(QUEUE_NAMES) as QueueKey[];

export async function queueHealth() {
  const out: Record<string, Record<string, number>> = {};
  for (const key of ALL_QUEUE_KEYS) {
    out[key] = await getQueue(key).getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused');
  }
  return out;
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}

export { QueueEvents };
