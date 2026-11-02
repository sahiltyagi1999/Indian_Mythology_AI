import { ProviderError } from '../../lib/errors';
import type { VideoCapabilities, VideoJobHandle, VideoProvider } from './types';

export const MANUAL_PROVIDER_ID = 'manual';
export const MANUAL_MODEL = 'manual';

/**
 * Clips are made by the user outside the app (e.g. Flow or the Gemini app on a Google AI subscription) from
 * the scene prompts the app plans, then uploaded per scene. Narration, subtitles and rendering stay automatic.
 * Nothing is generated or billed here; the pipeline waits for uploads instead of queueing scene jobs.
 */
export class ManualVideoProvider implements VideoProvider {
  readonly id = MANUAL_PROVIDER_ID;
  readonly label = 'Manual upload (make clips yourself, e.g. in Flow / Gemini app)';

  async getCapabilities(model: string): Promise<VideoCapabilities> {
    return {
      provider: this.id,
      model,
      displayName: 'Manual upload',
      aspectRatios: ['9:16'],
      // Flow / Gemini app clips are 8 s; scenes are planned to fit one clip each.
      minClipSeconds: 4,
      maxClipSeconds: 8,
      durationControl: 'prompt',
      resolutions: ['720p', '1080p'],
      referenceImages: { supported: false, max: 0 },
      // Uploaded clips may carry their own speech or music; only the narration is used.
      generatesAudio: false,
      synchronous: true,
      watermark: 'Clips made in consumer apps may carry a visible watermark; it is kept as uploaded.',
      // Never crop a possible visible watermark with the push-in effect.
      visibleWatermark: true,
      requiresPaidTier: false,
      notes: ['Create each scene in a 9:16 frame from its prompt and upload it on the video page.', 'Clips shorter than the scene are slowed slightly and then held on the last frame.'],
      verifiedAt: '2026-11-02',
      docsUrl: 'https://labs.google/flow',
    };
  }

  async checkAvailability() {
    return { available: true, message: 'No API needed: scene clips are uploaded on the video page.' };
  }

  async generateVideo(): Promise<VideoJobHandle> {
    throw new ProviderError('This video uses manual clips: upload the scene clip on the video page', this.id, false, undefined, 'MANUAL_UPLOAD_REQUIRED');
  }

  async checkStatus(_model: string, handle: VideoJobHandle): Promise<VideoJobHandle> {
    return handle;
  }

  async downloadVideo(): Promise<Buffer> {
    throw new ProviderError('Manual clips are uploaded, not downloaded', this.id, false, undefined, 'MANUAL_UPLOAD_REQUIRED');
  }

  async estimateCost() {
    return { amount: 0, unitPrice: 0, unit: 'second' };
  }
}
