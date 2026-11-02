'use client';
import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/viz';
import { formatUsd } from '@/lib/utils';

type Day = { date: string; byCategory: Record<string, number>; total: number };

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value > 0).reverse();
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="min-w-[200px] rounded-md border bg-surface-raised px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 flex justify-between gap-4">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{formatUsd(total)}</span>
      </div>
      {rows.length === 0 && <div className="text-muted-foreground">No spend</div>}
      {rows.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-0.5 w-3 rounded" style={{ background: CATEGORY_COLORS[p.dataKey] }} />
            {CATEGORY_LABELS[p.dataKey]}
          </span>
          <span className="font-medium tabular-nums text-foreground">{formatUsd(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Daily spend stacked by category (fixed color per category; one axis; legend + table view for accessibility). */
export function SpendChart({ days, present }: { days: Day[]; present: string[] }) {
  const cats = CATEGORY_ORDER.filter((c) => present.includes(c));
  const data = days.map((d) => ({ date: d.date.slice(5), ...Object.fromEntries(cats.map((c) => [c, d.byCategory[c] ?? 0])) }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {cats.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLORS[c] }} />
            {CATEGORY_LABELS[c]}
          </span>
        ))}
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="hsl(240 10% 18%)" strokeDasharray="0" />
            <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: 'hsl(240 10% 22%)' }} tick={{ fill: 'hsl(240 6% 62%)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'hsl(240 6% 62%)', fontSize: 11 }} tickFormatter={(v: number) => (v === 0 ? '$0' : formatUsd(v, v < 1 ? 2 : 0))} width={52} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(240 14% 18% / 0.5)' }} />
            {cats.map((c, i) => (
              <Bar key={c} dataKey={c} stackId="spend" fill={CATEGORY_COLORS[c]} stroke="#14141B" strokeWidth={1} radius={i === cats.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
