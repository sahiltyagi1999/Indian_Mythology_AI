/**
 * Text/LLM provider router. All story-engine text work (outline, characters, scripts, quality checks,
 * Hinglish, scene planning, OCR, embeddings) goes through here; the provider is chosen in Settings → llm.
 * Video generation is separate (providers/video) and always uses its own configured provider.
 */
import { z } from 'zod';
import { getSettings } from '../../services/settings';
import type { UsageContext } from '../../services/cost/usage';
import * as gemini from './gemini';
import * as openai from './openai';
import type { GenerateJsonOptions, ModelRole } from './types';

export type { GenerateJsonOptions, ModelRole } from './types';

export async function textProvider(): Promise<'openai' | 'google'> {
  return (await getSettings('llm')).provider;
}

export async function generateJson<T>(opts: GenerateJsonOptions<T>) {
  return (await textProvider()) === 'openai' ? openai.generateJson(opts) : gemini.generateJson(opts);
}

export async function resolveModel(role: ModelRole): Promise<{ provider: 'openai' | 'google'; model: string }> {
  const provider = await textProvider();
  return { provider, model: provider === 'openai' ? await openai.resolveModel(role) : await gemini.resolveModel(role) };
}

/**
 * Embeds with the given model (its provider is inferred from the ID) or with the active provider's
 * embedding model. Retrieval passes the model a source was indexed with, so switching providers later
 * never mixes vector spaces.
 */
export async function embedTexts(
  texts: string[],
  kind: 'document' | 'query',
  opts: { titles?: string[]; usage?: UsageContext; model?: string } = {},
): Promise<{ vectors: number[][]; model: string; dimensions: number }> {
  const useOpenAI = opts.model ? openai.isOpenAIModel(opts.model) : (await textProvider()) === 'openai';
  return useOpenAI ? openai.embedTexts(texts, { model: opts.model, usage: opts.usage }) : gemini.embedTexts(texts, kind, opts);
}

export async function ocrPageImage(png: Buffer, usage?: UsageContext): Promise<string> {
  const { data } = await generateJson({
    role: 'ocr',
    operation: 'ocr:page',
    system:
      'You are a meticulous OCR engine for Hindi (Devanagari), Sanskrit and English book pages. Transcribe text exactly as printed. Do not translate, summarise or correct the text.',
    prompt:
      'Transcribe all body text on this page in reading order. Preserve paragraph breaks with blank lines. Omit running headers/footers and page numbers. If the page has no text, return an empty string.',
    jsonSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    validator: z.object({ text: z.string() }),
    images: [{ mimeType: 'image/png', data: png }],
    usage,
    maxOutputTokens: 8192,
  });
  return data.text;
}
