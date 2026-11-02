import { sha256 } from '../../lib/crypto';

export interface PageText {
  page: number;
  text: string;
}

export interface Chunk {
  chunkIndex: number;
  text: string;
  pageStart: number;
  pageEnd: number;
  section: string;
  contentHash: string;
  tokenEstimate: number;
}

const HEADING =
  /^(?:[^\n]{0,40}(?:पर्व|अध्याय|उपपर्व|सर्ग|स्कन्ध)[^\n]{0,40}|(?:BOOK|PARVA|PARVAN|SECTION|CHAPTER|CANTO)\b[^\n]{0,60}|[^\n]{0,40}\bParva\b[^\n]{0,30})$/i;

export function detectHeading(line: string): string | null {
  const l = line.trim();
  if (l.length < 3 || l.length > 90) return null;
  return HEADING.test(l) ? l.replace(/\s+/g, ' ') : null;
}

/** Rough token estimate: Devanagari averages ~2.5 chars/token, Latin ~4. */
export function estimateTokens(text: string): number {
  const dev = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  return Math.ceil(dev / 2.5 + (text.length - dev) / 4);
}

interface Para {
  text: string;
  page: number;
  section: string;
}

/**
 * Paragraph-aware chunking with character overlap. Each chunk keeps the page range it spans and the
 * most recent section heading, so every generated script can cite pages.
 */
export function chunkPages(pages: PageText[], opts: { chunkChars: number; overlapChars: number }): Chunk[] {
  const paras: Para[] = [];
  let section = '';
  for (const p of pages) {
    const blocks = p.text.split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const heading = lines.length <= 2 ? detectHeading(lines.join(' ')) : detectHeading(lines[0]!);
      if (heading) section = heading;
      const text = lines.join(' ');
      // Split very long paragraphs on sentence boundaries so no paragraph exceeds a chunk.
      if (text.length > opts.chunkChars) {
        const sentences = text.split(/(?<=[।॥.!?])\s+/);
        let buf = '';
        for (const s of sentences) {
          if (buf && buf.length + s.length + 1 > opts.chunkChars) {
            paras.push({ text: buf, page: p.page, section });
            buf = '';
          }
          buf = buf ? `${buf} ${s}` : s;
          while (buf.length > opts.chunkChars) {
            paras.push({ text: buf.slice(0, opts.chunkChars), page: p.page, section });
            buf = buf.slice(opts.chunkChars);
          }
        }
        if (buf) paras.push({ text: buf, page: p.page, section });
      } else {
        paras.push({ text, page: p.page, section });
      }
    }
  }

  const chunks: Chunk[] = [];
  let i = 0;
  // When no whole paragraph fits in the overlap budget, a sentence-aligned tail of the last paragraph is carried instead.
  let carry: Para | null = null;
  while (i < paras.length) {
    if (carry && carry.text.length + 2 + paras[i]!.text.length > opts.chunkChars) carry = null;
    let len = carry ? carry.text.length + 2 : 0;
    let j = i;
    while (j < paras.length && (j === i || len + paras[j]!.text.length + 2 <= opts.chunkChars)) {
      len += paras[j]!.text.length + 2;
      j++;
    }
    const slice = carry ? [carry, ...paras.slice(i, j)] : paras.slice(i, j);
    const text = slice.map((p) => p.text).join('\n\n');
    chunks.push({
      chunkIndex: chunks.length,
      text,
      pageStart: slice[0]!.page,
      pageEnd: slice[slice.length - 1]!.page,
      section: slice[slice.length - 1]!.section || slice[0]!.section,
      contentHash: sha256(text),
      tokenEstimate: estimateTokens(text),
    });
    if (j >= paras.length) break;
    // Step back over trailing paragraphs totalling <= overlapChars so context carries into the next chunk.
    let back = 0;
    let k = j;
    while (k - 1 > i && back + paras[k - 1]!.text.length <= opts.overlapChars) {
      back += paras[k - 1]!.text.length;
      k--;
    }
    if (k < j) {
      i = k;
      carry = null;
    } else {
      const last = paras[j - 1]!;
      carry = opts.overlapChars > 0 ? tailFragment(last, opts.overlapChars) : null;
      i = j;
    }
  }
  return chunks;
}

function tailFragment(p: Para, maxChars: number): Para | null {
  if (p.text.length <= maxChars) return p;
  const tail = p.text.slice(-maxChars);
  // Start at the first sentence boundary inside the tail so the overlap reads naturally.
  const m = tail.match(/[।॥.!?]\s+/);
  const text = (m && m.index! < tail.length - 40 ? tail.slice(m.index! + m[0].length) : tail).trim();
  return text ? { ...p, text } : null;
}

/** Deterministic UUID (v4-shaped) from a string, used for idempotent vector upserts. */
export function deterministicUuid(input: string): string {
  const h = sha256(input);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
