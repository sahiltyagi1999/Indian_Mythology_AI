import { StorySourceModel, DocumentChunkModel } from '../../models';
import { storage, keys } from '../../storage';
import { enqueueJob } from '../jobs';
import { getSettings } from '../settings';
import { assessTextQuality, detectLanguage, extractTextRange, pdfInfo, renderPage, tesseractOcr, type ExtractedPage } from './pdf';
import { chunkPages, deterministicUuid } from './chunker';
import { embedTexts, ocrPageImage } from '../../providers/llm';
import { vectorStore } from '../../providers/vector';
import { MissingCredentialsError } from '../../lib/errors';
import type { JobContext } from '../../workers/runtime';

const PAGE_BATCH = 25;
const OCR_THRESHOLD = 0.6;

export async function loadPages(sourceId: string): Promise<ExtractedPage[]> {
  const key = keys.sourcePages(sourceId);
  if (!(await storage().exists(key))) return [];
  return JSON.parse((await storage().get(key)).toString('utf8')) as ExtractedPage[];
}

async function savePages(sourceId: string, pages: ExtractedPage[]) {
  await storage().put(keys.sourcePages(sourceId), JSON.stringify(pages));
}

/** PDF processing job: page-by-page extraction with OCR fallback, then chunking. Resumable via pages.json. */
export async function processPdf(ctx: JobContext) {
  const sourceId = String(ctx.job.sourceId);
  const source = await StorySourceModel.findById(sourceId);
  if (!source) throw Object.assign(new Error('Source not found'), { permanent: true });
  const file = await storage().localPath(source.filePath);
  const info = await pdfInfo(file);
  if (info.encrypted) throw Object.assign(new Error('PDF is encrypted; upload an unlocked copy'), { permanent: true });
  const story = await getSettings('story');

  source.status = 'extracting';
  source.totalPages = info.pages;
  await source.save();

  // Language check before any OCR decision: an English edition uploaded as "Hindi" would otherwise
  // look like a broken Hindi text layer and be OCR'd page by page.
  const sample = (await extractTextRange(file, 1, Math.min(info.pages, 30))).join('\n');
  const detected = detectLanguage(sample);
  if (detected && detected !== source.language && source.language !== 'sa') {
    await ctx.log(`Source text is ${detected === 'en' ? 'English' : 'Hindi'}; switching source language from "${source.language}" to "${detected}" (scripts are still written in Hindi)`, 'warn');
    source.language = detected;
    await source.save();
  }

  const existing = await loadPages(sourceId);
  const byPage = new Map(existing.map((p) => [p.page, p]));
  let ocrUnavailable: string | null = null;

  for (let first = 1; first <= info.pages; first += PAGE_BATCH) {
    await ctx.checkCancelled();
    const last = Math.min(info.pages, first + PAGE_BATCH - 1);
    const needed = [];
    for (let p = first; p <= last; p++) {
      const prev = byPage.get(p);
      if (!prev || prev.method === 'failed') needed.push(p);
    }
    if (!needed.length) continue;
    const texts = await extractTextRange(file, first, last);
    for (const p of needed) {
      const text = texts[p - first] ?? '';
      const q = assessTextQuality(text, source.language);
      const wantOcr = source.ocrMode === 'always' || (source.ocrMode === 'auto' && q.score < OCR_THRESHOLD);
      let page: ExtractedPage = { page: p, text, method: 'text', quality: q.score, issues: q.issues };
      if (wantOcr && source.ocrMode !== 'never') {
        if (ocrUnavailable) {
          page = { ...page, method: 'failed', issues: [...q.issues, ocrUnavailable] };
        } else {
          try {
            const png = await renderPage(file, p);
            const ocrText = story.ocrEngine === 'tesseract' ? await tesseractOcr(png, source.language) : await ocrPageImage(png, ctx.usage);
            const oq = assessTextQuality(ocrText, source.language);
            page = { page: p, text: ocrText, method: 'ocr', quality: oq.score, issues: q.issues.map((i) => `text layer: ${i}`) };
          } catch (err) {
            if (err instanceof MissingCredentialsError) ocrUnavailable = `OCR unavailable: ${err.message}`;
            page = { ...page, method: 'failed', issues: [...q.issues, `OCR failed: ${(err as Error).message}`] };
          }
        }
      }
      byPage.set(p, page);
    }
    const pages = [...byPage.values()].sort((a, b) => a.page - b.page);
    await savePages(sourceId, pages);
    const failed = pages.filter((p) => p.method === 'failed');
    await StorySourceModel.updateOne(
      { _id: sourceId },
      {
        $set: {
          pagesKey: keys.sourcePages(sourceId),
          'stats.extractedPages': pages.length,
          'stats.ocrPages': pages.filter((p) => p.method === 'ocr').length,
          'stats.failedPages': failed.length,
          extractionErrors: failed.slice(0, 500).map((p) => ({ page: p.page, message: p.issues.join('; ') })),
          progress: { stage: 'extracting', percent: Math.round((last / info.pages) * 80), message: `Pages ${last}/${info.pages}` },
        },
      },
    );
    await ctx.progress(`extracting pages ${last}/${info.pages}`, (last / info.pages) * 80);
  }

  // Chunking
  await StorySourceModel.updateOne({ _id: sourceId }, { $set: { status: 'chunking', progress: { stage: 'chunking', percent: 85 } } });
  const pages = await loadPages(sourceId);
  const usable = pages.filter((p) => p.method !== 'failed' || p.quality >= 0.3);
  const chunks = chunkPages(
    usable.map((p) => ({ page: p.page, text: p.text })),
    { chunkChars: story.chunkChars, overlapChars: story.chunkOverlapChars },
  );
  if (!chunks.length) throw Object.assign(new Error('No usable text could be extracted from this PDF. Check extraction errors (OCR may need a Gemini key).'), { permanent: true });

  const ops = chunks.map((c) => ({
    updateOne: {
      filter: { sourceId, chunkIndex: c.chunkIndex },
      update: [
        {
          $set: {
            sourceId: source._id,
            chunkIndex: c.chunkIndex,
            text: c.text,
            pageStart: c.pageStart,
            pageEnd: c.pageEnd,
            section: c.section,
            tokenEstimate: c.tokenEstimate,
            vectorId: deterministicUuid(`${sourceId}:${c.chunkIndex}`),
            // Keep the embedded flag only if the content is unchanged.
            embedded: { $and: [{ $eq: ['$contentHash', c.contentHash] }, { $eq: ['$embedded', true] }] },
            contentHash: c.contentHash,
            createdAt: { $ifNull: ['$createdAt', '$$NOW'] },
            updatedAt: '$$NOW',
          },
        },
      ],
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += 500) await DocumentChunkModel.bulkWrite(ops.slice(i, i + 500) as any, { ordered: false });
  await DocumentChunkModel.deleteMany({ sourceId, chunkIndex: { $gte: chunks.length } });
  const embedded = await DocumentChunkModel.countDocuments({ sourceId, embedded: true });

  await StorySourceModel.updateOne(
    { _id: sourceId },
    { $set: { status: 'embedding', 'stats.chunks': chunks.length, 'stats.embeddedChunks': embedded, progress: { stage: 'embedding', percent: 90 } } },
  );
  await ctx.log(`Extracted ${pages.length} pages into ${chunks.length} chunks`);
  await enqueueJob({ queue: 'embedding', type: 'embed-source', idempotencyKey: `embed:${sourceId}:${source.sha256}:${chunks.length}`, sourceId: source._id });
}

/** Embedding job: embeds un-embedded chunks in batches (resumable) and upserts them to the vector store. */
export async function embedSource(ctx: JobContext) {
  const sourceId = String(ctx.job.sourceId);
  const total = await DocumentChunkModel.countDocuments({ sourceId });
  const store = vectorStore();
  const source = await StorySourceModel.findById(sourceId).select('embeddingModel').lean();
  const alreadyEmbedded = await DocumentChunkModel.countDocuments({ sourceId, embedded: true });
  // A partly indexed source keeps the model it started with; vectors from different models never mix.
  const pinnedModel = alreadyEmbedded > 0 ? source?.embeddingModel ?? undefined : undefined;
  let ensured = false;
  const BATCH = 50;
  for (;;) {
    await ctx.checkCancelled();
    const batch = await DocumentChunkModel.find({ sourceId, embedded: false }).sort({ chunkIndex: 1 }).limit(BATCH).lean();
    if (!batch.length) break;
    const { vectors, model, dimensions } = await embedTexts(
      batch.map((c) => c.text),
      'document',
      { titles: batch.map((c) => c.section || 'none'), usage: ctx.usage, model: pinnedModel },
    );
    if (!ensured) {
      await store.ensureCollection(dimensions);
      ensured = true;
      await StorySourceModel.updateOne({ _id: sourceId }, { $set: { embeddingModel: model, embeddingDimensions: dimensions } });
    }
    await store.upsert(
      batch.map((c, i) => ({
        id: c.vectorId,
        vector: vectors[i]!,
        payload: { sourceId, chunkId: String(c._id), chunkIndex: c.chunkIndex, pageStart: c.pageStart, pageEnd: c.pageEnd, section: c.section },
      })),
    );
    await DocumentChunkModel.updateMany({ _id: { $in: batch.map((c) => c._id) } }, { $set: { embedded: true, embeddingModel: model } });
    const done = await DocumentChunkModel.countDocuments({ sourceId, embedded: true });
    await StorySourceModel.updateOne(
      { _id: sourceId },
      { $set: { 'stats.embeddedChunks': done, progress: { stage: 'embedding', percent: 90 + Math.round((done / total) * 10), message: `${done}/${total} chunks` } } },
    );
    await ctx.progress(`embedding ${done}/${total}`, (done / total) * 100);
  }
  await StorySourceModel.updateOne({ _id: sourceId }, { $set: { status: 'indexed', progress: { stage: 'indexed', percent: 100 } } });
}
