import { AlertTriangle, Clock, Film, Receipt } from 'lucide-react';
import type { CostEstimate } from '@mas/shared';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/lib/viz';
import { formatDate, formatUsd } from '@/lib/utils';
import { Table, TBody, TD, TH, THead, TR } from '../ui/table';
import { Badge } from '../ui/badge';

export function EstimateView({ estimate }: { estimate: CostEstimate }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-md border bg-surface-sunken/60 p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Receipt className="h-3 w-3" /> Estimated total
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{formatUsd(estimate.total, 2)}</div>
        </div>
        <div className="rounded-md border bg-surface-sunken/60 p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Film className="h-3 w-3" /> Video clips
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{estimate.expectedClips}</div>
        </div>
        <div className="rounded-md border bg-surface-sunken/60 p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" /> Render time
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">~{Math.round(estimate.estimatedRenderMinutes)} min</div>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH className="text-right">Quantity</TH>
              <TH className="text-right">Unit price</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {estimate.lines.map((l, i) => (
              <TR key={i}>
                <TD>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CATEGORY_COLORS[l.category] }} />
                    <span>{l.label || CATEGORY_LABELS[l.category]}</span>
                  </div>
                  {l.note && <div className="mt-0.5 pl-[18px] text-[11px] text-warning/90">{l.note}</div>}
                </TD>
                <TD className="text-right tabular-nums text-muted-foreground">
                  {l.quantity.toLocaleString()} {l.unit}
                </TD>
                <TD className="text-right tabular-nums text-muted-foreground">{formatUsd(l.unitPrice, 4)}</TD>
                <TD className="text-right tabular-nums">{formatUsd(l.amount)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {estimate.perEpisode.length > 1 && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium">Per-episode breakdown ({estimate.perEpisode.length})</summary>
          <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            {estimate.perEpisode.map((p) => (
              <div key={p.episodeId} className="flex justify-between rounded bg-surface-sunken/60 px-2 py-1">
                <span>Episode {p.episodeNumber}</span>
                <span className="tabular-nums">
                  {formatUsd(p.total)}
                  {p.reusedAssets.length > 0 && <span className="ml-1 text-success">· reuses {p.reusedAssets.join(', ')}</span>}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>Pricing verified {formatDate(estimate.pricingVerifiedAt)}</span>
        {estimate.pricingStale && (
          <Badge tone="warning">
            <AlertTriangle className="h-3 w-3" /> Pricing may be stale — review in Settings
          </Badge>
        )}
        {estimate.budget.dailyRemaining !== null && <span>Daily budget left: {formatUsd(estimate.budget.dailyRemaining)}</span>}
        {estimate.budget.monthlyRemaining !== null && <span>Monthly budget left: {formatUsd(estimate.budget.monthlyRemaining)}</span>}
        {estimate.budget.maxPerEpisode !== null && <span>Max per episode: {formatUsd(estimate.budget.maxPerEpisode)}</span>}
      </div>
      {estimate.budget.exceeds.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" /> Exceeds budget
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {estimate.budget.exceeds.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {estimate.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-warning">
          {estimate.warnings.map((w, i) => (
            <li key={i} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
