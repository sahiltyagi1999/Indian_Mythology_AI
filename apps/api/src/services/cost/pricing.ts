import { getSettings, type PricingEntry } from '../settings';

export interface PriceLookup {
  price: number | null;
  entry?: PricingEntry;
}

function matches(entry: PricingEntry, model: string) {
  return entry.model.endsWith('*') ? model.startsWith(entry.model.slice(0, -1)) : entry.model === model;
}

/** Finds the price effective on `at` for a provider/model/unit (and optional variant such as '720p'). */
export function findPrice(
  entries: PricingEntry[],
  q: { provider: string; model: string; unit: string; variant?: string; at?: Date },
): PriceLookup {
  const day = (q.at ?? new Date()).toISOString().slice(0, 10);
  const candidates = entries.filter(
    (e) =>
      e.provider === q.provider &&
      e.unit === q.unit &&
      matches(e, q.model) &&
      (!e.effectiveFrom || e.effectiveFrom <= day) &&
      (!e.effectiveTo || e.effectiveTo >= day),
  );
  const exact = candidates.find((e) => (q.variant ? e.variant === q.variant : !e.variant)) ?? candidates.find((e) => !e.variant) ?? candidates[0];
  return exact ? { price: exact.price, entry: exact } : { price: null };
}

export async function lookupPrice(q: { provider: string; model: string; unit: string; variant?: string; at?: Date }) {
  const pricing = await getSettings('pricing');
  return findPrice(pricing.entries, q);
}

export async function pricingFreshness() {
  const pricing = await getSettings('pricing');
  const ageDays = (Date.now() - new Date(pricing.verifiedAt).getTime()) / 86_400_000;
  return { verifiedAt: pricing.verifiedAt, stale: ageDays > pricing.staleAfterDays, ageDays: Math.floor(ageDays) };
}
