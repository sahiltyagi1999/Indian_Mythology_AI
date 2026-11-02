import { describe, expect, it } from 'vitest';
import { countSyllables, countWords, estimateSpokenSeconds, slugify } from '@mas/shared';

describe('spoken duration heuristics', () => {
  it('counts Devanagari aksharas, folding conjuncts and matras', () => {
    expect(countSyllables('राम')).toBe(2); // रा + म
    expect(countSyllables('प्रतिज्ञा')).toBe(3); // प्र + ति + ज्ञा
    expect(countSyllables('श्रीकृष्ण')).toBe(3); // श्री + कृ + ष्ण
  });

  it('estimates ~55 seconds for ~135 words of narration', () => {
    const sentence = 'हस्तिनापुर के राजा शान्तनु एक दिन गंगा के तट पर गए, और वहाँ उन्होंने एक दिव्य स्त्री को देखा। ';
    const text = sentence.repeat(8);
    expect(countWords(text)).toBeGreaterThan(120);
    const s = estimateSpokenSeconds(text);
    expect(s).toBeGreaterThan(45);
    expect(s).toBeLessThan(70);
  });

  it('slows the estimate down when speed < 1', () => {
    const t = 'कर्ण को दुनिया सूतपुत्र कहती थी, लेकिन उसकी असली पहचान कुछ और ही थी।';
    expect(estimateSpokenSeconds(t, 5.2, 0.9)).toBeGreaterThan(estimateSpokenSeconds(t, 5.2, 1));
  });

  it('slugifies Hindi titles', () => {
    expect(slugify('भीष्म की प्रतिज्ञा!')).toBe('भीष्म-की-प्रतिज्ञा');
    expect(slugify('Birth of Karna')).toBe('birth-of-karna');
  });
});
