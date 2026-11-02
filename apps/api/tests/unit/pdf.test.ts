import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { assessTextQuality, extractTextRange, pdfInfo, renderPage } from '../../src/services/story/pdf';
import { makeHindiPdf } from '../fixtures/make-pdf';

const clean = path.join(__dirname, '../fixtures/hindi-clean.pdf');
const broken = path.join(os.tmpdir(), `mas-broken-${process.pid}.pdf`);

beforeAll(() => makeHindiPdf(broken));

describe('PDF extraction and OCR triage', () => {
  it('reads page count and per-page text with poppler', async () => {
    expect((await pdfInfo(clean)).pages).toBe(3);
    const pages = await extractTextRange(clean, 1, 3);
    expect(pages[0]).toContain('आदि पर्व');
    expect(pages[2]).toContain('भीष्म');
  });

  it('accepts a clean Unicode text layer', async () => {
    for (const p of await extractTextRange(clean, 1, 3)) expect(assessTextQuality(p, 'hi').score).toBeGreaterThanOrEqual(0.9);
  });

  it('flags a text layer with missing conjunct glyphs for OCR', async () => {
    const pages = await extractTextRange(broken, 1, 3);
    for (const p of pages) expect(assessTextQuality(p, 'hi').score).toBeLessThan(0.6);
  });

  it('flags an image-only (scanned) page for OCR and can render it', async () => {
    const [page4] = await extractTextRange(broken, 4, 4);
    expect(assessTextQuality(page4!, 'hi').score).toBe(0);
    const png = await renderPage(broken, 4, 72);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('detects English vs Hindi source text', async () => {
    const { detectLanguage } = await import('../../src/services/story/pdf');
    const en = 'Then Bhishma, the son of Ganga, took the terrible vow in the presence of the king of the fishermen, and the gods showered flowers. '.repeat(10);
    expect(detectLanguage(en)).toBe('en');
    const hi = (await extractTextRange(clean, 1, 3)).join(' ').repeat(2);
    expect(detectLanguage(hi)).toBe('hi');
    expect(detectLanguage('Hkh"e firkeg us viuh izfrKk yh] ftlls gfLrukiqj dk Hkfo"; cny x;kA '.repeat(20))).toBeNull();
  });

  it('detects legacy (Krutidev-style) Hindi encodings', () => {
    const legacy = 'Hkh"e firkeg us viuh izfrKk yh] ftlls gfLrukiqj dk Hkfo"; cny x;kA ';
    expect(assessTextQuality(legacy.repeat(5), 'hi').score).toBeLessThan(0.6);
  });
});
