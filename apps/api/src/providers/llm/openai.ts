import type { ZodType } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { MissingCredentialsError, ProviderError } from '../../lib/errors';
import { providerFetch } from '../../lib/http';
import { getSecret, getSettings, type OpenAISettings } from '../../services/settings';
import { recordUsage, type UsageContext } from '../../services/cost/usage';
import type { GenerateJsonOptions, ModelRole } from './types';

const PROVIDER = 'openai';

export interface OpenAIModelInfo {
  id: string;
  created: number;
  shutdownDate: string | null;
}

let modelCache: { at: number; keyTail: string; models: OpenAIModelInfo[] } | null = null;

async function apiKey() {
  const k = await getSecret('openai', 'apiKey');
  if (!k) throw new MissingCredentialsError('OpenAI');
  return k;
}

async function call(path: string, body?: unknown, timeoutMs = 300_000) {
  return providerFetch(PROVIDER, `${env.OPENAI_BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${await apiKey()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs,
  });
}

/** Live model list (GET /v1/models exposes only id/created/owned_by/shutdown_date). Cached 10 minutes. */
export async function listModels(force = false): Promise<OpenAIModelInfo[]> {
  const key = await apiKey();
  if (!force && modelCache && modelCache.keyTail === key.slice(-6) && Date.now() - modelCache.at < 600_000) return modelCache.models;
  const j = (await call('/models')).json<{ data: { id: string; created: number; shutdown_date?: string | null }[] }>();
  const models = j.data.map((m) => ({ id: m.id, created: m.created, shutdownDate: m.shutdown_date ?? null }));
  modelCache = { at: Date.now(), keyTail: key.slice(-6), models };
  return models;
}

/**
 * Model families per role, best first. /v1/models has no capability metadata, so the role → family
 * mapping is data (from OpenAI's model guide, 2026-11-02); the concrete ID is the newest live model in
 * that family, skipping dated snapshots, -pro, chat aliases and anything past its shutdown date.
 */
const ROLE_FAMILIES: Record<ModelRole, RegExp[]> = {
  analysis: [/^gpt-[\d.]+-sol$/, /^gpt-[\d.]+-astra$/, /^gpt-[\d.]+$/],
  quality: [/^gpt-[\d.]+-sol$/, /^gpt-[\d.]+-terra$/, /^gpt-[\d.]+$/],
  text: [/^gpt-[\d.]+-terra$/, /^gpt-[\d.]+-sol$/, /^gpt-[\d.]+$/],
  ocr: [/^gpt-[\d.]+-terra$/, /^gpt-[\d.]+-sol$/, /^gpt-[\d.]+$/],
  light: [/^gpt-[\d.]+-luna$/, /^gpt-[\d.]+-mini$/, /^gpt-[\d.]+-terra$/],
  embedding: [/^text-embedding-3-small$/, /^text-embedding-3-large$/],
};

function version(id: string) {
  return parseFloat(id.match(/^gpt-([\d.]+)/)?.[1] ?? '0');
}

export function chooseModel(models: OpenAIModelInfo[], role: ModelRole, today = new Date()): string | null {
  const day = today.toISOString().slice(0, 10);
  const live = models.filter((m) => !m.shutdownDate || m.shutdownDate > day);
  for (const family of ROLE_FAMILIES[role]) {
    const pool = live.filter((m) => family.test(m.id)).sort((a, b) => version(b.id) - version(a.id) || b.created - a.created);
    if (pool[0]) return pool[0].id;
  }
  return null;
}

const ROLE_FIELD: Record<ModelRole, keyof OpenAISettings> = {
  text: 'textModel',
  analysis: 'analysisModel',
  quality: 'qualityModel',
  ocr: 'ocrModel',
  light: 'lightModel',
  embedding: 'embeddingModel',
};

export async function resolveModel(role: ModelRole): Promise<string> {
  const s = await getSettings('openai');
  const pinned = s[ROLE_FIELD[role]] as string;
  if (pinned) return pinned;
  const chosen = chooseModel(await listModels(), role);
  if (!chosen) throw new ProviderError(`No OpenAI model available for role "${role}" with this API key`, PROVIDER, false);
  return chosen;
}

// ------------------------------------------------------------------ structured generation

/**
 * Converts a JSON Schema into the strict-mode subset: every object gets additionalProperties:false and
 * all properties required; keywords strict mode rejects are removed (zod still validates them).
 */
export function toStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (['$schema', 'default', 'minLength', 'maxLength', 'additionalProperties'].includes(k)) continue;
    out[k] = toStrictSchema(v);
  }
  if (out.type === 'object' && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

const EFFORT: Record<ModelRole, string> = { light: 'none', text: 'low', ocr: 'low', quality: 'medium', analysis: 'medium', embedding: 'none' };
// Strict schemas / reasoning efforts some models reject are remembered per model after a 400.
const noStrict = new Set<string>();
const noReasoning = new Set<string>();
const effortOverride = new Map<string, string>();

function outputText(j: any): { text: string; refusal?: string } {
  let text = '';
  let refusal: string | undefined;
  for (const item of j.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text') text += c.text;
      if (c.type === 'refusal') refusal = c.refusal;
    }
  }
  if (!text && typeof j.output_text === 'string') text = j.output_text;
  return { text, refusal };
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  return JSON.parse(t);
}

export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<{ data: T; model: string; cost: number }> {
  const model = opts.model ?? (await resolveModel(opts.role));
  let feedback = '';
  let lastErr: Error | null = null;
  let cost = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const strict = !noStrict.has(model);
    const effort = effortOverride.get(`${model}:${opts.role}`) ?? EFFORT[opts.role];
    const reasoningOn = !noReasoning.has(model);
    const content: any[] = [{ type: 'input_text', text: opts.prompt + feedback }];
    for (const img of opts.images ?? []) content.push({ type: 'input_image', image_url: `data:${img.mimeType};base64,${img.data.toString('base64')}`, detail: 'high' });
    const reserve = reasoningOn && effort !== 'none' ? 16_000 : 0;
    const body: Record<string, unknown> = {
      model,
      instructions: opts.system,
      input: [{ role: 'user', content }],
      max_output_tokens: (opts.maxOutputTokens ?? 8192) + reserve,
      text: { format: { type: 'json_schema', name: 'result', schema: strict ? toStrictSchema(opts.jsonSchema) : opts.jsonSchema, strict } },
      store: false,
    };
    if (reasoningOn) body.reasoning = { effort };

    let j: any;
    try {
      j = (await call('/responses', body)).json();
    } catch (err) {
      if (err instanceof ProviderError && err.httpStatus === 400) {
        const m = err.message.toLowerCase();
        if (/reasoning|effort/.test(m) && reasoningOn) {
          // Unsupported effort for this model: try the model default, then no reasoning field at all.
          if (!effortOverride.has(`${model}:${opts.role}`) && effort !== 'medium') effortOverride.set(`${model}:${opts.role}`, 'medium');
          else noReasoning.add(model);
          logger.warn({ model, effort }, 'Reasoning effort rejected; adjusting');
          continue;
        }
        if (/schema|json_schema|strict/.test(m) && strict) {
          noStrict.add(model);
          logger.warn({ model }, 'Strict schema rejected; using non-strict structured output (validated locally)');
          continue;
        }
      }
      throw err;
    }
    const u = j.usage ?? {};
    const cached = u.input_tokens_details?.cached_tokens ?? 0;
    cost += await recordUsage(
      {
        category: opts.role === 'ocr' ? 'ocr' : 'text',
        provider: PROVIDER,
        model,
        operation: opts.operation,
        inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached),
        cachedInputTokens: cached,
        outputTokens: u.output_tokens ?? 0,
      },
      opts.usage,
    );
    if (j.status === 'incomplete') {
      const reason = j.incomplete_details?.reason;
      if (reason === 'content_filter') throw new ProviderError('OpenAI filtered the response (content_filter)', PROVIDER, false, undefined, 'BLOCKED');
      lastErr = new ProviderError(`OpenAI response incomplete (${reason})`, PROVIDER, true, undefined, 'TRUNCATED');
      feedback = '\n\nYour previous answer was cut off. Be more concise so the complete JSON fits.';
      continue;
    }
    const { text, refusal } = outputText(j);
    if (refusal) throw new ProviderError(`OpenAI refused: ${refusal.slice(0, 300)}`, PROVIDER, false, undefined, 'REFUSED');
    try {
      const parsed = opts.validator.safeParse(parseJson(text));
      if (parsed.success) return { data: parsed.data, model, cost };
      lastErr = new Error(`Response failed validation: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    } catch (e) {
      lastErr = e as Error;
    }
    feedback = `\n\nYour previous answer was invalid (${lastErr.message}). Return corrected JSON only.`;
  }
  throw new ProviderError(`OpenAI structured output failed: ${lastErr?.message ?? 'unknown error'}`, PROVIDER, true, undefined, 'INVALID_OUTPUT');
}

// ------------------------------------------------------------------ embeddings

export async function embedTexts(
  texts: string[],
  opts: { model?: string; usage?: UsageContext } = {},
): Promise<{ vectors: number[][]; model: string; dimensions: number }> {
  const s = await getSettings('openai');
  const model = opts.model ?? (await resolveModel('embedding'));
  const vectors: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += 512) {
    const batch = texts.slice(i, i + 512).map((t) => t.trim() || ' ');
    const j = (await call('/embeddings', { model, input: batch, dimensions: s.embeddingDimensions, encoding_format: 'float' })).json<any>();
    const rows = [...j.data].sort((a: any, b: any) => a.index - b.index);
    for (const r of rows) {
      const n = Math.sqrt(r.embedding.reduce((a: number, x: number) => a + x * x, 0)) || 1;
      vectors.push(r.embedding.map((x: number) => x / n));
    }
    tokens += j.usage?.prompt_tokens ?? 0;
  }
  if (vectors.length !== texts.length) throw new ProviderError('Embedding count mismatch', PROVIDER, true);
  await recordUsage({ category: 'embedding', provider: PROVIDER, model, operation: 'embed', inputTokens: tokens }, opts.usage);
  return { vectors, model, dimensions: vectors[0]?.length ?? s.embeddingDimensions };
}

export function isOpenAIModel(model: string) {
  return /^(gpt-|o\d|text-embedding-|chatgpt)/.test(model);
}

export type { ZodType };
