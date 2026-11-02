'use client';
import * as React from 'react';
import Link from 'next/link';
import { Film, LayoutGrid, List } from 'lucide-react';
import { VIDEO_STATUSES } from '@mas/shared';
import { useVideos } from '@/lib/queries/video';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, StatusBadge, humanize } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SimpleSelect } from '@/components/ui/select';
import { Progress } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { VideoThumb } from '@/components/video-thumb';
import { VideoActions } from '@/components/video/actions';
import { cn, formatBytes, formatDate, formatSeconds, formatUsd } from '@/lib/utils';

export default function VideoLibraryPage() {
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [view, setView] = React.useState<'grid' | 'table'>('grid');
  const pageSize = 24;
  const { data, isLoading, error, refetch, isFetching } = useVideos({ status: status || undefined, page, pageSize });

  return (
    <>
      <PageHeader
        icon={Film}
        title="Video Library"
        description="Every rendered version is kept. Regenerating creates a new version and never overwrites a previous successful video."
        actions={
          <>
            <SimpleSelect
              className="w-44"
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[{ value: '', label: 'All statuses' }, ...VIDEO_STATUSES.map((s) => ({ value: s, label: humanize(s) }))]}
            />
            <div className="flex rounded-md border p-0.5">
              <Button size="icon-sm" variant={view === 'grid' ? 'secondary' : 'ghost'} onClick={() => setView('grid')} aria-label="Grid view">
                <LayoutGrid />
              </Button>
              <Button size="icon-sm" variant={view === 'table' ? 'secondary' : 'ghost'} onClick={() => setView('table')} aria-label="Table view">
                <List />
              </Button>
            </div>
          </>
        }
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} className="mb-4" />}
      {isLoading ? (
        <LoadingRows />
      ) : !data?.items.length ? (
        <EmptyState
          icon={Film}
          title="No videos yet"
          description="Start a batch in the Video Studio to produce your first short."
          action={
            <Button asChild>
              <Link href="/video-studio">Open Video Studio</Link>
            </Button>
          }
        />
      ) : view === 'grid' ? (
        <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6', isFetching && 'opacity-90')}>
          {data.items.map((v) => (
            <Card key={v._id} className="overflow-hidden">
              <Link href={`/videos/${v._id}`} className="block">
                <VideoThumb path={v.thumbnailPath} className="rounded-none border-0 border-b" alt={v.episodeTitle} />
              </Link>
              <div className="space-y-2 p-3">
                <Link href={`/videos/${v._id}`} className="block">
                  <div className="truncate font-hindi text-sm font-medium">
                    {v.episodeNumber}. {v.episodeTitle}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    v{v.version} · {formatSeconds(v.duration)} · {v.resolution ?? '1080×1920'} · {formatBytes(v.fileSize)}
                  </div>
                </Link>
                {!['completed', 'failed', 'cancelled'].includes(v.status) && <Progress value={v.progress} />}
                <div className="flex items-center justify-between">
                  <StatusBadge status={v.status} />
                  <VideoActions video={v} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH />
                <TH>Episode</TH>
                <TH>Version</TH>
                <TH>Duration</TH>
                <TH>Resolution</TH>
                <TH>Size</TH>
                <TH>Created</TH>
                <TH>Cost</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((v) => (
                <TR key={v._id}>
                  <TD className="w-12">
                    <VideoThumb path={v.thumbnailPath} className="w-9" />
                  </TD>
                  <TD>
                    <Link href={`/videos/${v._id}`} className="font-hindi font-medium hover:text-primary">
                      {v.episodeNumber}. {v.episodeTitle}
                    </Link>
                    {v.warnings?.length > 0 && <div className="text-[11px] text-warning">{v.warnings[0]}</div>}
                  </TD>
                  <TD className="tabular-nums">
                    v{v.version} <span className="text-xs text-muted-foreground">(script v{v.scriptVersion})</span>
                  </TD>
                  <TD className="tabular-nums">{formatSeconds(v.duration)}</TD>
                  <TD className="text-xs">{v.resolution ?? '—'}</TD>
                  <TD className="text-xs tabular-nums">{formatBytes(v.fileSize)}</TD>
                  <TD className="text-xs text-muted-foreground">{formatDate(v.createdAt, true)}</TD>
                  <TD className="text-xs tabular-nums">{formatUsd(v.actualCost)}</TD>
                  <TD>
                    <StatusBadge status={v.status} />
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end">
                      <VideoActions video={v} />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {data && data.total > 0 && (
        <div className="mt-4 flex justify-end">
          <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />
        </div>
      )}
    </>
  );
}
