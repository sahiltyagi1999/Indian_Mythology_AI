import { AlertTriangle, CheckCircle2, CircleSlash } from 'lucide-react';
import { formatUsd } from '@/lib/utils';
import { STATUS_COLORS } from '@/lib/viz';

/** Spend-vs-limit meter. Status color always ships with an icon and label. */
export function BudgetMeter({ label, spent, limit }: { label: string; spent: number; limit: number | null }) {
  if (limit === null || limit === undefined) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums text-foreground">{formatUsd(spent)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CircleSlash className="h-3 w-3" /> No limit set
        </div>
      </div>
    );
  }
  const ratio = limit > 0 ? spent / limit : 1;
  const state = ratio >= 1 ? 'critical' : ratio >= 0.8 ? 'warning' : 'good';
  const Icon = state === 'good' ? CheckCircle2 : AlertTriangle;
  const stateLabel = state === 'good' ? 'Within budget' : state === 'warning' ? 'Approaching limit' : 'Limit reached';
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">
          {formatUsd(spent)} <span className="text-muted-foreground">/ {formatUsd(limit)}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={spent} aria-valuemax={limit} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: STATUS_COLORS[state] }} />
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" style={{ color: STATUS_COLORS[state] }} /> {stateLabel} · {Math.round(ratio * 100)}%
      </div>
    </div>
  );
}
