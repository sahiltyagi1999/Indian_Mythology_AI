import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import mongoose from 'mongoose';
import { AppError, ProviderError } from '../lib/errors';
import { logger, scrubSecrets } from '../config/logger';

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError('Validation failed', 422, 'VALIDATION_ERROR', r.error.flatten());
  return r.data;
}

export function objectId(id: string, what = 'id'): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) throw new AppError(`Invalid ${what}`, 400, 'INVALID_ID');
  return new mongoose.Types.ObjectId(id);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({ error: { message: 'Validation failed', code: 'VALIDATION_ERROR', details: err.flatten() } });
    return;
  }
  if (err instanceof ProviderError) {
    const status = err.code === 'MISSING_CREDENTIALS' ? 412 : err.httpStatus === 429 ? 429 : 502;
    res.status(status).json({ error: { message: scrubSecrets(err.message), code: err.code, details: { provider: err.provider, retryable: err.retryable } } });
    return;
  }
  if ((err as { code?: number }).code === 11000) {
    res.status(409).json({ error: { message: 'Duplicate record', code: 'DUPLICATE', details: (err as { keyValue?: unknown }).keyValue } });
    return;
  }
  if ((err as { name?: string }).name === 'MulterError') {
    res.status(400).json({ error: { message: (err as Error).message, code: 'UPLOAD_ERROR' } });
    return;
  }
  logger.error(err, 'Unhandled error');
  res.status(500).json({ error: { message: 'Internal server error', code: 'INTERNAL' } });
}
