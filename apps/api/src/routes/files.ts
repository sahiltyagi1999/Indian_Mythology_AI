import { Router } from 'express';
import path from 'node:path';
import { ah } from './util';
import { storage } from '../storage';
import { AppError, notFound } from '../lib/errors';

export const filesRouter = Router();

const ALLOWED_PREFIXES = ['projects/', 'library/', 'characters/'];
const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.srt': 'application/x-subrip; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
};

/** Streams stored assets with HTTP Range support (video scrubbing). Only whitelisted prefixes are served. */
filesRouter.get(
  /^\/(.+)$/,
  ah(async (req, res) => {
    const key = decodeURIComponent((req.params as Record<string, string>)[0]!);
    if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p)) || key.includes('..')) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    const st = await storage().stat(key);
    if (!st) throw notFound('File');
    const ext = path.extname(key).toLowerCase();
    res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${String(req.query.download).replace(/[^\w.\-]/g, '_') || path.basename(key)}"`);
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : Math.max(0, st.size - parseInt(range[2]!, 10));
      const end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${st.size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      storage().getStream(key, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(st.size));
    storage().getStream(key).pipe(res);
  }),
);
