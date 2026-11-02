import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../../config/env';
import { run } from '../../lib/exec';

export interface ExtractedPage {
  page: number;
  text: string;
  method: 'text' | 'ocr' | 'failed';
  quality: number;
  issues: string[];
}

export async function pdfInfo(file: string): Promise<{ pages: number; title?: string; encrypted: boolean }> {
  const { stdout } = await run(env.PDFINFO_PATH, [file], { timeoutMs: 60_000 });
  const get = (k: string) => stdout.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim();
  return { pages: parseInt(get('Pages') ?? '0', 10), title: get('Title') || undefined, encrypted: get('Encrypted')?.startsWith('yes') ?? false };
}

/** Extracts text for a page range with poppler, one string per page (pages are separated by form feeds). */
export async function extractTextRange(file: string, first: number, last: number): Promise<string[]> {
  const { stdout } = await run(env.PDFTOTEXT_PATH, ['-enc', 'UTF-8', '-f', String(first), '-l', String(last), file, '-'], { timeoutMs: 300_000 });
  const pages = stdout.split('\f');
  const out: string[] = [];
  for (let i = 0; i <= last - first; i++) out.push(normalizeText(pages[i] ?? ''));
  return out;
}

export function normalizeText(t: string): string {
  return t
    .normalize('NFC')
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/-\n(?=[a-z])/g, '') // hyphenated English line breaks
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

const DEVANAGARI = /[ऀ-ॿ]/g;
const LATIN = /[A-Za-z]/g;
const COMBINING_START = /(^|\s)[ा-्ॢॣँ-ः]/g;
const PRIVATE_USE = /[-�]/g;

/**
 * Scores extracted text 0..1. Detects scanned pages (no text), legacy-font mojibake (Krutidev/Chanakya
 * Hindi PDFs decode to Latin gibberish), broken Unicode mapping (words starting with a matra) and
 * private-use glyphs. Pages below the threshold are re-read with OCR.
 */
export function assessTextQuality(text: string, language: string): { score: number; issues: string[] } {
  const issues: string[] = [];
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (letters.length < 40) return { score: 0, issues: ['little or no extractable text (likely scanned)'] };
  const dev = (text.match(DEVANAGARI) ?? []).length;
  const lat = (text.match(LATIN) ?? []).length;
  const pua = (text.match(PRIVATE_USE) ?? []).length;
  let score = 1;
  if (pua / letters.length > 0.01) {
    score -= 0.6;
    issues.push('private-use or replacement glyphs (font has no Unicode mapping)');
  }
  if (language.startsWith('hi') || language.startsWith('sa')) {
    const devRatio = dev / Math.max(1, dev + lat);
    if (devRatio < 0.5) {
      // Legacy-font Hindi often appears as Latin text full of unusual capitalisation and symbols.
      const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
      const weird = words.filter((w) => /[A-Z].*[a-z].*[A-Z]|[a-z][A-Z]|[;\[\]{}~`^|]/.test(w)).length / Math.max(1, words.length);
      score -= weird > 0.15 ? 0.8 : 0.5;
      issues.push(weird > 0.15 ? 'legacy (non-Unicode) Hindi font encoding detected' : 'expected Devanagari text but found mostly Latin');
    }
    const words = Math.max(1, text.split(/\s+/).length);
    const badStarts = (text.match(COMBINING_START) ?? []).length / words;
    if (badStarts > 0.04) {
      score -= 0.4;
      issues.push('broken Devanagari ordering (words begin with vowel signs)');
    }
    // Fonts without ToUnicode entries for conjunct ligatures drop glyphs ("पर्व" → "पव", "हस्तिनापुर" → "ह नापुर"):
    // clean Hindi has almost no one-letter tokens and averages ~4 code points per word.
    const devTokens = text.split(/[\s।॥,;:!?"'()-]+/).filter((t) => /[ऀ-ॿ]/.test(t));
    if (devTokens.length >= 15) {
      const single = devTokens.filter((t) => [...t].length === 1).length / devTokens.length;
      const avgLen = devTokens.reduce((a, t) => a + [...t].length, 0) / devTokens.length;
      if (single > 0.06 || avgLen < 3) {
        score -= 0.5;
        issues.push(`missing conjunct glyphs in text layer (${Math.round(single * 100)}% one-letter fragments, avg word ${avgLen.toFixed(1)} chars)`);
      }
    }
  }
  return { score: Math.max(0, score), issues };
}

const ENGLISH_STOPWORDS = new Set(['the', 'and', 'of', 'to', 'in', 'was', 'his', 'he', 'that', 'with', 'by', 'is', 'for', 'as', 'thou', 'thy', 'o']);

/**
 * Detects whether extracted text is English or Devanagari-script. Returns null when there is too little
 * text (e.g. a scanned PDF) or it is ambiguous; legacy-font Hindi (Latin gibberish) is not mistaken for English
 * because it contains almost no English stopwords.
 */
export function detectLanguage(text: string): 'en' | 'hi' | null {
  const dev = (text.match(DEVANAGARI) ?? []).length;
  const lat = (text.match(LATIN) ?? []).length;
  if (dev + lat < 500) return null;
  if (dev / (dev + lat) > 0.6) return 'hi';
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const stop = words.filter((w) => ENGLISH_STOPWORDS.has(w)).length / Math.max(1, words.length);
  return lat / (dev + lat) > 0.9 && stop > 0.12 ? 'en' : null;
}

/** Renders one page to PNG at the given DPI and returns its bytes. */
export async function renderPage(file: string, page: number, dpi = 200): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mas-page-'));
  try {
    const prefix = path.join(dir, 'p');
    await run(env.PDFTOPPM_PATH, ['-f', String(page), '-l', String(page), '-r', String(dpi), '-png', '-singlefile', file, prefix], { timeoutMs: 120_000 });
    return await fs.readFile(`${prefix}.png`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Local OCR with Tesseract (hin+eng) when installed and selected in settings. */
export async function tesseractOcr(png: Buffer, language: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mas-ocr-'));
  try {
    const img = path.join(dir, 'page.png');
    await fs.writeFile(img, png);
    const langs = language.startsWith('hi') ? 'hin+eng' : language.startsWith('sa') ? 'san+hin+eng' : 'eng';
    const { stdout } = await run(env.TESSERACT_PATH, [img, 'stdout', '-l', langs, '--psm', '3'], { timeoutMs: 180_000 });
    return normalizeText(stdout);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
