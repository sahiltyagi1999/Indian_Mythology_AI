import type { Types } from 'mongoose';
import type { UsageCategory } from '@mas/shared';
import { UsageRecordModel, GenerationJobModel, VideoAssetModel, BatchGenerationModel } from '../../models';
import { lookupPrice } from './pricing';
import { logger } from '../../config/logger';

type Id = string | Types.ObjectId | undefined | null;

export interface UsageContext {
  sourceId?: Id;
  episodeId?: Id;
  videoId?: Id;
  batchId?: Id;
  jobId?: Id;
}

export interface UsageInput {
  category: UsageCategory;
  provider: string;
  model?: string;
  operation: string;
  inputTokens?: number;
  /** Prompt-cache hits, billed at the cached-input rate (falls back to the input rate). */
  cachedInputTokens?: number;
  outputTokens?: number;
  /** For per-unit billing (characters, seconds). */
  quantity?: number;
  unit?: string;
  variant?: string;
  /** Use when the provider reports an exact cost. */
  cost?: number;
}

/** Persists a UsageRecord with cost computed from the pricing catalog, and rolls cost up to job/video/batch. */
export async function recordUsage(input: UsageInput, ctx: UsageContext = {}): Promise<number> {
  let cost = input.cost ?? 0;
  let pricingSource = input.cost !== undefined ? 'provider' : 'catalog';
  if (input.cost === undefined && input.model) {
    if (input.inputTokens || input.outputTokens || input.cachedInputTokens) {
      const inP = await lookupPrice({ provider: input.provider, model: input.model, unit: 'input_1m_tokens' });
      const outP = await lookupPrice({ provider: input.provider, model: input.model, unit: 'output_1m_tokens' });
      const cachedP = input.cachedInputTokens ? await lookupPrice({ provider: input.provider, model: input.model, unit: 'cached_input_1m_tokens' }) : { price: null };
      cost =
        ((input.inputTokens ?? 0) * (inP.price ?? 0) + (input.cachedInputTokens ?? 0) * (cachedP.price ?? inP.price ?? 0) + (input.outputTokens ?? 0) * (outP.price ?? 0)) / 1_000_000;
      if ((input.inputTokens && inP.price === null) || (input.outputTokens && outP.price === null)) pricingSource = 'missing';
    } else if (input.quantity && input.unit) {
      const p = await lookupPrice({ provider: input.provider, model: input.model, unit: input.unit, variant: input.variant });
      const divisor = input.unit === '1k_characters' ? 1000 : input.unit.endsWith('1m_tokens') ? 1_000_000 : 1;
      cost = p.price === null ? 0 : (input.quantity / divisor) * p.price;
      if (p.price === null) pricingSource = 'missing';
    }
  }
  if (pricingSource === 'missing') logger.warn({ provider: input.provider, model: input.model }, 'No pricing entry; usage recorded with zero cost');
  cost = Math.round(cost * 1e6) / 1e6;
  try {
    await UsageRecordModel.create({
      ...input,
      quantity: input.quantity ?? (input.inputTokens ?? 0) + (input.cachedInputTokens ?? 0) + (input.outputTokens ?? 0),
      unit: input.unit ?? 'tokens',
      cost,
      pricingSource,
      ...ctx,
    });
    if (cost > 0) {
      if (ctx.jobId) await GenerationJobModel.updateOne({ _id: ctx.jobId }, { $inc: { actualCost: cost } });
      if (ctx.videoId) await VideoAssetModel.updateOne({ _id: ctx.videoId }, { $inc: { actualCost: cost } });
      if (ctx.batchId) await BatchGenerationModel.updateOne({ _id: ctx.batchId }, { $inc: { actualCost: cost } });
    }
  } catch (err) {
    logger.error(err, 'Failed to record usage');
  }
  return cost;
}

export async function spentSince(since: Date): Promise<number> {
  const [r] = await UsageRecordModel.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, total: { $sum: '$cost' } } }]);
  return r?.total ?? 0;
}
