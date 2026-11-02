import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ah, objectId, parse } from './util';
import { env } from '../config/env';
import { DocumentChunkModel, EpisodeModel, GenerationJobModel, StoryOutlineModel, StorySourceModel } from '../models';
import { storage, keys } from '../storage';
import { AppError, conflict, notFound } from '../lib/errors';
import { enqueueJob } from '../services/jobs';
import { loadPages } from '../services/story/ingest';
import { pdfInfo } from '../services/story/pdf';
import { semanticSearch } from '../services/story/retrieval';
import { vectorStore } from '../providers/vector';

export const sourcesRouter = Router();

const uploadDir = path.join(env.STORAGE_DIR, '.uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')),
});

async function hashFile(file: string) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

async function validatePdf(file: string) {
  const fd = await fsp.open(file, 'r');
  const buf = Buffer.alloc(5);
  await fd.read(buf, 0, 5, 0);
  await fd.close();
  if (buf.toString() !== '%PDF-') throw new AppError('File is not a valid PDF', 422, 'INVALID_PDF');
  return pdfInfo(file).catch((e: Error) => {
    throw new AppError(`Could not read PDF: ${e.message}`, 422, 'INVALID_PDF');
  });
}

const metaSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  edition: z.string().max(200).optional(),
  language: z.enum(['hi', 'en', 'sa']).optional(),
  ocrMode: z.enum(['auto', 'always', 'never']).optional(),
});

sourcesRouter.get(
  '/',
  ah(async (_req, res) => {
    const items = await StorySourceModel.find().select('-extractionErrors').sort({ createdAt: -1 }).lean();
    const outlines = await StoryOutlineModel.aggregate([
      { $sort: { version: -1 } },
      { $group: { _id: '$sourceId', latest: { $first: { _id: '$_id', version: '$version', status: '$status', episodes: { $size: '$episodes' } } } } },
    ]);
    const episodeCounts = await EpisodeModel.aggregate([{ $group: { _id: { s: '$sourceId', st: '$status' }, n: { $sum: 1 } } }]);
    res.json({
      items: items.map((s) => ({
        ...s,
        latestOutline: outlines.find((o) => String(o._id) === String(s._id))?.latest ?? null,
        episodeCounts: Object.fromEntries(episodeCounts.filter((e) => String(e._id.s) === String(s._id)).map((e) => [e._id.st, e.n])),
      })),
    });
  }),
);

sourcesRouter.post(
  '/',
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new AppError('A PDF file is required (field "file")', 400, 'NO_FILE');
    const tmp = req.file.path;
    try {
      const meta = parse(metaSchema, req.body);
      const info = await validatePdf(tmp);
      const sha = await hashFile(tmp);
      const dup = await StorySourceModel.findOne({ sha256: sha }).lean();
      if (dup) throw conflict('This PDF has already been uploaded', { sourceId: dup._id });
      const source = new StorySourceModel({
        title: meta.title || info.title || req.file.originalname.replace(/\.pdf$/i, ''),
        edition: meta.edition ?? '',
        language: meta.language ?? 'hi',
        ocrMode: meta.ocrMode ?? 'auto',
        fileName: req.file.originalname,
        fileSize: req.file.size,
        sha256: sha,
        totalPages: info.pages,
        filePath: 'pending',
      });
      source.filePath = keys.sourcePdf(String(source._id));
      await storage().putFile(source.filePath, tmp, { move: true });
      await source.save();
      res.status(201).json(source);
    } finally {
      await fsp.rm(tmp, { force: true });
    }
  }),
);

sourcesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const s = await StorySourceModel.findById(objectId(req.params.id!)).lean();
    if (!s) throw notFound('Source');
    const jobs = await GenerationJobModel.find({ sourceId: s._id, queue: { $in: ['pdf', 'embedding', 'outline'] } }).select('-logs -payload').sort({ createdAt: -1 }).limit(10).lean();
    res.json({ ...s, jobs });
  }),
);

sourcesRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const meta = parse(metaSchema, req.body);
    const s = await StorySourceModel.findByIdAndUpdate(objectId(req.params.id!), { $set: meta }, { new: true });
    if (!s) throw notFound('Source');
    res.json(s);
  }),
);

/** Replace the PDF of a source that has not been processed into episodes yet. */
sourcesRouter.put(
  '/:id/file',
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new AppError('A PDF file is required (field "file")', 400, 'NO_FILE');
    const tmp = req.file.path;
    try {
      const s = await StorySourceModel.findById(objectId(req.params.id!));
      if (!s) throw notFound('Source');
      if (await EpisodeModel.exists({ sourceId: s._id })) throw conflict('Episodes already exist for this source; upload a new source instead');
      if (await GenerationJobModel.exists({ sourceId: s._id, status: { $in: ['queued', 'running'] } })) throw conflict('Processing is in progress');
      const info = await validatePdf(tmp);
      const sha = await hashFile(tmp);
      if (await StorySourceModel.exists({ sha256: sha, _id: { $ne: s._id } })) throw conflict('This PDF is already uploaded as another source');
      await storage().putFile(s.filePath, tmp, { move: true });
      await storage().delete(keys.sourcePages(String(s._id)));
      await DocumentChunkModel.deleteMany({ sourceId: s._id });
      await vectorStore().deleteBySource(String(s._id)).catch(() => undefined);
      await StoryOutlineModel.deleteMany({ sourceId: s._id });
      Object.assign(s, {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        sha256: sha,
        totalPages: info.pages,
        status: 'uploaded',
        progress: { stage: '', percent: 0 },
        stats: { extractedPages: 0, ocrPages: 0, failedPages: 0, chunks: 0, embeddedChunks: 0 },
        extractionErrors: [],
      });
      await s.save();
      res.json(s);
    } finally {
      await fsp.rm(tmp, { force: true });
    }
  }),
);

sourcesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const s = await StorySourceModel.findById(objectId(req.params.id!));
    if (!s) throw notFound('Source');
    if (await EpisodeModel.exists({ sourceId: s._id })) throw conflict('This source has episodes. Sources with saved scripts cannot be deleted.');
    if (await GenerationJobModel.exists({ sourceId: s._id, status: { $in: ['queued', 'running'] } })) throw conflict('Processing is in progress; cancel it first');
    await DocumentChunkModel.deleteMany({ sourceId: s._id });
    await StoryOutlineModel.deleteMany({ sourceId: s._id });
    await vectorStore().deleteBySource(String(s._id)).catch(() => undefined);
    await storage().deletePrefix(`projects/${s._id}/source`);
    await s.deleteOne();
    res.status(204).end();
  }),
);

sourcesRouter.post(
  '/:id/process',
  ah(async (req, res) => {
    const body = parse(z.object({ retryFailedOcr: z.boolean().optional(), force: z.boolean().optional() }), req.body ?? {});
    const s = await StorySourceModel.findById(objectId(req.params.id!));
    if (!s) throw notFound('Source');
    // If extraction already finished, resume from embedding instead of doing nothing.
    const pdfDone = await GenerationJobModel.exists({ idempotencyKey: `pdf:${s._id}:${s.sha256}`, status: 'completed' });
    const pendingEmbeds = s.stats?.chunks ? await DocumentChunkModel.countDocuments({ sourceId: s._id, embedded: false }) : 0;
    if (pdfDone && !body.retryFailedOcr && !body.force && pendingEmbeds > 0) {
      const { job, created, requeued } = await enqueueJob({
        queue: 'embedding',
        type: 'embed-source',
        idempotencyKey: `embed:${s._id}:${s.sha256}:${s.stats!.chunks}`,
        sourceId: s._id,
      });
      if (created || requeued) await StorySourceModel.updateOne({ _id: s._id }, { $set: { status: 'embedding', progress: { stage: 'embedding', percent: 90, message: 'Resuming embeddings' } } });
      res.status(created || requeued ? 202 : 200).json({ job, created, requeued, resumedStep: 'embedding' });
      return;
    }
    const { job, created, requeued } = await enqueueJob({
      queue: 'pdf',
      type: 'process-pdf',
      idempotencyKey: `pdf:${s._id}:${s.sha256}`,
      sourceId: s._id,
      payload: { retryFailedOcr: !!body.retryFailedOcr },
      force: body.force || body.retryFailedOcr,
      maxAttempts: 3,
    });
    if (created || requeued) await StorySourceModel.updateOne({ _id: s._id }, { $set: { status: 'extracting', progress: { stage: 'queued', percent: 0 } } });
    res.status(created || requeued ? 202 : 200).json({ job, created, requeued });
  }),
);

sourcesRouter.get(
  '/:id/pages',
  ah(async (req, res) => {
    const q = parse(z.object({ from: z.coerce.number().int().min(1).default(1), to: z.coerce.number().int().min(1).optional() }), req.query);
    const pages = await loadPages(String(objectId(req.params.id!)));
    const to = q.to ?? q.from + 9;
    res.json({ total: pages.length, pages: pages.filter((p) => p.page >= q.from && p.page <= to) });
  }),
);

sourcesRouter.get(
  '/:id/chunks',
  ah(async (req, res) => {
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
    const sourceId = objectId(req.params.id!);
    const [items, total] = await Promise.all([
      DocumentChunkModel.find({ sourceId }).sort({ chunkIndex: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
      DocumentChunkModel.countDocuments({ sourceId }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

sourcesRouter.get(
  '/:id/search',
  ah(async (req, res) => {
    const q = parse(z.object({ q: z.string().min(2), limit: z.coerce.number().int().min(1).max(20).default(8) }), req.query);
    res.json({ results: await semanticSearch(String(objectId(req.params.id!)), q.q, { limit: q.limit }) });
  }),
);
