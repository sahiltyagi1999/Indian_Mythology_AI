import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectMongo } from './db/connection';
import { initDatabase } from './db/init';
import { closeQueues } from './queues';
import { closeRedis } from './queues/connection';

async function main() {
  await connectMongo();
  await initDatabase();
  const app = createApp();
  const server = app.listen(env.API_PORT, env.API_HOST, () => logger.info(`API listening on http://${env.API_HOST}:${env.API_PORT}`));
  const shutdown = async () => {
    logger.info('Shutting down API');
    server.close();
    await closeQueues();
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal(err, 'API failed to start');
  process.exit(1);
});
