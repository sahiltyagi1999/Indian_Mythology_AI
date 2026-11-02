import { env } from '../../config/env';
import { MissingCredentialsError, ProviderError } from '../../lib/errors';
import { providerFetch } from '../../lib/http';
import { getSecret, getSettings, type ElevenLabsSettings } from '../../services/settings';

const PROVIDER = 'elevenlabs';

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface TtsResult {
  audio: Buffer;
  alignment: Alignment | null;
  model: string;
  characters: number;
  requestId?: string;
}

export interface ElevenModel {
  model_id: string;
  name: string;
  can_do_text_to_speech: boolean;
  maximum_text_length_per_request?: number;
  languages: { language_id: string; name: string }[];
  model_rates?: { character_cost_multiplier?: number };
}

async function apiKey() {
  const key = await getSecret('elevenlabs', 'apiKey');
  if (!key) throw new MissingCredentialsError('ElevenLabs');
  return key;
}

async function call(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
  const key = await apiKey();
  return providerFetch(PROVIDER, `${env.ELEVENLABS_BASE_URL}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'xi-api-key': key, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    timeoutMs: init.timeoutMs ?? 120_000,
  });
}

export async function listModels(): Promise<ElevenModel[]> {
  return (await call('/v1/models')).json<ElevenModel[]>();
}

export async function listVoices(search?: string) {
  const voices: any[] = [];
  let token: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ page_size: '100', ...(search ? { search } : {}), ...(token ? { next_page_token: token } : {}) });
    const j = (await call(`/v2/voices?${qs}`)).json<any>();
    voices.push(...(j.voices ?? []));
    if (!j.has_more || !j.next_page_token) break;
    token = j.next_page_token;
  }
  return voices.map((v) => ({
    voiceId: v.voice_id as string,
    name: v.name as string,
    category: v.category as string,
    labels: (v.labels ?? {}) as Record<string, string>,
    previewUrl: v.preview_url as string | undefined,
    languages: ((v.verified_languages ?? []) as any[]).map((l) => l.language as string),
  }));
}

export async function subscription() {
  const j = (await call('/v1/user/subscription')).json<any>();
  return {
    tier: j.tier as string,
    status: j.status as string,
    characterCount: j.character_count as number,
    characterLimit: j.character_limit as number,
    remaining: (j.character_limit ?? 0) - (j.character_count ?? 0),
    resetsAt: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toISOString() : null,
  };
}

/** Chooses a Hindi-capable TTS model from the live model list when none is pinned in settings. */
export async function resolveTtsModel(settings?: ElevenLabsSettings): Promise<string> {
  const s = settings ?? (await getSettings('elevenlabs'));
  if (s.model) return s.model;
  const models = await listModels();
  const hindi = models.filter((m) => m.can_do_text_to_speech && m.languages?.some((l) => l.language_id === s.languageCode));
  // Prefer the flagship expressive models over flash/turbo variants for storytelling quality.
  const rank = (id: string) => (/turbo|flash|conversational/.test(id) ? 0 : 1);
  const ver = (id: string) => parseFloat(id.match(/v(\d+(?:\.\d+)?)/)?.[1] ?? '0');
  hindi.sort((a, b) => rank(b.model_id) - rank(a.model_id) || ver(b.model_id) - ver(a.model_id));
  if (!hindi[0]) throw new ProviderError(`No ElevenLabs model supports language "${s.languageCode}"`, PROVIDER, false);
  return hindi[0].model_id;
}

/**
 * Converts narration to speech with character-level timestamps (used for subtitles and scene sync).
 * `language_code` is omitted for multilingual_v2, which the API documents as unsupported.
 */
export async function textToSpeech(
  text: string,
  opts: { voiceId: string; model: string; settings: Pick<ElevenLabsSettings, 'stability' | 'similarityBoost' | 'style' | 'speed' | 'useSpeakerBoost' | 'languageCode' | 'outputFormat'>; seed?: number },
): Promise<TtsResult> {
  if (!opts.voiceId) throw new ProviderError('No ElevenLabs voice selected. Choose a narrator voice in settings or the Video Studio.', PROVIDER, false, undefined, 'NO_VOICE');
  const body: Record<string, unknown> = {
    text,
    model_id: opts.model,
    voice_settings: {
      stability: opts.settings.stability,
      similarity_boost: opts.settings.similarityBoost,
      style: opts.settings.style,
      use_speaker_boost: opts.settings.useSpeakerBoost,
      speed: opts.settings.speed,
    },
    apply_text_normalization: 'auto',
  };
  if (opts.seed !== undefined) body.seed = opts.seed;
  if (opts.settings.languageCode && !/multilingual_v2/.test(opts.model)) body.language_code = opts.settings.languageCode;
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=${encodeURIComponent(opts.settings.outputFormat)}`, {
    body,
    timeoutMs: 300_000,
  });
  const j = res.json<any>();
  if (!j.audio_base64) throw new ProviderError('ElevenLabs returned no audio', PROVIDER, true);
  return {
    audio: Buffer.from(j.audio_base64, 'base64'),
    alignment: j.alignment ?? j.normalized_alignment ?? null,
    model: opts.model,
    characters: text.length,
    requestId: res.headers.get('request-id') ?? undefined,
  };
}
