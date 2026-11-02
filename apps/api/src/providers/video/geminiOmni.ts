import { env } from '../../config/env';
import { MissingCredentialsError, ProviderError } from '../../lib/errors';
import { providerFetch } from '../../lib/http';
import { getSecret } from '../../services/settings';
import { lookupPrice } from '../../services/cost/pricing';
import { getModel } from '../llm/gemini';
import type { VideoCapabilities, VideoGenerationRequest, VideoJobHandle, VideoProvider } from './types';

const PROVIDER = 'google';
const DOCS = 'https://ai.google.dev/gemini-api/docs/omni';

async function key() {
  const k = await getSecret('google', 'apiKey');
  if (!k) throw new MissingCredentialsError('Google AI (Gemini)');
  return k;
}

function fileIdFromUri(uri: string): string | null {
  const m = uri.match(/files\/([^/:?]+)/);
  return m?.[1] ?? null;
}

/**
 * Google video generation through the Gemini API Interactions endpoint (gemini-omni family).
 * Verified against ai.google.dev on 2026-11-02: POST /v1beta/interactions with response_format.type="video",
 * aspect_ratio "9:16" | "16:9", resolution 360p/720p/1080p(upscaled)/4k(upscaled), 3–10 s clips at 24 fps,
 * paid tier only, available in India, reference images addressed in the prompt as <IMAGE_REF_n>.
 * Veo models were shut down on the Gemini API (2026-06-30 / 2026-10-22) and are intentionally not targeted.
 */
export class GeminiOmniVideoProvider implements VideoProvider {
  readonly id = 'gemini-omni';
  readonly label = 'Google Gemini Omni (Gemini API · Interactions)';

  async getCapabilities(model: string): Promise<VideoCapabilities> {
    return {
      provider: this.id,
      model,
      displayName: model,
      aspectRatios: ['9:16', '16:9'],
      minClipSeconds: 3,
      maxClipSeconds: 10,
      durationControl: 'prompt',
      resolutions: ['360p', '720p', '1080p', '4k'],
      referenceImages: { supported: true, max: 3 },
      generatesAudio: true,
      synchronous: true,
      watermark: 'SynthID invisible watermark embedded by Google (no visible watermark). Do not attempt to remove it.',
      visibleWatermark: false,
      requiresPaidTier: true,
      notes: [
        'Clip length is chosen by the model (3–10 s); the editor trims or holds frames to match narration.',
        '1080p and 4k are upscaled by Google; 720p is native.',
        'Negative prompts are not a separate field; avoidance guidance is written into the prompt.',
        'Reference-image limit is conservatively set to 3 (Google docs do not state a maximum).',
      ],
      verifiedAt: '2026-11-02',
      docsUrl: DOCS,
    };
  }

  async checkAvailability(model: string) {
    try {
      const m = await getModel(model);
      if (!m) return { available: false, message: `Model "${model}" is not available to this API key (models.get returned 404). It may be shut down or require the paid tier.` };
      return { available: true, message: `${m.displayName ?? model} is reachable with the configured key.` };
    } catch (err) {
      return { available: false, message: (err as Error).message };
    }
  }

  async generateVideo(model: string, req: VideoGenerationRequest): Promise<VideoJobHandle> {
    const input: any[] = [];
    let prompt = req.prompt;
    (req.referenceImages ?? []).forEach((img, i) => {
      input.push({ type: 'image', data: img.data.toString('base64'), mime_type: img.mimeType });
      prompt = prompt.split(`{{REF:${img.label}}}`).join(`<IMAGE_REF_${i}>`);
    });
    prompt = prompt.replace(/\{\{REF:[^}]+\}\}/g, '');
    const fullPrompt = `${prompt}\nTarget clip length: about ${Math.round(req.durationSeconds)} seconds. Vertical ${req.aspectRatio} framing with the subject centred in the upper two-thirds.${req.avoid ? `\nAvoid: ${req.avoid}.` : ''}`;
    input.unshift({ type: 'text', text: fullPrompt });

    const body = {
      model,
      input,
      response_format: { type: 'video', aspect_ratio: req.aspectRatio, resolution: req.resolution, delivery: 'uri' },
      store: false,
    };
    const res = await providerFetch(PROVIDER, `${env.GEMINI_BASE_URL}/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': await key(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 15 * 60_000,
    });
    const j = res.json<any>();
    return this.parseInteraction(j);
  }

  private parseInteraction(j: any): VideoJobHandle {
    const id = j.id ?? j.name ?? 'interaction';
    const status = String(j.status ?? 'completed').toLowerCase();
    if (status === 'failed' || status === 'cancelled') return { providerJobId: id, status: 'failed', error: j.error?.message ?? `Interaction ${status}` };
    const contents: any[] = [];
    for (const step of j.steps ?? []) if (Array.isArray(step.content)) contents.push(...step.content);
    if (Array.isArray(j.outputs)) contents.push(...j.outputs);
    if (j.output_video) contents.push({ type: 'video', ...j.output_video });
    const video = contents.find((c) => c?.type === 'video');
    if (!video) {
      if (status === 'in_progress' || status === 'running') return { providerJobId: id, status: 'running' };
      const text = contents.find((c) => c?.type === 'text')?.text;
      return { providerJobId: id, status: 'failed', error: text ? `No video returned: ${String(text).slice(0, 300)}` : 'No video in interaction response (possibly filtered by safety policy)' };
    }
    if (video.data) return { providerJobId: id, status: 'completed', inline: { data: Buffer.from(video.data, 'base64'), mimeType: video.mime_type ?? 'video/mp4' }, meta: { usage: j.usage } };
    if (video.uri) return { providerJobId: id, status: 'completed', uri: video.uri, meta: { usage: j.usage } };
    return { providerJobId: id, status: 'failed', error: 'Video part had neither data nor uri' };
  }

  async checkStatus(_model: string, handle: VideoJobHandle): Promise<VideoJobHandle> {
    if (handle.status !== 'completed' || !handle.uri) return handle;
    const fileId = fileIdFromUri(handle.uri);
    if (!fileId) return handle;
    const res = await providerFetch(PROVIDER, `${env.GEMINI_BASE_URL}/files/${fileId}`, { headers: { 'x-goog-api-key': await key() } });
    const state = res.json<any>().state;
    if (state === 'FAILED') return { ...handle, status: 'failed', error: 'Generated file processing failed' };
    if (state && state !== 'ACTIVE') return { ...handle, status: 'running' };
    return handle;
  }

  async downloadVideo(handle: VideoJobHandle): Promise<Buffer> {
    if (handle.inline) return handle.inline.data;
    if (!handle.uri) throw new ProviderError('No video to download', PROVIDER, false);
    const fileId = fileIdFromUri(handle.uri);
    const url = fileId ? `${env.GEMINI_BASE_URL}/files/${fileId}:download?alt=media` : handle.uri;
    const k = await key();
    // Docs show the key as a query parameter for downloads; send both forms. URLs are scrubbed from errors/logs.
    const sep = url.includes('?') ? '&' : '?';
    const res = await providerFetch(PROVIDER, `${url}${sep}key=${encodeURIComponent(k)}`, { headers: { 'x-goog-api-key': k }, timeoutMs: 10 * 60_000 });
    return res.body;
  }

  async estimateCost(model: string, seconds: number, resolution: string) {
    const p = await lookupPrice({ provider: PROVIDER, model, unit: 'second', variant: resolution });
    return {
      amount: p.price === null ? null : p.price * seconds,
      unitPrice: p.price,
      unit: 'second',
      note: p.price === null ? `No pricing entry for ${model}; add one in Settings → Pricing` : p.entry?.verified ? undefined : p.entry?.note,
    };
  }
}
