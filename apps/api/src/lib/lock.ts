import crypto from 'node:crypto';
import { redisConnection } from '../queues/connection';
import { env } from '../config/env';

/**
 * Single-flight across workers: identical expensive work (same narration or scene cache key) is produced
 * once. Others wait for the producer and then reuse its result via `check`.
 */
export async function singleFlight<T>(
  key: string,
  check: () => Promise<T | null>,
  produce: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number; onWait?: () => Promise<void> } = {},
): Promise<T> {
  const redis = redisConnection();
  const lockKey = `${env.QUEUE_PREFIX}:lock:${key}`;
  const token = crypto.randomUUID();
  const ttl = opts.ttlMs ?? 25 * 60_000;
  const deadline = Date.now() + (opts.waitMs ?? 30 * 60_000);
  for (;;) {
    const existing = await check();
    if (existing) return existing;
    if (await redis.set(lockKey, token, 'PX', ttl, 'NX')) {
      try {
        return (await check()) ?? (await produce());
      } finally {
        // Release only our own lock.
        await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, token);
      }
    }
    if (Date.now() > deadline) throw Object.assign(new Error(`Timed out waiting for shared work ${key}`), { retryable: true });
    await opts.onWait?.();
    await new Promise((r) => setTimeout(r, 1500));
  }
}
