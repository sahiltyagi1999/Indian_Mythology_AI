'use client';
import * as React from 'react';
import Link from 'next/link';
import { ListChecks, RotateCcw, XCircle } from 'lucide-react';
import { JOB_STATUSES, QUEUE_NAMES, type GenerationJobDTO } from '@mas/shared';
import { useCancelJob, useJob, useJobs, useQueueHealth, useRetryJob } from '@/lib/queries/misc';
import { EmptyState, ErrorState, KeyValue, LoadingRows, PageHeader, Pagination, StatusBadge, humanize } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimpleSelect } from '@/components/ui/select';
import { Progress, Tooltip } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Dialog, SheetContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BatchesSection } from '@/components/video/batches';
import { cn, elapsed, formatDate, formatUsd } from '@/lib/utils';

const QUEUE_LABELS: Record<string, string> = { pdf: 'PDF', embedding: 'Embeddings', outline: 'Outline', script: 'Scripts', audio: 'Narration', video: 'Video scenes', render: 'Rendering' };

function JobTarget({ j }: { j: GenerationJobDTO }) {
  const parts: React.ReactNode[] = [];
  if (j.episodeNumber !== undefined) parts.push(j.episodeId ? <Link key="e" href={`/scripts/${j.episodeId}`} className="hover:text-primary">Ep {j.episodeNumber}</Link> : `Ep ${j.episodeNumber}`);
  if (j.sceneNumber !== undefined) parts.push(`Scene ${j.sceneNumber}`);
  if (j.videoId) parts.push(<Link key="v" href={`/videos/${j.videoId}`} className="hover:text-primary">video</Link>);
  if (!parts.length && j.sourceId) parts.push(<Link key="s" href={`/sources/${j.sourceId}`} className="hover:text-primary">source</Link>);
  return <span className="flex gap-1.5 text-xs text-muted-foreground">{parts.length ? parts.map((p, i) => <React.Fragment key={i}>{i > 0 && '·'}{p}</React.Fragment>) : '—'}</span>;
}

export default function QueuePage() {
  const [status, setStatus] = React.useState('active');
  const [queue, setQueue] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const pageSize = 50;
  const statusFilter = status === 'active' ? ['running', 'queued', 'awaiting_confirmation'] : status === 'all' ? undefined : status;
  const { data, isLoading, error, refetch } = useJobs({ status: statusFilter, queue: queue || undefined, page, pageSize });
  const health = useQueueHealth();
  const cancel = useCancelJob();
  const retry = useRetryJob();
  const counts = data?.counts ?? {};

  return (
    <>
      <PageHeader icon={ListChecks} title="Generation Queue" description="Every expensive step runs as a persistent background job with retries and exponential backoff. A failed scene can be retried alone — successful work is reused." />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {Object.keys(QUEUE_NAMES).map((q) => {
          const h = health.data?.[q];
          return (
            <button key={q} onClick={() => setQueue(queue === q ? '' : q)} className={cn('rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40', queue === q && 'border-primary/60')}>
              <div className="text-xs font-medium">{QUEUE_LABELS[q]}</div>
              <div className="mt-1 flex gap-2 text-[11px] tabular-nums text-muted-foreground">
                <span className={h?.active ? 'text-info' : ''}>{h?.active ?? 0} active</span>
                <span>{(h?.waiting ?? 0) + (h?.delayed ?? 0) + (h?.prioritized ?? 0)} waiting</span>
                {(h?.failed ?? 0) > 0 && <span className="text-destructive">{h?.failed} failed</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="active">Active ({(counts.running ?? 0) + (counts.queued ?? 0) + (counts.awaiting_confirmation ?? 0)})</TabsTrigger>
            {JOB_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {humanize(s)} ({counts[s] ?? 0})
              </TabsTrigger>
            ))}
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <SimpleSelect
          className="w-44"
          value={queue}
          onValueChange={(v) => {
            setQueue(v);
            setPage(1);
          }}
          options={[{ value: '', label: 'All queues' }, ...Object.keys(QUEUE_NAMES).map((q) => ({ value: q, label: QUEUE_LABELS[q]! }))]}
        />
      </div>

      {error && <ErrorState error={error} onRetry={() => refetch()} className="mb-4" />}
      {isLoading ? (
        <LoadingRows rows={8} />
      ) : !data?.items.length ? (
        <EmptyState icon={ListChecks} title="No jobs here" description="Jobs appear when you process sources, generate scripts or start video batches." />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Job</TH>
                <TH>Target</TH>
                <TH>Stage</TH>
                <TH className="w-40">Progress</TH>
                <TH>Elapsed</TH>
                <TH>Attempts</TH>
                <TH>Cost (est / actual)</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((j) => (
                <TR key={j._id} className="cursor-pointer" onClick={() => setOpenId(j._id)}>
                  <TD>
                    <div className="text-sm font-medium">{j.type}</div>
                    <div className="text-[11px] text-muted-foreground">{QUEUE_LABELS[j.queue]}</div>
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <JobTarget j={j} />
                  </TD>
                  <TD className="max-w-[220px]">
                    <div className="truncate text-xs">{j.stage}</div>
                    {j.error?.message && (
                      <Tooltip content={j.error.message}>
                        <div className="truncate text-[11px] text-destructive">{j.error.message}</div>
                      </Tooltip>
                    )}
                  </TD>
                  <TD>
                    <Progress value={j.progress} tone={j.status === 'failed' ? 'danger' : j.status === 'completed' ? 'success' : 'primary'} />
                    <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{j.progress}%</div>
                  </TD>
                  <TD className="whitespace-nowrap text-xs tabular-nums">{elapsed(j.startedAt, j.finishedAt)}</TD>
                  <TD className="text-xs tabular-nums">
                    {j.attempts}/{j.maxAttempts}
                  </TD>
                  <TD className="whitespace-nowrap text-xs tabular-nums">
                    {formatUsd(j.estimatedCost)} / {formatUsd(j.actualCost)}
                  </TD>
                  <TD>
                    <StatusBadge status={j.status} />
                  </TD>
                  <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                    {['queued', 'running', 'awaiting_confirmation'].includes(j.status) && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(j._id)} loading={cancel.isPending && cancel.variables === j._id}>
                        <XCircle /> Cancel
                      </Button>
                    )}
                    {['failed', 'cancelled'].includes(j.status) && (
                      <Button size="sm" variant="ghost" onClick={() => retry.mutate(j._id)} loading={retry.isPending && retry.variables === j._id}>
                        <RotateCcw /> Retry
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex justify-end border-t px-4 py-2.5">
            <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />
          </div>
        </Card>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Video batches</CardTitle>
        </CardHeader>
        <CardContent>
          <BatchesSection />
        </CardContent>
      </Card>

      <JobDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function JobDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: j, isLoading } = useJob(id);
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <DialogTitle>{j?.type ?? 'Job'}</DialogTitle>
        <DialogDescription className="sr-only">Job details and logs</DialogDescription>
        {isLoading || !j ? (
          <LoadingRows rows={6} />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <StatusBadge status={j.status} />
              <span className="text-xs text-muted-foreground">{j.stage}</span>
            </div>
            <Progress value={j.progress} />
            <KeyValue
              items={[
                ['Queue', QUEUE_LABELS[j.queue] ?? j.queue],
                ['Idempotency key', <code key="k" className="break-all text-xs text-muted-foreground">{j.idempotencyKey}</code>],
                ['Target', <JobTarget key="t" j={j} />],
                ['Attempts', `${j.attempts} / ${j.maxAttempts}`],
                ['Started', formatDate(j.startedAt, true)],
                ['Finished', formatDate(j.finishedAt, true)],
                ['Elapsed', elapsed(j.startedAt, j.finishedAt)],
                ['Estimated cost', formatUsd(j.estimatedCost)],
                ['Actual cost', formatUsd(j.actualCost)],
              ]}
            />
            {j.error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <div className="font-medium text-destructive">
                  {j.error.code ?? 'Error'} {j.error.retryable ? '(retryable)' : '(permanent)'}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{j.error.message}</p>
              </div>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Logs</h3>
              <div className="max-h-[50vh] space-y-1 overflow-auto rounded-md border bg-surface-sunken p-3 font-mono text-[11px]">
                {j.logs.length === 0 && <span className="text-muted-foreground">No logs.</span>}
                {j.logs.map((l, i) => (
                  <div key={i} className={cn(l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-warning' : 'text-muted-foreground')}>
                    <span className="text-muted-foreground/60">{new Date(l.at).toLocaleTimeString()}</span> {l.message}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Dialog>
  );
}
