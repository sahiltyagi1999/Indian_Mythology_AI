'use client';
import * as React from 'react';
import Link from 'next/link';
import { BarChart3, Table2 } from 'lucide-react';
import { useAnalyticsSummary, useBatchCosts, useEpisodeCosts } from '@/lib/queries/misc';
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatCard, StatusBadge } from '@/components/common';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { BudgetMeter } from '@/components/budget-meter';
import { SpendChart } from '@/components/spend-chart';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/viz';
import { cn, formatBytes, formatDate, formatUsd } from '@/lib/utils';

const PRESETS = [
  { label: 'Today', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

function range(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function AnalyticsPage() {
  const [days, setDays] = React.useState(30);
  const { from, to } = range(days);
  // Inclusive day range: the API treats bare dates as midnight, so send explicit day bounds.
  const summary = useAnalyticsSummary(`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`);
  const episodes = useEpisodeCosts();
  const batches = useBatchCosts();
  const [tableView, setTableView] = React.useState(false);
  const s = summary.data;
  const present = s ? CATEGORY_ORDER.filter((c) => (s.totals.byCategory[c] ?? 0) > 0) : [];
  const maxCat = s ? Math.max(...CATEGORY_ORDER.map((c) => s.totals.byCategory[c] ?? 0), 0.000001) : 1;

  return (
    <>
      <PageHeader icon={BarChart3} title="Cost & Usage Analytics" description="Every provider call is recorded with its cost from the pricing catalog. Budgets are enforced before expensive work starts." />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <Button key={p.days} size="sm" variant={days === p.days ? 'secondary' : 'outline'} onClick={() => setDays(p.days)}>
            {p.label}
          </Button>
        ))}
        <span className="ml-2 self-center text-xs text-muted-foreground">
          {formatDate(from)} – {formatDate(to)}
        </span>
      </div>
      {summary.error && <ErrorState error={summary.error} onRetry={() => summary.refetch()} className="mb-4" />}
      {summary.isLoading || !s ? (
        <LoadingRows rows={8} />
      ) : (
        <div className={cn('space-y-6 transition-opacity', summary.isFetching && 'opacity-70')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total spend (period)" value={formatUsd(s.totals.total, 2)} />
            <StatCard label="Video generation" value={formatUsd(s.totals.byCategory.video ?? 0, 2)} />
            <StatCard label="Narration" value={formatUsd(s.totals.byCategory.narration ?? 0, 2)} />
            <StatCard label="Storage used" value={formatBytes(s.storage.bytes)} sub={`${s.storage.files} files`} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <Card>
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>Daily spend by category</CardTitle>
                  <CardDescription>USD per day</CardDescription>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setTableView((v) => !v)}>
                  {tableView ? <BarChart3 /> : <Table2 />} {tableView ? 'Chart' : 'Table'}
                </Button>
              </CardHeader>
              <CardContent>
                {s.totals.total === 0 ? (
                  <EmptyState title="No spend in this period" description="Costs appear here as soon as providers are called." />
                ) : tableView ? (
                  <div className="max-h-80 overflow-auto rounded-md border">
                    <Table>
                      <THead>
                        <TR>
                          <TH>Date</TH>
                          {present.map((c) => (
                            <TH key={c} className="text-right">
                              {CATEGORY_LABELS[c]}
                            </TH>
                          ))}
                          <TH className="text-right">Total</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {s.daily.map((d) => (
                          <TR key={d.date}>
                            <TD className="tabular-nums">{d.date}</TD>
                            {present.map((c) => (
                              <TD key={c} className="text-right tabular-nums">
                                {formatUsd(d.byCategory[c] ?? 0)}
                              </TD>
                            ))}
                            <TD className="text-right font-medium tabular-nums">{formatUsd(d.total)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                ) : (
                  <SpendChart days={s.daily} present={present} />
                )}
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Budget</CardTitle>
                  <CardDescription>
                    <Link href="/settings" className="text-primary hover:underline">
                      Edit limits
                    </Link>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <BudgetMeter label="Today" spent={s.budget.spentToday} limit={s.budget.dailyLimit} />
                  <BudgetMeter label="This month" spent={s.budget.spentThisMonth} limit={s.budget.monthlyLimit} />
                  <p className="text-xs text-muted-foreground">Max per episode: {s.budget.maxCostPerEpisode === null ? 'no limit' : formatUsd(s.budget.maxCostPerEpisode)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>By category</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {CATEGORY_ORDER.map((c) => {
                    const v = s.totals.byCategory[c] ?? 0;
                    return (
                      <div key={c} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{CATEGORY_LABELS[c]}</span>
                          <span className="tabular-nums">{formatUsd(v)}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${(v / maxCat) * 100}%`, background: CATEGORY_COLORS[c] }} />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>By provider & model</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Provider</TH>
                  <TH>Model</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Quantity</TH>
                  <TH className="text-right">Cost</TH>
                </TR>
              </THead>
              <TBody>
                {s.byModel.length === 0 && (
                  <TR>
                    <TD colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      No usage recorded.
                    </TD>
                  </TR>
                )}
                {s.byModel.map((m, i) => (
                  <TR key={i}>
                    <TD>{m.provider}</TD>
                    <TD className="font-mono text-xs">{m.model}</TD>
                    <TD>
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_COLORS[m.category] }} />
                        {CATEGORY_LABELS[m.category] ?? m.category}
                      </span>
                    </TD>
                    <TD className="text-right text-xs tabular-nums text-muted-foreground">
                      {Math.round(m.quantity).toLocaleString()} {m.unit}
                    </TD>
                    <TD className="text-right tabular-nums">{formatUsd(m.cost)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Cost per episode</CardTitle>
              </CardHeader>
              <div className="max-h-96 overflow-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>#</TH>
                      <TH>Episode</TH>
                      <TH className="text-right">Narration</TH>
                      <TH className="text-right">Video</TH>
                      <TH className="text-right">Total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {!episodes.data?.length && (
                      <TR>
                        <TD colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          No per-episode costs yet.
                        </TD>
                      </TR>
                    )}
                    {episodes.data?.map((e) => (
                      <TR key={e.episodeId}>
                        <TD className="tabular-nums text-muted-foreground">{e.episodeNumber}</TD>
                        <TD>
                          <Link href={`/scripts/${e.episodeId}`} className="font-hindi hover:text-primary">
                            {e.title}
                          </Link>
                        </TD>
                        <TD className="text-right tabular-nums">{formatUsd(e.byCategory.narration ?? 0)}</TD>
                        <TD className="text-right tabular-nums">{formatUsd(e.byCategory.video ?? 0)}</TD>
                        <TD className="text-right font-medium tabular-nums">{formatUsd(e.cost)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Cost per batch</CardTitle>
              </CardHeader>
              <div className="max-h-96 overflow-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Batch</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Videos</TH>
                      <TH className="text-right">Estimated</TH>
                      <TH className="text-right">Actual</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {!batches.data?.length && (
                      <TR>
                        <TD colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          No batches yet.
                        </TD>
                      </TR>
                    )}
                    {batches.data?.map((b) => (
                      <TR key={b.batchId}>
                        <TD>
                          <div className="text-sm">{b.name}</div>
                          <div className="text-[11px] text-muted-foreground">{formatDate(b.createdAt, true)}</div>
                        </TD>
                        <TD>
                          <StatusBadge status={b.status} />
                        </TD>
                        <TD className="text-right tabular-nums">{b.videos}</TD>
                        <TD className="text-right tabular-nums text-muted-foreground">{formatUsd(b.estimated)}</TD>
                        <TD className={cn('text-right font-medium tabular-nums', b.actual > b.estimated * 1.1 && 'text-warning')}>{formatUsd(b.actual)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
