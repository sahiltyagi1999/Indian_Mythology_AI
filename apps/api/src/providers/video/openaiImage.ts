import { env } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import { providerFetch } from '../../lib/http';
import { getSecret } from '../../services/settings';
import { lookupPrice } from '../../services/cost/pricing';
import { recordUsage, type UsageContext } from '../../services/cost/usage';
import { listModels } from '../llm/openai';
import type { VideoCapabilities, VideoGenerationRequest, VideoJobHandle, VideoProvider } from './types';

export const OPENAI_IMAGE_PROVIDER_ID = 'openai-image';
export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

const PROVIDER = 'openai';
const DOCS = 'https://developers.openai.com/api/docs/guides/image-generation';
// Cheapest portrait size with published per-image prices; the still is cropped to fill 9:16 when animated.
const SIZE = '1024x1536';
/**
 * Approximate image output tokens at 1024x1536, derived from OpenAI's per-image table for gpt-image-2
 * ($0.005 / $0.041 / $0.165 at $30 per 1M output tokens, read 2026-11-03). Used for estimates only;
 * actual cost comes from the usage the API returns.
 */
const EST_OUTPUT_TOKENS: Record<ImageQuality, number> = { low: 170, medium: 1370, high: 5500 };
const EST_PROMPT_TOKENS = 400;

async function apiKey() {
  const k = await getSecret('openai', 'apiKey');
  if (!k) throw new ProviderError('OpenAI API key is missing', PROVIDER, false, undefined, 'AUTH');
  return k;
}

function version(id: string) {
  return parseFloat(id.match(/^gpt-image-([\d.]+)/)?.[1] ?? '0');
}

/** Newest plain gpt-image model on the key that is not past its shutdown date. */
export async function resolveImageModel(): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const pool = (await listModels())
    .filter((m) => /^gpt-image-[\d.]+$/.test(m.id) && (!m.shutdownDate || m.shutdownDate > day))
    .sort((a, b) => version(b.id) - version(a.id) || b.created - a.created);
  if (!pool[0]) throw new ProviderError('No gpt-image model is available to this OpenAI key', PROVIDER, false, undefined, 'NO_VIDEO_MODEL');
  return pool[0].id;
}

/**
 * Scene prompts are written for video and can span two beats of narration; without guidance the image model
 * stacks them as a two-panel picture. Ask for one continuous frame of the main moment and drop the camera move.
 */
export function stillPrompt(prompt: string, avoid?: string) {
  return [
    'Create ONE single continuous cinematic frame: one shot, one place, one moment, filling the whole canvas edge to edge. Never a collage, split-screen, diptych, comic panels, frames within the frame, borders or several separate pictures.',
    'Vertical portrait format, main subject centred with the key action in the middle of the frame (the sides may be cropped). No text, captions, logos or watermarks.',
    'If the description below mentions several moments, show only the most important one.',
    prompt
      .split('\n')
      // Continuity notes and the narration line can name the next moment, which invites a second panel.
      .filter((l) => !/^(Continuity:|The scene illustrates this narration)/.test(l))
      .join('\n')
      .replace(/\{\{REF:[^}]+\}\}/g, '')
      .replace(/ Camera: [^.]*\./, '')
      // Older plans describe a second shot; a still keeps only the first.
      .replace(/\s*(?:Then )?[Cc]ut (?:forward |back |away )?to [^.]*\./g, '')
      .replace(/, then [^.\n]*(?=\.)/g, ''),
    avoid ? `Avoid: ${avoid}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Automatic stills: one gpt-image picture per scene, turned locally into a slow push-in clip. Much cheaper
 * than generated video; motion comes only from the zoom. Usage is recorded from the tokens the API reports.
 */
export class OpenAIImageVideoProvider implements VideoProvider {
  readonly id = OPENAI_IMAGE_PROVIDER_ID;
  readonly label = 'OpenAI images (automatic stills with slow zoom)';

  async getCapabilities(model: string): Promise<VideoCapabilities> {
    return {
      provider: this.id,
      model,
      displayName: `${model} stills`,
      aspectRatios: ['9:16'],
      minClipSeconds: 3,
      maxClipSeconds: 8,
      durationControl: 'parameter',
      resolutions: ['720p', '1080p'],
      referenceImages: { supported: false, max: 0 },
      generatesAudio: false,
      synchronous: true,
      watermark: 'OpenAI adds C2PA provenance metadata to generated images (no visible watermark).',
      visibleWatermark: false,
      requiresPaidTier: true,
      notes: ['One 1024×1536 image per scene, cropped to 9:16 and animated with a smooth slow zoom; quality low / medium / high changes cost about 30×.'],
      verifiedAt: '2026-11-03',
      docsUrl: DOCS,
    };
  }

  async checkAvailability(model: string) {
    try {
      const ok = (await listModels()).some((m) => m.id === model);
      return ok ? { available: true, message: `${model} is available to this OpenAI key.` } : { available: false, message: `${model} is not listed for this OpenAI key.` };
    } catch (err) {
      return { available: false, message: (err as Error).message };
    }
  }

  async generateVideo(model: string, req: VideoGenerationRequest, ctx?: UsageContext): Promise<VideoJobHandle> {
    const quality = (req.quality as ImageQuality) ?? 'low';
    const r = await providerFetch(PROVIDER, `${env.OPENAI_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await apiKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: stillPrompt(req.prompt, req.avoid), size: SIZE, quality, n: 1, output_format: 'png', moderation: 'low' }),
      timeoutMs: 300_000,
    }).catch((err) => {
      if (err instanceof ProviderError && err.httpStatus === 400 && /moderation|safety/i.test(err.message)) {
        throw new ProviderError(`Image blocked by OpenAI safety system: ${err.message}`, PROVIDER, false, 400, 'BLOCKED');
      }
      throw err;
    });
    const j = r.json<any>();
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError('OpenAI returned no image', PROVIDER, true, undefined, 'EMPTY');
    const u = j.usage ?? {};
    const cost = await recordUsage(
      { category: 'video', provider: PROVIDER, model, operation: `image:${quality}`, inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 },
      ctx,
    );
    // The pipeline stores the image and animates it at the render frame rate.
    return { providerJobId: j.created ? `img_${j.created}` : 'img', status: 'completed', inline: { data: Buffer.from(b64, 'base64'), mimeType: 'image/png' }, meta: { cost, quality } };
  }

  async checkStatus(_model: string, handle: VideoJobHandle): Promise<VideoJobHandle> {
    return handle;
  }

  async downloadVideo(handle: VideoJobHandle): Promise<Buffer> {
    if (!handle.inline) throw new ProviderError('No image clip in the response', PROVIDER, true);
    return handle.inline.data;
  }

  /** Per scene image, not per second. */
  async estimateCost(model: string, _seconds: number, _resolution: string, quality: string = 'low') {
    const [inP, outP] = await Promise.all([
      lookupPrice({ provider: PROVIDER, model, unit: 'input_1m_tokens' }),
      lookupPrice({ provider: PROVIDER, model, unit: 'output_1m_tokens' }),
    ]);
    if (outP.price === null) return { amount: null, unitPrice: null, unit: 'image', note: `No price for ${model}; add it in Settings → Pricing` };
    const q: ImageQuality = (IMAGE_QUALITIES as readonly string[]).includes(quality) ? (quality as ImageQuality) : 'low';
    const per = (EST_PROMPT_TOKENS * (inP.price ?? 0) + EST_OUTPUT_TOKENS[q] * outP.price) / 1e6;
    return { amount: per, unitPrice: per, unit: 'image' };
  }
}
