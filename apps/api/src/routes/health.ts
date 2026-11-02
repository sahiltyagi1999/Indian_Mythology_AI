import { Router } from 'express';
import { ah } from './util';
import { mongoStatus } from '../db/connection';
import { redisConnection } from '../queues/connection';
import { queueHealth } from '../queues';
import { vectorStore } from '../providers/vector';
import { binaryAvailable } from '../lib/exec';
import { env } from '../config/env';
import { storage } from '../storage';

export const healthRouter = Router();

export async function systemHealth() {
  const [redisPing, vector, ffmpeg, ffprobe, pdftotext, pdftoppm, tesseract, disk] = await Promise.all([
    redisConnection().ping().catch((e: Error) => `error: ${e.message}`),
    vectorStore().health(),
    binaryAvailable(env.FFMPEG_PATH),
    binaryAvailable(env.FFPROBE_PATH),
    binaryAvailable(env.PDFTOTEXT_PATH, ['-v']),
    binaryAvailable(env.PDFTOPPM_PATH, ['-v']),
    binaryAvailable(env.TESSERACT_PATH, ['--version']),
    storage().diskSpace(),
  ]);
  return {
    mongo: mongoStatus(),
    redis: { ok: redisPing === 'PONG', message: redisPing },
    vector: { kind: vectorStore().kind, ...vector },
    binaries: { ffmpeg, ffprobe, pdftotext, pdftoppm, tesseract },
    disk,
  };
}

healthRouter.get(
  '/',
  ah(async (_req, res) => {
    const h = await systemHealth();
    const ok = h.mongo.state === 'connected' && h.redis.ok;
    res.status(ok ? 200 : 503).json({ ok, ...h });
  }),
);

healthRouter.get(
  '/queues',
  ah(async (_req, res) => {
    res.json(await queueHealth());
  }),
);
