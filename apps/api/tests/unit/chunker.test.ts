import { describe, expect, it } from 'vitest';
import { chunkPages, detectHeading, deterministicUuid } from '../../src/services/story/chunker';

const para = (n: number) => `अनुच्छेद ${n}: ` + 'कथा आगे बढ़ती है और घटनाएँ घटती हैं। '.repeat(20);

describe('chunkPages', () => {
  const pages = Array.from({ length: 6 }, (_, i) => ({ page: i + 1, text: `${i === 0 ? 'आदि पर्व\n\n' : ''}${para(i * 2)}\n\n${para(i * 2 + 1)}` }));
  const chunks = chunkPages(pages, { chunkChars: 2000, overlapChars: 600 });

  it('keeps chunks under the size limit and preserves page ranges', () => {
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(2000);
      expect(c.pageStart).toBeLessThanOrEqual(c.pageEnd);
    }
    expect(chunks[0]!.pageStart).toBe(1);
    expect(chunks.at(-1)!.pageEnd).toBe(6);
  });

  it('overlaps consecutive chunks', () => {
    const a = chunks[0]!.text.split('\n\n');
    const b = chunks[1]!.text.split('\n\n');
    expect(a.at(-1)!.endsWith(b[0]!)).toBe(true);
    expect(b[0]!.length).toBeGreaterThan(100);
  });

  it('tracks section headings', () => {
    expect(chunks[0]!.section).toBe('आदि पर्व');
    expect(detectHeading('SECTION XLII')).toBe('SECTION XLII');
    expect(detectHeading('सभा पर्व')).toBe('सभा पर्व');
    expect(detectHeading('राजा ने कहा कि वह कल वन जाएगा और वहाँ तपस्या करेगा तथा लौटकर राज्य संभालेगा, यही उसका निश्चय था और अंतिम।')).toBeNull();
  });

  it('is deterministic (stable hashes and vector ids)', () => {
    const again = chunkPages(pages, { chunkChars: 2000, overlapChars: 600 });
    expect(again.map((c) => c.contentHash)).toEqual(chunks.map((c) => c.contentHash));
    expect(deterministicUuid('a:1')).toBe(deterministicUuid('a:1'));
    expect(deterministicUuid('a:1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
