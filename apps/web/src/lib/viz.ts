/**
 * Chart colors: the validated dark categorical palette (dataviz reference instance), assigned to spend
 * categories in a fixed order so a category keeps its color everywhere. Validated against #14141B:
 * worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3, all >= 3:1 contrast.
 */
export const CATEGORY_ORDER = ['text', 'embedding', 'narration', 'video', 'rendering', 'storage', 'ocr'] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  text: '#3987e5',
  embedding: '#d95926',
  narration: '#199e70',
  video: '#c98500',
  rendering: '#d55181',
  storage: '#008300',
  ocr: '#9085e9',
};

export const CATEGORY_LABELS: Record<string, string> = {
  text: 'Gemini text',
  embedding: 'Embeddings',
  narration: 'ElevenLabs narration',
  video: 'Video generation',
  rendering: 'Rendering',
  storage: 'Storage',
  ocr: 'OCR',
};

export const STATUS_COLORS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
