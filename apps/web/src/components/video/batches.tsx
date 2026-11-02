'use client';
import * as React from 'react';
import Link from 'next/link';
import { Layers, XCircle } from 'lucide-react';
import { useBatch, useBatches, useCancelBatch } from '@/lib/queries/video';
import { EmptyState, LoadingRows, StatusBadge } from '../common';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Progress } from '../ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { ConfirmDialog } from '../ui/alert-dialog';
import { formatDate, formatUsd } from '@/lib/utils';

export function BatchesSection() {
  const { data, isLoading } = useBatches();
  const [open, setOpen] = React.useState<string | null>(null);
  const [cancelId, setCancelId] = React.useState<string | null>(null);
  const cancel = useCancelBatch();
  if (isLoading) return <LoadingRows rows={3} />;
  if (!data?.length) return <EmptyState icon={Layers} title="No video batches yet" description="Batches started from the Video Studio appear here." />;
  return (
    <div className="space-y-2">
      {data.map((b) => (
        <Card key={b._id} className="flex flex-wrap items-center gap-4 p-3">
          <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(b._id)}>
            <div className="truncate text-sm font-medium">{b.name}</div>
            <div className="text-xs text-muted-foreground">
              {b.episodeIds.length} episodes · concurrency {b.maxConcurrency} · {formatDate(b.createdAt, true)}
            </div>
          </button>
          <div className="text-right text-xs tabular-nums">
            <div>{formatUsd(b.actualCost)} spent</div>
            <div className="text-muted-foreground">est. {formatUsd(b.estimate?.total)}</div>
          </div>
          <StatusBadge status={b.status} />
          {['running', 'awaiting_confirmation'].includes(b.status) && (
            <Button size="sm" variant="outline" onClick={() => setCancelId(b._id)}>
              <XCircle /> Cancel
            </Button>
          )}
        </Card>
      ))}
      <BatchDialog id={open} onClose={() => setOpen(null)} />
      <ConfirmDialog
        open={!!cancelId}
        onOpenChange={(o) => !o && setCancelId(null)}
        title="Cancel this batch?"
        description="Queued videos are cancelled and running jobs stop at the next safe point. Completed videos and cached assets are kept."
        confirmLabel="Cancel batch"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancelId && cancel.mutate(cancelId, { onSuccess: () => setCancelId(null) })}
      />
    </div>
  );
}

function BatchDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useBatch(id);
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{data?.batch.name ?? 'Batch'}</DialogTitle>
          <DialogDescription>{data ? `${data.videos.length} videos · ${formatUsd(data.batch.actualCost)} spent of ${formatUsd(data.batch.estimate?.total)} estimated` : 'Loading…'}</DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <LoadingRows rows={4} />
        ) : (
          <div className="space-y-2">
            {data.videos.map((v) => (
              <Link key={v._id} href={`/videos/${v._id}`} onClick={onClose} className="flex items-center gap-3 rounded-md border p-2.5 hover:border-primary/40">
                <span className="w-8 text-xs tabular-nums text-muted-foreground">{v.episodeNumber}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-hindi text-sm">{v.episodeTitle}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Progress value={v.progress} className="h-1 flex-1" tone={v.status === 'failed' ? 'danger' : v.status === 'completed' ? 'success' : 'primary'} />
                    <span className="w-28 truncate text-[11px] text-muted-foreground">{v.stage}</span>
                  </div>
                </div>
                <StatusBadge status={v.status} />
              </Link>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
