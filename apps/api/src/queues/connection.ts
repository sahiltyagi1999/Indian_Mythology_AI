import { Redis } from 'ioredis';
import { env } from '../config/env';

let shared: Redis | null = null;

/** BullMQ requires maxRetriesPerRequest=null on connections used by workers. */
export function redisConnection(): Redis {
  if (!shared) shared = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
  return shared;
}

export async function closeRedis() {
  if (shared) {
    await shared.quit().catch(() => undefined);
    shared = null;
  }
}
