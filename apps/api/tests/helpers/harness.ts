import type { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { connectMongo } from '../../src/db/connection';
import { initDatabase } from '../../src/db/init';
import { createApp } from '../../src/app';
import { startWorker } from '../../src/workers/runtime';
import { registerAllHandlers } from '../../src/workers';
import { ALL_QUEUE_KEYS, closeQueues, getQueue } from '../../src/queues';
import { closeRedis } from '../../src/queues/connection';
import { GenerationJobModel } from '../../src/models';
import { vectorStore } from '../../src/providers/vector';
import { env } from '../../src/config/env';
import { QdrantClient } from '@qdrant/js-client-rest';
import { startStubServer } from './stubProviders';

export interface Harness {
  app: ReturnType<typeof createApp>;
  stop(): Promise<void>;
}

/** Real MongoDB (test DB), Redis (test prefix), Qdrant (test collection) and in-process workers. */
export async function startHarness(): Promise<Harness> {
  await connectMongo();
  await mongoose.connection.dropDatabase();
  await initDatabase();
  await vectorStore().health();
  registerAllHandlers();
  const stopStub = await startStubServer();
  const workers: Worker[] = ALL_QUEUE_KEYS.map((q) => startWorker(q, 2));
  return {
    app: createApp(),
    async stop() {
      await Promise.all(workers.map((w) => w.close()));
      for (const k of ALL_QUEUE_KEYS) await getQueue(k).obliterate({ force: true }).catch(() => undefined);
      await closeQueues();
      await closeRedis();
      await new QdrantClient({ url: env.QDRANT_URL, checkCompatibility: false }).deleteCollection(env.QDRANT_COLLECTION).catch(() => undefined);
      await stopStub();
      await mongoose.disconnect();
    },
  };
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, { timeout = 60_000, interval = 250, label = 'condition' } = {}): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) {
      const failed = await GenerationJobModel.find({ status: 'failed' }).select('type error logs').lean();
      throw new Error(`Timed out waiting for ${label}. Failed jobs: ${JSON.stringify(failed.map((f) => ({ type: f.type, error: f.error?.message, logs: f.logs.slice(-3) })))}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
