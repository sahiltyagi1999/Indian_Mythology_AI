import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../config/logger';

mongoose.set('strictQuery', true);

export async function connectMongo(uri = env.MONGODB_URI, dbName = env.MONGODB_DB): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
  logger.info({ dbName }, 'MongoDB connected');
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

export function mongoStatus() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return { state: states[mongoose.connection.readyState] ?? 'unknown', dbName: mongoose.connection.db?.databaseName ?? env.MONGODB_DB };
}
