import type { Worker } from 'bullmq';
import { logger } from './config/logger';
import { connectMongo } from './db/connection';
import { initDatabase } from './db/init';
import { startWorker } from './workers/runtime';
import { registerAllHandlers, workerConcurrency } from './workers';
import { reconcileJobs } from './services/jobs';
import { closeQueues, ALL_QUEUE_KEYS } from './queues';
import { closeRedis } from './queues/connection';

async function main() {
  await connectMongo();
  await initDatabase();
  registerAllHandlers();
  const concurrency = await workerConcurrency();
  const workers: Worker[] = ALL_QUEUE_KEYS.map((q) => startWorker(q, concurrency[q]));
  logger.info({ concurrency }, 'Workers started');
  await reconcileJobs();
  const shutdown = async () => {
    logger.info('Shutting down workers (waiting for active jobs)');
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal(err, 'Worker failed to start');
  process.exit(1);
});
