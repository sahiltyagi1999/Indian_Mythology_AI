import type { CostEstimate, CostLine, VideoGenerationSettings } from '@mas/shared';
import { EpisodeModel, NarrationAssetModel, VideoAssetModel } from '../../models';
import { lookupPrice, pricingFreshness } from './pricing';
import { budgetStatus } from './budget';
import { getSettings } from '../settings';
import { resolveTtsModel } from '../../providers/tts/elevenlabs';
import { resolveModel } from '../../providers/llm';
import { getVideoProvider } from '../../providers/video/registry';
import { resolveVideoModel } from '../../providers/video/resolve';
import { MissingCredentialsError } from '../../lib/errors';

const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Pre-flight estimate for a batch, priced from the pricing catalog for the models that will actually run.
 * Unknown prices are reported as warnings (never silently zero) so the user can decide.
 */
export async function estimateBatch(episodeIds: string[], settings: VideoGenerationSettings): Promise<CostEstimate> {
  const warnings: string[] = [];
  const [render, el, freshness, budget] = await Promise.all([getSettings('render'), getSettings('elevenlabs'), pricingFreshness(), budgetStatus()]);
  const eps = await EpisodeModel.find({ _id: { $in: episodeIds } }).sort({ episodeNumber: 1 }).lean();
  if (eps.length !== episodeIds.length) warnings.push(`${episodeIds.length - eps.length} selected episode(s) were not found`);
  const notReady = eps.filter((e) => !['approved', 'locked'].includes(e.status));
  if (notReady.length) warnings.push(`Not approved: episodes ${notReady.map((e) => e.episodeNumber).join(', ')} — they will be rejected`);

  let ttsModel = settings.ttsModel;
  if (!ttsModel) {
    try {
      ttsModel = await resolveTtsModel(el);
    } catch (e) {
      warnings.push(e instanceof MissingCredentialsError ? 'ElevenLabs API key missing — narration model cannot be resolved' : `ElevenLabs: ${(e as Error).message}`);
    }
  }
  if (!settings.voiceId && !el.voiceId) warnings.push('No narrator voice selected');
  let videoProvider = settings.videoProvider;
  let videoModel = settings.videoModel;
  if (!videoModel) {
    try {
      ({ provider: videoProvider, model: videoModel } = await resolveVideoModel());
    } catch (e) {
      warnings.push(`Video model: ${(e as Error).message}`);
    }
  }
  let textModel = '';
  let textProvider: string = 'google';
  try {
    ({ model: textModel, provider: textProvider } = await resolveModel('text'));
  } catch (e) {
    warnings.push(`Text model: ${(e as Error).message}`);
  }

  const ttsPrice = ttsModel ? await lookupPrice({ provider: 'elevenlabs', model: ttsModel, unit: '1k_characters' }) : { price: null };
  if (ttsModel && ttsPrice.price === null) warnings.push(`No price for ElevenLabs model ${ttsModel}; add it in Settings → Pricing`);
  let videoUnit: number | null = null;
  let caps: Awaited<ReturnType<ReturnType<typeof getVideoProvider>['getCapabilities']>> | null = null;
  if (videoModel) {
    const provider = getVideoProvider(videoProvider);
    caps = await provider.getCapabilities(videoModel);
    const e = await provider.estimateCost(videoModel, 1, settings.resolution);
    videoUnit = e.unitPrice;
    if (e.note) warnings.push(e.note);
  }
  const tIn = textModel ? await lookupPrice({ provider: textProvider, model: textModel, unit: 'input_1m_tokens' }) : { price: null };
  const tOut = textModel ? await lookupPrice({ provider: textProvider, model: textModel, unit: 'output_1m_tokens' }) : { price: null };

  const pastRenders = await VideoAssetModel.find({ renderSeconds: { $gt: 0 } }).sort({ createdAt: -1 }).limit(20).select('renderSeconds duration').lean();
  const renderRatio = pastRenders.length ? pastRenders.reduce((a, v) => a + v.renderSeconds! / (v.duration || 55), 0) / pastRenders.length : 1;

  let chars = 0;
  let videoSeconds = 0;
  let clips = 0;
  let renderSeconds = 0;
  const perEpisode: CostEstimate['perEpisode'] = [];
  for (const ep of eps) {
    const reused: string[] = [];
    const cachedAudio = await NarrationAssetModel.findOne({ episodeId: ep._id, scriptVersion: ep.currentVersion, voiceId: settings.voiceId || el.voiceId, status: 'active' }).lean();
    const epChars = cachedAudio ? 0 : ep.narrationText.length;
    if (cachedAudio) reused.push('narration');
    const duration = ep.actualAudioDuration || ep.estimatedDuration || render.targetDuration;
    const sceneCount = Math.max(6, Math.min(10, Math.round(duration / Math.min(caps?.maxClipSeconds ?? 8, 7.5))));
    const perClip = Math.min(caps?.maxClipSeconds ?? 8, Math.max(caps?.minClipSeconds ?? 3, (duration + 0.6) / sceneCount));
    // Clip length is chosen by the model within its range; budget ~10% above the narration length.
    const epVideoSeconds = sceneCount * perClip * 1.1;
    chars += epChars;
    videoSeconds += epVideoSeconds;
    clips += sceneCount;
    renderSeconds += duration * renderRatio;
    const total = (epChars / 1000) * (ttsPrice.price ?? 0) + epVideoSeconds * (videoUnit ?? 0) + (3000 * (tIn.price ?? 0) + 2500 * (tOut.price ?? 0)) / 1e6;
    perEpisode.push({ episodeId: String(ep._id), episodeNumber: ep.episodeNumber, total: round(total), reusedAssets: reused });
  }

  const lines: CostLine[] = [
    { category: 'narration', label: `ElevenLabs narration (${ttsModel || 'unresolved'})`, quantity: chars, unit: 'characters', unitPrice: ttsPrice.price ?? 0, amount: round((chars / 1000) * (ttsPrice.price ?? 0)), note: 'per 1k characters; cached audio is reused' },
    { category: 'video', label: `Scene video (${videoModel || 'unresolved'}, ${settings.resolution})`, quantity: round(videoSeconds), unit: 'seconds', unitPrice: videoUnit ?? 0, amount: round(videoSeconds * (videoUnit ?? 0)), note: `${clips} clips; clip length is decided by the model (${caps?.minClipSeconds ?? '?'}–${caps?.maxClipSeconds ?? '?'}s)` },
    { category: 'text', label: `Scene planning (${textModel || 'unresolved'})`, quantity: eps.length * 5500, unit: 'tokens', unitPrice: tOut.price ?? 0, amount: round((eps.length * (3000 * (tIn.price ?? 0) + 2500 * (tOut.price ?? 0))) / 1e6) },
    { category: 'rendering', label: 'Local FFmpeg rendering', quantity: Math.round(renderSeconds), unit: 'seconds', unitPrice: 0, amount: 0, note: 'runs on this machine' },
    { category: 'storage', label: 'Local storage (~60 MB per episode)', quantity: eps.length * 60, unit: 'MB', unitPrice: 0, amount: 0 },
  ];
  const total = round(lines.reduce((a, l) => a + l.amount, 0));
  const exceeds: string[] = [];
  if (budget.dailyRemaining !== null && total > budget.dailyRemaining) exceeds.push(`daily budget (remaining $${budget.dailyRemaining.toFixed(2)})`);
  if (budget.monthlyRemaining !== null && total > budget.monthlyRemaining) exceeds.push(`monthly budget (remaining $${budget.monthlyRemaining.toFixed(2)})`);
  if (budget.maxCostPerEpisode !== null) {
    const over = perEpisode.filter((p) => p.total > budget.maxCostPerEpisode!);
    if (over.length) exceeds.push(`max cost per episode ($${budget.maxCostPerEpisode}) for episodes ${over.map((o) => o.episodeNumber).join(', ')}`);
  }
  if (freshness.stale) warnings.push(`Pricing was last verified ${freshness.verifiedAt} (${freshness.ageDays} days ago); check provider pricing pages`);
  return {
    currency: 'USD',
    lines,
    total,
    perEpisode,
    expectedClips: clips,
    estimatedRenderMinutes: Math.round((renderSeconds / 60) * 10) / 10,
    pricingVerifiedAt: freshness.verifiedAt,
    pricingStale: freshness.stale,
    warnings,
    budget: { dailyRemaining: budget.dailyRemaining, monthlyRemaining: budget.monthlyRemaining, maxPerEpisode: budget.maxCostPerEpisode, exceeds },
  };
}
