import { DocumentChunkModel, StorySourceModel } from '../../models';
import { embedTexts } from '../../providers/llm';
import { vectorStore } from '../../providers/vector';
import type { UsageContext } from '../cost/usage';

export interface RetrievedChunk {
  id: string;
  chunkIndex: number;
  text: string;
  pageStart: number;
  pageEnd: number;
  section: string;
  score?: number;
}

/** Semantic search over a source, optionally constrained to a page window. */
export async function semanticSearch(
  sourceId: string,
  query: string,
  opts: { limit?: number; pageFrom?: number; pageTo?: number; usage?: UsageContext } = {},
): Promise<RetrievedChunk[]> {
  const source = await StorySourceModel.findById(sourceId).select('embeddingModel').lean();
  const { vectors } = await embedTexts([query], 'query', { usage: opts.usage, model: source?.embeddingModel ?? undefined });
  const hits = await vectorStore().search(vectors[0]!, { sourceId, pageFrom: opts.pageFrom, pageTo: opts.pageTo }, opts.limit ?? 8);
  const chunks = await DocumentChunkModel.find({ _id: { $in: hits.map((h) => h.payload.chunkId) } }).lean();
  const byId = new Map(chunks.map((c) => [String(c._id), c]));
  return hits
    .map((h): RetrievedChunk | null => {
      const c = byId.get(h.payload.chunkId);
      return c ? { id: String(c._id), chunkIndex: c.chunkIndex, text: c.text, pageStart: c.pageStart, pageEnd: c.pageEnd, section: c.section, score: h.score } : null;
    })
    .filter((x): x is RetrievedChunk => !!x);
}

export async function chunksByIds(ids: string[]): Promise<RetrievedChunk[]> {
  const chunks = await DocumentChunkModel.find({ _id: { $in: ids } }).sort({ chunkIndex: 1 }).lean();
  return chunks.map((c) => ({ id: String(c._id), chunkIndex: c.chunkIndex, text: c.text, pageStart: c.pageStart, pageEnd: c.pageEnd, section: c.section }));
}

/** Formats chunks as labelled source passages the LLM can cite by id. */
export function formatPassages(chunks: RetrievedChunk[], maxChars: number): string {
  let used = 0;
  const out: string[] = [];
  for (const c of chunks) {
    const header = `[[${c.id} | pages ${c.pageStart}-${c.pageEnd}${c.section ? ` | ${c.section}` : ''}]]`;
    const room = maxChars - used - header.length - 2;
    if (room < 200) break;
    const text = c.text.length > room ? `${c.text.slice(0, room)}…` : c.text;
    out.push(`${header}\n${text}`);
    used += header.length + text.length + 2;
  }
  return out.join('\n\n');
}
