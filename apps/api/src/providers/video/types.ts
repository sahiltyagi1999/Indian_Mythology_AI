import type { UsageContext } from '../../services/cost/usage';

export interface VideoCapabilities {
  provider: string;
  model: string;
  displayName: string;
  aspectRatios: string[];
  minClipSeconds: number;
  maxClipSeconds: number;
  /** 'parameter' = the API accepts a duration; 'prompt' = duration is only steerable via the prompt. */
  durationControl: 'parameter' | 'prompt';
  resolutions: string[];
  referenceImages: { supported: boolean; max: number };
  generatesAudio: boolean;
  synchronous: boolean;
  watermark: string;
  /** True when the provider burns a visible mark into frames; the editor then disables any zoom that could crop it. */
  visibleWatermark: boolean;
  requiresPaidTier: boolean;
  notes: string[];
  verifiedAt: string;
  docsUrl: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  aspectRatio: '9:16' | '16:9';
  durationSeconds: number;
  resolution: string;
  referenceImages?: { data: Buffer; mimeType: string; label: string }[];
  avoid?: string;
  /** Still-image providers only: low | medium | high. */
  quality?: string;
}

export interface VideoJobHandle {
  providerJobId: string;
  status: 'running' | 'completed' | 'failed';
  /** Inline result for synchronous providers. */
  inline?: { data: Buffer; mimeType: string };
  uri?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface CostEstimateLine {
  amount: number | null;
  unitPrice: number | null;
  unit: string;
  note?: string;
}

export interface VideoProvider {
  readonly id: string;
  readonly label: string;
  getCapabilities(model: string): Promise<VideoCapabilities>;
  /** Verifies the model is reachable with the configured credentials. */
  checkAvailability(model: string): Promise<{ available: boolean; message: string }>;
  generateVideo(model: string, req: VideoGenerationRequest, ctx?: UsageContext): Promise<VideoJobHandle>;
  checkStatus(model: string, handle: VideoJobHandle): Promise<VideoJobHandle>;
  downloadVideo(handle: VideoJobHandle): Promise<Buffer>;
  /** unit 'second' prices generated seconds; unit 'image' prices one image per scene. */
  estimateCost(model: string, seconds: number, resolution: string, quality?: string): Promise<CostEstimateLine>;
}
