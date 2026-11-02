/**
 * Spoken-duration heuristics for Hindi narration. These are only used before audio exists;
 * the Video Engine measures real audio and the calibration factor is learned from it.
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const MATRA_OR_MARK = /[ऺ-ॏ॑-ॗॢॣऀ-ः]/;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Approximate spoken syllables: count aksharas (consonant/vowel clusters) in Devanagari, vowel groups in Latin. */
export function countSyllables(text: string): number {
  let count = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (DEVANAGARI.test(word)) {
      for (let i = 0; i < word.length; i++) {
        const ch = word[i]!;
        if (!DEVANAGARI.test(ch) || MATRA_OR_MARK.test(ch)) continue;
        // A virama (्) joins the next consonant into the same akshara.
        if (word[i - 1] === '्') continue;
        count++;
      }
    } else {
      const groups = word.toLowerCase().match(/[aeiouy]+/g);
      count += Math.max(1, groups?.length ?? 0);
    }
  }
  return count;
}

/** Pauses (seconds) contributed by punctuation in narration. */
export function punctuationPause(text: string): number {
  const full = (text.match(/[।?!.]/g) ?? []).length;
  const comma = (text.match(/[,;:—–]/g) ?? []).length;
  const ellipsis = (text.match(/…|\.\.\./g) ?? []).length;
  return full * 0.45 + comma * 0.2 + ellipsis * 0.5;
}

export const DEFAULT_SYLLABLES_PER_SECOND = 5.2;

export function estimateSpokenSeconds(text: string, syllablesPerSecond = DEFAULT_SYLLABLES_PER_SECOND, speed = 1): number {
  const s = countSyllables(text) / (syllablesPerSecond * speed) + punctuationPause(text) / speed;
  return Math.round(s * 10) / 10;
}

export function slugify(input: string): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.slice(0, 80) || 'episode';
}
