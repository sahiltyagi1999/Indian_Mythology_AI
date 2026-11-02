import type { GenerateJsonOptions, ModelRole } from './types';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { MissingCredentialsError, ProviderError } from '../../lib/errors';
import { providerFetch } from '../../lib/http';
import { getSecret, getSettings, type GoogleSettings } from '../../services/settings';
import { recordUsage, type UsageContext } from '../../services/cost/usage';

export interface GeminiModelInfo {
  name: string;
  id: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods: string[];
}


const PROVIDER = 'google';
let modelCache: { at: number; keyTail: string; models: GeminiModelInfo[] } | null = null;

async function apiKey(): Promise<string> {
  const key = await getSecret('google', 'apiKey');
  if (!key) throw new MissingCredentialsError('Google AI (Gemini)');
  return key;
}

async function call(path: string, body?: unknown, timeoutMs = 180_000) {
  const key = await apiKey();
  return providerFetch(PROVIDER, `${env.GEMINI_BASE_URL}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-goog-api-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs,
  });
}

/** Live model catalog from models.list (cached 10 minutes per API key). */
export async function listModels(force = false): Promise<GeminiModelInfo[]> {
  const key = await apiKey();
  if (!force && modelCache && modelCache.keyTail === key.slice(-6) && Date.now() - modelCache.at < 600_000) return modelCache.models;
  const models: GeminiModelInfo[] = [];
  let pageToken: string | undefined;
  do {
    const res = await call(`models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    const j = res.json<{ models?: any[]; nextPageToken?: string }>();
    for (const m of j.models ?? []) {
      models.push({
        name: m.name,
        id: String(m.name).replace(/^models\//, ''),
        displayName: m.displayName,
        description: m.description,
        inputTokenLimit: m.inputTokenLimit,
        outputTokenLimit: m.outputTokenLimit,
        supportedGenerationMethods: m.supportedGenerationMethods ?? m.supportedActions ?? [],
      });
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  modelCache = { at: Date.now(), keyTail: key.slice(-6), models };
  return models;
}

export async function getModel(id: string): Promise<GeminiModelInfo | null> {
  try {
    const m = (await call(`models/${encodeURIComponent(id)}`)).json<any>();
    return {
      name: m.name,
      id: String(m.name).replace(/^models\//, ''),
      displayName: m.displayName,
      inputTokenLimit: m.inputTokenLimit,
      outputTokenLimit: m.outputTokenLimit,
      supportedGenerationMethods: m.supportedGenerationMethods ?? m.supportedActions ?? [],
    };
  } catch (err) {
    if (err instanceof ProviderError && err.httpStatus === 404) return null;
    throw err;
  }
}

function versionOf(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]!) : 0;
}

const NON_TEXT = /embedding|image|imagen|tts|audio|live|omni|veo|robotics|computer|aqa|learnlm|gemma|native/i;

/**
 * Picks a model for a role from the live catalog when the user has not pinned one.
 * Preference: stable over preview/experimental, then highest version. No model ID is hardcoded.
 */
export function chooseModel(models: GeminiModelInfo[], role: ModelRole): string | null {
  const stableScore = (id: string) => (/preview|exp|latest/i.test(id) ? 0 : 1);
  let pool: GeminiModelInfo[];
  if (role === 'embedding') {
    pool = models.filter((m) => m.supportedGenerationMethods.some((g) => /embed/i.test(g)) || /embedding/i.test(m.id));
    pool = pool.filter((m) => /gemini/i.test(m.id));
  } else {
    pool = models.filter((m) => m.supportedGenerationMethods.includes('generateContent') && /gemini/i.test(m.id) && !NON_TEXT.test(m.id));
    if (role === 'text' || role === 'quality' || role === 'ocr' || role === 'light') {
      const flash = pool.filter((m) => /flash/i.test(m.id) && !/lite/i.test(m.id));
      if (flash.length) pool = flash;
    } else {
      const strong = pool.filter((m) => !/lite/i.test(m.id));
      if (strong.length) pool = strong;
    }
  }
  pool.sort((a, b) => stableScore(b.id) - stableScore(a.id) || versionOf(b.id) - versionOf(a.id) || a.id.length - b.id.length);
  return pool[0]?.id ?? null;
}

const ROLE_FIELD: Record<ModelRole, keyof GoogleSettings> = {
  text: 'textModel',
  light: 'textModel',
  analysis: 'analysisModel',
  quality: 'qualityModel',
  ocr: 'ocrModel',
  embedding: 'embeddingModel',
};

export async function resolveModel(role: ModelRole): Promise<string> {
  const s = await getSettings('google');
  const pinned = s[ROLE_FIELD[role]] as string;
  if (pinned) return pinned;
  const chosen = chooseModel(await listModels(), role);
  if (!chosen) throw new ProviderError(`No Gemini model available for role "${role}" with this API key`, PROVIDER, false);
  return chosen;
}

// ------------------------------------------------------------------ structured generation

type SchemaMode = 'responseJsonSchema' | 'responseFormat' | 'promptOnly';
let workingMode: SchemaMode | null = null;

function generationConfig(mode: SchemaMode, schema: object, maxOutputTokens?: number, temperature?: number) {
  const base: Record<string, unknown> = {};
  if (maxOutputTokens) base.maxOutputTokens = maxOutputTokens;
  if (temperature !== undefined) base.temperature = temperature;
  if (mode === 'responseJsonSchema') return { ...base, responseMimeType: 'application/json', responseJsonSchema: schema };
  if (mode === 'responseFormat') return { ...base, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } } };
  return { ...base, responseMimeType: 'application/json' };
}

function extractText(j: any): { text: string; finishReason?: string } {
  const cand = j?.candidates?.[0];
  const parts: any[] = cand?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  return { text, finishReason: cand?.finishReason };
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Model did not return JSON');
  }
}


export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<{ data: T; model: string; cost: number }> {
  const model = opts.model ?? (await resolveModel(opts.role));
  let lastErr: Error | null = null;
  let feedback = '';
  let totalCost = 0;

  for (let validationAttempt = 0; validationAttempt < 2; validationAttempt++) {
    const probing = !workingMode;
    const modes: SchemaMode[] = workingMode ? [workingMode] : ['responseJsonSchema', 'responseFormat', 'promptOnly'];
    for (const mode of modes) {
      const promptText =
        (mode === 'promptOnly' ? `${opts.prompt}\n\nReturn ONLY JSON matching this JSON Schema:\n${JSON.stringify(opts.jsonSchema)}` : opts.prompt) + feedback;
      const parts: any[] = [{ text: promptText }];
      for (const img of opts.images ?? []) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data.toString('base64') } });
      const body = {
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: generationConfig(mode, opts.jsonSchema, opts.maxOutputTokens, opts.temperature),
      };
      let j: any;
      try {
        j = (await call(`models/${encodeURIComponent(model)}:generateContent`, body)).json();
      } catch (err) {
        // Unknown/unsupported field → try the next structured-output dialect.
        if (err instanceof ProviderError && err.httpStatus === 400 && /unknown name|invalid json payload|not supported|responseJsonSchema|responseFormat|schema/i.test(err.message) && mode !== 'promptOnly' && probing) {
          logger.warn({ mode, model }, 'Structured output mode rejected; trying fallback');
          lastErr = err;
          continue;
        }
        throw err;
      }
      const u = j.usageMetadata ?? {};
      totalCost += await recordUsage(
        {
          category: opts.role === 'ocr' ? 'ocr' : 'text',
          provider: PROVIDER,
          model,
          operation: opts.operation,
          inputTokens: u.promptTokenCount ?? 0,
          outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        },
        opts.usage,
      );
      if (j.promptFeedback?.blockReason) {
        throw new ProviderError(`Gemini blocked the prompt: ${j.promptFeedback.blockReason}`, PROVIDER, false, 400, 'BLOCKED');
      }
      const { text, finishReason } = extractText(j);
      if (finishReason === 'MAX_TOKENS') {
        lastErr = new ProviderError('Gemini response truncated (MAX_TOKENS)', PROVIDER, true, undefined, 'TRUNCATED');
        feedback = '\n\nYour previous answer was cut off. Be more concise so the complete JSON fits.';
        break;
      }
      if (finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)) {
        throw new ProviderError(`Gemini stopped with finishReason=${finishReason}`, PROVIDER, finishReason === 'OTHER', undefined, 'FINISH_' + finishReason);
      }
      workingMode = mode;
      try {
        const parsed = opts.validator.safeParse(parseJsonLoose(text));
        if (parsed.success) return { data: parsed.data, model, cost: totalCost };
        lastErr = new Error(`Response failed validation: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      } catch (e) {
        lastErr = e as Error;
      }
      feedback = `\n\nYour previous answer was invalid (${lastErr.message}). Return corrected JSON only.`;
      break;
    }
  }
  throw new ProviderError(`Gemini structured output failed: ${lastErr?.message}`, PROVIDER, true, undefined, 'INVALID_OUTPUT');
}

// ------------------------------------------------------------------ embeddings

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export async function embedTexts(
  texts: string[],
  kind: 'document' | 'query',
  opts: { titles?: string[]; usage?: UsageContext } = {},
): Promise<{ vectors: number[][]; model: string; dimensions: number }> {
  const s = await getSettings('google');
  const model = await resolveModel('embedding');
  const dims = s.embeddingDimensions;
  // gemini-embedding-001 uses task_type; newer models take an instruction prefix instead.
  const usesTaskType = /embedding-00\d/.test(model);
  const requests = texts.map((t, i) => {
    const text = usesTaskType
      ? t
      : kind === 'query'
        ? `task: search result | query: ${t}`
        : `title: ${opts.titles?.[i] || 'none'} | text: ${t}`;
    return {
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: dims,
      ...(usesTaskType ? { taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' } : {}),
    };
  });
  const j = (await call(`models/${encodeURIComponent(model)}:batchEmbedContents`, { requests })).json<any>();
  const vectors: number[][] = (j.embeddings ?? []).map((e: any) => normalize(e.values ?? []));
  if (vectors.length !== texts.length) throw new ProviderError('Embedding count mismatch', PROVIDER, true);
  const tokens = j.usageMetadata?.promptTokenCount ?? Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 3);
  await recordUsage({ category: 'embedding', provider: PROVIDER, model, operation: `embed:${kind}`, inputTokens: tokens }, opts.usage);
  return { vectors, model, dimensions: vectors[0]?.length ?? dims };
}
