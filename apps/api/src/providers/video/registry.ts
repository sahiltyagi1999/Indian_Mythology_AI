import { ProviderError } from '../../lib/errors';
import { GeminiOmniVideoProvider } from './geminiOmni';
import { ManualVideoProvider } from './manual';
import type { VideoProvider } from './types';

const providers = new Map<string, VideoProvider>();

export function registerVideoProvider(p: VideoProvider) {
  providers.set(p.id, p);
}

registerVideoProvider(new GeminiOmniVideoProvider());
registerVideoProvider(new ManualVideoProvider());

export function listVideoProviders(): VideoProvider[] {
  return [...providers.values()];
}

/** Never falls back to a different (possibly more expensive) provider: unknown ids are an explicit error. */
export function getVideoProvider(id: string): VideoProvider {
  const p = providers.get(id);
  if (!p) throw new ProviderError(`Video provider "${id}" is not registered. Select an available provider in settings.`, id, false, undefined, 'UNKNOWN_PROVIDER');
  return p;
}
