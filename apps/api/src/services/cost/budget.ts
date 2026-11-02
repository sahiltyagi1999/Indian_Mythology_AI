import { BudgetExceededError } from '../../lib/errors';
import { getSettings } from '../settings';
import { spentSince } from './usage';
import { VideoAssetModel } from '../../models';

export function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function budgetStatus() {
  const b = await getSettings('budget');
  const [spentToday, spentThisMonth] = await Promise.all([spentSince(startOfDay()), spentSince(startOfMonth())]);
  return {
    ...b,
    spentToday,
    spentThisMonth,
    dailyRemaining: b.dailyLimit === null ? null : b.dailyLimit - spentToday,
    monthlyRemaining: b.monthlyLimit === null ? null : b.monthlyLimit - spentThisMonth,
  };
}

/**
 * Guard called before every paid provider call in the video pipeline. Throws BudgetExceededError
 * (job → awaiting_confirmation) unless the user explicitly confirmed overspend for this video.
 */
export async function assertBudget(estimate: number, videoId?: unknown) {
  if (estimate <= 0) return;
  const video = videoId ? await VideoAssetModel.findById(videoId).select('budgetOverride actualCost episodeNumber').lean() : null;
  if (video?.budgetOverride) return;
  const s = await budgetStatus();
  const exceeds: string[] = [];
  if (s.dailyLimit !== null && s.spentToday + estimate > s.dailyLimit) exceeds.push(`daily budget ($${s.spentToday.toFixed(2)} spent of $${s.dailyLimit})`);
  if (s.monthlyLimit !== null && s.spentThisMonth + estimate > s.monthlyLimit) exceeds.push(`monthly budget ($${s.spentThisMonth.toFixed(2)} spent of $${s.monthlyLimit})`);
  if (video && s.maxCostPerEpisode !== null && (video.actualCost ?? 0) + estimate > s.maxCostPerEpisode) {
    exceeds.push(`max cost per episode ($${(video.actualCost ?? 0).toFixed(2)} + $${estimate.toFixed(2)} > $${s.maxCostPerEpisode})`);
  }
  if (exceeds.length) throw new BudgetExceededError(`Budget confirmation required: next step (~$${estimate.toFixed(2)}) would exceed ${exceeds.join(' and ')}`, { exceeds, estimate });
}
