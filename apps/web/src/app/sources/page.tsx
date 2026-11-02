'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, MoreHorizontal, Play, RefreshCcw, Replace, ScanText, Trash2, Upload } from 'lucide-react';
import { useDeleteSource, useProcessSource, useSources } from '@/lib/queries/sources';
import type { SourceListItem } from '@/lib/types';
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatusBadge } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { ReplaceFileDialog, UploadSourceDialog } from '@/components/sources/upload-dialog';
import { SourceProgress } from '@/components/sources/source-progress';
import { formatBytes, formatDate } from '@/lib/utils';

export default function SourcesPage() {
  const { data, isLoading, error, refetch } = useSources();
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [replaceId, setReplaceId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<SourceListItem | null>(null);
  const process = useProcessSource();
  const remove = useDeleteSource();
  const router = useRouter();

  return (
    <>
      <PageHeader
        icon={Upload}
        title="Story Sources"
        description="Upload the Mahabharata edition you want to retell. Processing extracts text page by page, OCRs bad pages, chunks the text and indexes it for retrieval."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload /> Upload PDF
          </Button>
        }
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} className="mb-4" />}
      {isLoading ? (
        <LoadingRows />
      ) : !data?.length ? (
        <EmptyState
          icon={FileText}
          title="No sources yet"
          description="Upload a Mahabharata PDF to start the Story Engine. Large, scanned and Hindi legacy-font PDFs are supported."
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload /> Upload PDF
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Source</TH>
                <TH>Size</TH>
                <TH>Uploaded</TH>
                <TH>Status</TH>
                <TH>Processing</TH>
                <TH>Outline / episodes</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((s) => {
                const episodes = Object.values(s.episodeCounts ?? {}).reduce((a, b) => a + (b ?? 0), 0);
                const canProcess = ['uploaded', 'failed'].includes(s.status);
                return (
                  <TR key={s._id} className="cursor-pointer" onClick={() => router.push(`/sources/${s._id}`)}>
                    <TD>
                      <div className="font-hindi font-medium">{s.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.fileName}
                        {s.edition ? ` · ${s.edition}` : ''}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatBytes(s.fileSize)}
                      <div className="text-xs">{s.totalPages} pages</div>
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(s.createdAt)}</TD>
                    <TD>
                      <StatusBadge status={s.status} />
                    </TD>
                    <TD>
                      <SourceProgress s={s} />
                    </TD>
                    <TD className="text-xs text-muted-foreground">
                      {s.latestOutline ? (
                        <div className="flex items-center gap-2">
                          <span>v{s.latestOutline.version}</span>
                          <StatusBadge status={s.latestOutline.status} />
                          <span>{s.latestOutline.episodes} planned</span>
                        </div>
                      ) : (
                        '—'
                      )}
                      {episodes > 0 && <div className="mt-1">{episodes} episodes created</div>}
                    </TD>
                    <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {canProcess && (
                          <Button size="sm" onClick={() => process.mutate({ id: s._id })} loading={process.isPending && process.variables?.id === s._id}>
                            <Play /> Process
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label="More actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem asChild>
                              <Link href={`/sources/${s._id}`}>
                                <FileText /> Open
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => process.mutate({ id: s._id })}>
                              <RefreshCcw /> Re-run processing
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!s.stats?.failedPages} onSelect={() => process.mutate({ id: s._id, retryFailedOcr: true })}>
                              <ScanText /> Retry failed OCR pages
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={episodes > 0} onSelect={() => setReplaceId(s._id)}>
                              <Replace /> Replace file
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive disabled={episodes > 0} onSelect={() => setDeleteTarget(s)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
      <UploadSourceDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      {replaceId && <ReplaceFileDialog sourceId={replaceId} open onOpenChange={(o) => !o && setReplaceId(null)} />}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this source?"
        description={`"${deleteTarget?.title}" and its extracted text, chunks, vectors and outlines will be permanently removed. Sources with episodes cannot be deleted.`}
        confirmLabel="Delete source"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </>
  );
}
