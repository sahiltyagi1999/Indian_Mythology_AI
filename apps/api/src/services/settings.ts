import { ProviderConfigurationModel } from '../models';
import { decryptSecret, encryptSecret, maskSecret } from '../lib/crypto';
import { env } from '../config/env';
import { registerSecret } from '../config/logger';
import type { ProviderKey } from '@mas/shared';

export interface GoogleSettings {
  /** Empty string = auto-select from the live models.list response. */
  textModel: string;
  analysisModel: string;
  qualityModel: string;
  ocrModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  videoProvider: string;
  videoModel: string;
  videoResolution: '720p' | '1080p';
}

export interface OpenAISettings {
  /** Empty string = auto-select the newest model of the role's family from the live model list. */
  textModel: string;
  analysisModel: string;
  qualityModel: string;
  ocrModel: string;
  lightModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface LlmSettings {
  /** Provider for all text work (story engine, Hinglish, scene planning, OCR, embeddings). Video is separate. */
  provider: 'openai' | 'google';
}

export interface ElevenLabsSettings {
  voiceId: string;
  model: string;
  languageCode: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
  outputFormat: string;
}

export interface PricingEntry {
  provider: string;
  /** Exact model id, or a prefix ending in '*'. */
  model: string;
  category: 'text' | 'embedding' | 'narration' | 'video' | 'ocr';
  /** 'input_1m_tokens' | 'output_1m_tokens' | '1k_characters' | 'second' */
  unit: string;
  price: number;
  /** Optional variant such as a video resolution. */
  variant?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  source: string;
  verified: boolean;
  note?: string;
}

export interface PricingSettings {
  currency: 'USD';
  verifiedAt: string;
  staleAfterDays: number;
  entries: PricingEntry[];
}

export interface BudgetSettings {
  dailyLimit: number | null;
  monthlyLimit: number | null;
  maxCostPerEpisode: number | null;
}

export interface RenderSettings {
  targetDuration: number;
  durationTolerance: number;
  fps: number;
  crf: number;
  preset: string;
  transition: string;
  transitionDuration: number;
  musicVolume: number;
  sfxIntensity: number;
  narrationLoudnessLufs: number;
  logoKey: string;
  logoPosition: 'top-left' | 'top-right';
  subtitles: {
    font: string;
    fontSize: number;
    textColor: string;
    highlightColor: string;
    backgroundOpacity: number;
    positionFromBottom: number;
    animation: 'none' | 'pop' | 'karaoke' | 'fade';
  };
  maxSpeedAdjust: number;
}

export interface StorySettings {
  chunkChars: number;
  chunkOverlapChars: number;
  segmentChars: number;
  /** Outline segments analysed in parallel. */
  outlineConcurrency: number;
  planningWindowEvents: number;
  scriptConcurrency: number;
  qualityThreshold: number;
  maxScriptAttempts: number;
  duplicateSimilarity: number;
  /** Learned from real narration audio; used to estimate spoken duration before audio exists. */
  syllablesPerSecond: number;
  calibrationSamples: number;
  /** 'llm' = vision model of the active text provider ('gemini' is the legacy name for the same). */
  ocrEngine: 'llm' | 'gemini' | 'tesseract';
}

export interface SettingsMap {
  llm: LlmSettings;
  openai: OpenAISettings;
  google: GoogleSettings;
  elevenlabs: ElevenLabsSettings;
  pricing: PricingSettings;
  budget: BudgetSettings;
  render: RenderSettings;
  story: StorySettings;
  storage: Record<string, never>;
}

const GOOGLE_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing';
const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing';
const oai = (model: string, input: number, cached: number, output: number, note?: string): PricingEntry[] => [
  { provider: 'openai', model, category: 'text', unit: 'input_1m_tokens', price: input, source: OPENAI_PRICING_URL, verified: true, note },
  { provider: 'openai', model, category: 'text', unit: 'cached_input_1m_tokens', price: cached, source: OPENAI_PRICING_URL, verified: true, note },
  { provider: 'openai', model, category: 'text', unit: 'output_1m_tokens', price: output, source: OPENAI_PRICING_URL, verified: true, note },
];
const LONG = 'Standard rate for prompts ≤272K input tokens (longer prompts bill 2× input, 1.5× output)';
const ELEVEN_PRICING_URL = 'https://elevenlabs.io/pricing/api';

/**
 * Prices as published on the providers' official pricing pages, verified 2026-11-02.
 * They are data, not code: editable in Settings, and the UI flags them once older than staleAfterDays.
 */
export const DEFAULT_PRICING: PricingSettings = {
  currency: 'USD',
  verifiedAt: '2026-11-02',
  staleAfterDays: 30,
  entries: [
    { provider: 'google', model: 'gemini-4-argon', category: 'text', unit: 'input_1m_tokens', price: 2.0, effectiveTo: '2026-11-30', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-4-argon', category: 'text', unit: 'output_1m_tokens', price: 10.0, effectiveTo: '2026-11-30', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-4-argon', category: 'text', unit: 'input_1m_tokens', price: 4.0, effectiveFrom: '2026-12-01', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-4-argon', category: 'text', unit: 'output_1m_tokens', price: 20.0, effectiveFrom: '2026-12-01', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.8-flash', category: 'text', unit: 'input_1m_tokens', price: 0.75, effectiveTo: '2026-12-31', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.8-flash', category: 'text', unit: 'output_1m_tokens', price: 3.75, effectiveTo: '2026-12-31', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.8-flash', category: 'text', unit: 'input_1m_tokens', price: 1.5, effectiveFrom: '2027-01-01', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.8-flash', category: 'text', unit: 'output_1m_tokens', price: 7.5, effectiveFrom: '2027-01-01', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.6-flash', category: 'text', unit: 'input_1m_tokens', price: 0.75, effectiveTo: '2026-12-31', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.6-flash', category: 'text', unit: 'output_1m_tokens', price: 3.75, effectiveTo: '2026-12-31', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.6-flash', category: 'text', unit: 'input_1m_tokens', price: 1.5, effectiveFrom: '2027-01-01', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.6-flash', category: 'text', unit: 'output_1m_tokens', price: 7.5, effectiveFrom: '2027-01-01', source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.5-flash-lite', category: 'text', unit: 'input_1m_tokens', price: 0.3, source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.5-flash-lite', category: 'text', unit: 'output_1m_tokens', price: 2.5, source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.1-flash-lite', category: 'text', unit: 'input_1m_tokens', price: 0.25, source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.1-flash-lite', category: 'text', unit: 'output_1m_tokens', price: 1.5, source: GOOGLE_PRICING_URL, verified: true },
    { provider: 'google', model: 'gemini-3.1-pro-preview', category: 'text', unit: 'input_1m_tokens', price: 2.0, source: GOOGLE_PRICING_URL, verified: true, note: '≤200k-token prompts; $4.00 above' },
    { provider: 'google', model: 'gemini-3.1-pro-preview', category: 'text', unit: 'output_1m_tokens', price: 12.0, source: GOOGLE_PRICING_URL, verified: true, note: '≤200k-token prompts; $18.00 above' },
    { provider: 'google', model: 'gemini-embedding-2', category: 'embedding', unit: 'input_1m_tokens', price: 0.2, source: GOOGLE_PRICING_URL, verified: false, note: 'Read from a truncated page section; confirm on the pricing page' },
    { provider: 'google', model: 'gemini-embedding-001', category: 'embedding', unit: 'input_1m_tokens', price: 0.15, source: GOOGLE_PRICING_URL, verified: false, note: 'Read from a truncated page section; confirm on the pricing page' },
    {
      provider: 'google', model: 'gemini-omni-1.1-flash', category: 'video', unit: 'second', variant: '720p', price: 0.1014,
      source: GOOGLE_PRICING_URL, verified: true, note: '$17.50 / 1M output tokens × 5,792 tokens per second of 720p video',
    },
    {
      provider: 'google', model: 'gemini-omni-1.1-flash', category: 'video', unit: 'second', variant: '1080p', price: 0.1014,
      source: GOOGLE_PRICING_URL, verified: false, note: 'Google does not publish a 1080p (upscaled) rate; assumed equal to 720p — verify against billing',
    },
    { provider: 'google', model: 'gemini-omni-1.1-flash', category: 'video', unit: 'input_1m_tokens', price: 1.5, source: GOOGLE_PRICING_URL, verified: true },
    ...oai('gpt-6-astra', 10, 1, 50, LONG),
    ...oai('gpt-6.1-sol', 2, 0.1, 10, LONG),
    ...oai('gpt-6.1-terra', 1, 0.05, 5, LONG),
    ...oai('gpt-6-luna', 0.1, 0.01, 0.5, LONG),
    ...oai('gpt-6-sol', 2, 0.2, 10),
    ...oai('gpt-5.6-sol', 4, 0.4, 20, 'Promotional pricing through at least 2026-11-21; post-promo price unpublished'),
    ...oai('gpt-5.6-terra', 2, 0.2, 12),
    ...oai('gpt-5.6-luna', 0.2, 0.02, 1.2),
    ...oai('gpt-5.4-mini', 0.75, 0.075, 4.5),
    { provider: 'openai', model: 'text-embedding-3-small', category: 'embedding', unit: 'input_1m_tokens', price: 0.02, source: OPENAI_PRICING_URL, verified: true },
    { provider: 'openai', model: 'text-embedding-3-large', category: 'embedding', unit: 'input_1m_tokens', price: 0.13, source: OPENAI_PRICING_URL, verified: true },
    { provider: 'elevenlabs', model: 'eleven_v4', category: 'narration', unit: '1k_characters', price: 0.08, source: ELEVEN_PRICING_URL, verified: true },
    { provider: 'elevenlabs', model: 'eleven_v4_turbo', category: 'narration', unit: '1k_characters', price: 0.04, source: ELEVEN_PRICING_URL, verified: true },
    { provider: 'elevenlabs', model: 'eleven_v3', category: 'narration', unit: '1k_characters', price: 0.08, source: ELEVEN_PRICING_URL, verified: true },
    { provider: 'elevenlabs', model: 'eleven_v3_conversational', category: 'narration', unit: '1k_characters', price: 0.04, source: ELEVEN_PRICING_URL, verified: true },
    { provider: 'elevenlabs', model: 'eleven_multilingual_v2', category: 'narration', unit: '1k_characters', price: 0.08, source: ELEVEN_PRICING_URL, verified: true },
    { provider: 'elevenlabs', model: 'eleven_flash_v2_5', category: 'narration', unit: '1k_characters', price: 0.04, source: ELEVEN_PRICING_URL, verified: true },
  ],
};

export const DEFAULTS: SettingsMap = {
  llm: { provider: 'openai' },
  openai: {
    textModel: '',
    analysisModel: '',
    qualityModel: '',
    ocrModel: '',
    lightModel: '',
    embeddingModel: '',
    embeddingDimensions: 768,
  },
  google: {
    textModel: '',
    analysisModel: '',
    qualityModel: '',
    ocrModel: '',
    embeddingModel: '',
    embeddingDimensions: 768,
    videoProvider: 'gemini-omni',
    videoModel: '',
    videoResolution: '720p',
  },
  elevenlabs: {
    voiceId: '',
    model: '',
    languageCode: 'hi',
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.35,
    speed: 0.95,
    useSpeakerBoost: true,
    outputFormat: 'mp3_44100_128',
  },
  pricing: DEFAULT_PRICING,
  budget: { dailyLimit: null, monthlyLimit: null, maxCostPerEpisode: null },
  render: {
    targetDuration: 55,
    durationTolerance: 5,
    fps: 30,
    crf: 18,
    preset: 'medium',
    transition: 'fade',
    transitionDuration: 0.4,
    musicVolume: 0.18,
    sfxIntensity: 0.25,
    narrationLoudnessLufs: -14,
    logoKey: '',
    logoPosition: 'top-right',
    subtitles: {
      font: 'Kohinoor Devanagari',
      fontSize: 64,
      textColor: '#FFFFFF',
      highlightColor: '#FFC83D',
      backgroundOpacity: 0.45,
      positionFromBottom: 0.24,
      animation: 'pop',
    },
    maxSpeedAdjust: 0.06,
  },
  story: {
    chunkChars: 3500,
    chunkOverlapChars: 500,
    segmentChars: 150000,
    outlineConcurrency: 4,
    planningWindowEvents: 60,
    scriptConcurrency: 2,
    qualityThreshold: 7,
    maxScriptAttempts: 3,
    duplicateSimilarity: 0.93,
    syllablesPerSecond: 5.2,
    calibrationSamples: 0,
    ocrEngine: 'llm',
  },
  storage: {},
};

const SECRET_NAMES: Partial<Record<ProviderKey, string[]>> = {
  google: ['apiKey'],
  openai: ['apiKey'],
  elevenlabs: ['apiKey'],
};

const ENV_SECRETS: Partial<Record<ProviderKey, Record<string, string | undefined>>> = {
  google: { apiKey: env.GEMINI_API_KEY },
  openai: { apiKey: env.OPENAI_API_KEY },
  elevenlabs: { apiKey: env.ELEVENLABS_API_KEY },
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const b = out[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(b, v) : v;
  }
  return out as T;
}

const priceKey = (e: PricingEntry) => [e.provider, e.model, e.unit, e.variant ?? '', e.effectiveFrom ?? '', e.effectiveTo ?? ''].join('|');

export async function ensureDefaultConfigs() {
  for (const key of Object.keys(DEFAULTS) as (keyof SettingsMap)[]) {
    await ProviderConfigurationModel.updateOne({ key }, { $setOnInsert: { key, settings: DEFAULTS[key] } }, { upsert: true });
  }
  // Catalog migration: add price entries introduced after the catalog was first saved (e.g. a new provider).
  // Existing entries — including the user's edits — are never changed.
  const stored = await getSettings('pricing');
  const have = new Set(stored.entries.map(priceKey));
  const missing = DEFAULT_PRICING.entries.filter((e) => !have.has(priceKey(e)) && !stored.entries.some((s) => s.provider === e.provider && s.model === e.model && s.unit === e.unit && (s.variant ?? '') === (e.variant ?? '')));
  if (missing.length) await updateSettings('pricing', { entries: [...stored.entries, ...missing] });
}

export async function getSettings<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
  const doc = await ProviderConfigurationModel.findOne({ key }).lean();
  return deepMerge(DEFAULTS[key], doc?.settings ?? {});
}

export async function updateSettings<K extends keyof SettingsMap>(key: K, patch: Partial<SettingsMap[K]>): Promise<SettingsMap[K]> {
  const current = await getSettings(key);
  // Arrays (e.g. pricing entries) are replaced wholesale by deepMerge.
  const next = deepMerge(current, patch);
  await ProviderConfigurationModel.updateOne({ key }, { $set: { settings: next } }, { upsert: true });
  return next;
}

/** Secrets resolve from encrypted MongoDB storage first, then environment variables. Server-side only. */
export async function getSecret(key: ProviderKey, name: string): Promise<string | undefined> {
  const doc = await ProviderConfigurationModel.findOne({ key }).select('secrets').lean();
  const stored = (doc?.secrets as Record<string, { iv: string; tag: string; data: string }> | undefined)?.[name];
  const value = stored?.data ? decryptSecret(stored) : ENV_SECRETS[key]?.[name] || undefined;
  registerSecret(value);
  return value;
}

export async function setSecret(key: ProviderKey, name: string, value: string | null) {
  if (!SECRET_NAMES[key]?.includes(name)) throw new Error(`Unknown secret ${key}.${name}`);
  if (value === null || value === '') {
    await ProviderConfigurationModel.updateOne({ key }, { $unset: { [`secrets.${name}`]: 1 } });
  } else {
    await ProviderConfigurationModel.updateOne({ key }, { $set: { [`secrets.${name}`]: encryptSecret(value.trim()) } }, { upsert: true });
  }
}

/** What the UI may see about secrets: masked value and where it came from. */
export async function describeSecrets(key: ProviderKey) {
  const out: Record<string, { configured: boolean; masked: string | null; origin: 'database' | 'environment' | null }> = {};
  const doc = await ProviderConfigurationModel.findOne({ key }).select('secrets').lean();
  for (const name of SECRET_NAMES[key] ?? []) {
    const stored = (doc?.secrets as Record<string, { iv: string; tag: string; data: string }> | undefined)?.[name];
    if (stored?.data) out[name] = { configured: true, masked: maskSecret(decryptSecret(stored)), origin: 'database' };
    else if (ENV_SECRETS[key]?.[name]) out[name] = { configured: true, masked: maskSecret(ENV_SECRETS[key]![name]), origin: 'environment' };
    else out[name] = { configured: false, masked: null, origin: null };
  }
  return out;
}
