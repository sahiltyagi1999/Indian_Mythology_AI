/**
 * Initialises the database: builds every index declared on the models and seeds default
 * provider configuration (pricing catalog, budgets, render defaults). Safe to run repeatedly.
 */
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from './connection';
import * as models from '../models';
import { logger } from '../config/logger';
import { ensureDefaultConfigs } from '../services/settings';
import { pathToFileURL } from 'node:url';

export async function initDatabase() {
  const all = Object.values(models).filter((m): m is mongoose.Model<any> => typeof m === 'function' && 'syncIndexes' in m);
  for (const model of all) {
    await model.createCollection().catch(() => undefined);
    await model.syncIndexes();
  }
  await ensureDefaultConfigs();
  logger.info({ collections: all.map((m) => m.collection.collectionName) }, 'Database initialised');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  connectMongo()
    .then(initDatabase)
    .then(disconnectMongo)
    .catch((err) => {
      logger.error(err, 'Database initialisation failed');
      process.exit(1);
    });
}
