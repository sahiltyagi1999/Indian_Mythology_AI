import { listModels } from '../llm/gemini';
import { getSettings } from '../../services/settings';
import { ProviderError } from '../../lib/errors';
import { MANUAL_MODEL, MANUAL_PROVIDER_ID } from './manual';

/**
 * Resolves the video model: the pinned setting if present, otherwise a live-catalog match for the
 * selected provider family. Throws (rather than guessing) if nothing suitable is listed.
 */
export async function resolveVideoModel(): Promise<{ provider: string; model: string }> {
  const s = await getSettings('google');
  if (s.videoProvider === MANUAL_PROVIDER_ID) return { provider: MANUAL_PROVIDER_ID, model: MANUAL_MODEL };
  if (s.videoModel) return { provider: s.videoProvider, model: s.videoModel };
  if (s.videoProvider === 'gemini-omni') {
    const models = await listModels();
    const omni = models
      .filter((m) => /omni/i.test(m.id) && !/preview|exp/i.test(m.id))
      .sort((a, b) => parseFloat(b.id.match(/(\d+(?:\.\d+)?)/)?.[1] ?? '0') - parseFloat(a.id.match(/(\d+(?:\.\d+)?)/)?.[1] ?? '0'));
    if (omni[0]) return { provider: s.videoProvider, model: omni[0].id };
  }
  throw new ProviderError(
    'No video model is configured and none could be discovered from the live model list. Pick a provider and model in AI Provider Settings.',
    s.videoProvider,
    false,
    undefined,
    'NO_VIDEO_MODEL',
  );
}

/** Lists candidate video models visible to the key (for the settings dropdown). */
export async function discoverVideoModels(): Promise<string[]> {
  const models = await listModels();
  return models.filter((m) => /omni|veo|video/i.test(m.id)).map((m) => m.id);
}
