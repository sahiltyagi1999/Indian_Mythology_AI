'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCheck, Download, FileText, Lock, LockOpen, Search, X } from 'lucide-react';
import { EPISODE_STATUSES, EPISODE_STATUS_LABELS, NARRATION_STYLES, VIDEO_STATUSES } from '@mas/shared';
import { useBulkEpisodes, useEpisodeFacets, useEpisodes, type EpisodeFilters } from '@/lib/queries/episodes';
import { downloadPost, errorMessage } from '@/lib/api';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, StatusBadge, humanize } from '@/components/common';
import { SourceSelect } from '@/components/source-select';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/misc';
import { cn, formatSeconds, timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

const styleName = (id?: string) => NARRATION_STYLES.find((s) => s.id === id)?.name ?? id ?? '—';

export default function ScriptStudioPage() {
  const router = useRouter();
  const [f, setF] = React.useState<EpisodeFilters>({ sourceId: '', sort: 'episodeNumber', page: 1, pageSize: 50, status: [] });
  const [searchInput, setSearchInput] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const query = { ...f, status: f.status?.length ? f.status : undefined, sourceId: f.sourceId || undefined };
  const { data, isLoading, error, refetch, isFetching } = useEpisodes(query);
  const facets = useEpisodeFacets(f.sourceId || undefined);
  const bulk = useBulkEpisodes();
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setF((p) => (p.search === (searchInput || undefined) ? p : { ...p, search: searchInput || undefined, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((e) => selected.has(e._id));
  const someOnPage = items.some((e) => selected.has(e._id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const set = (patch: Partial<EpisodeFilters>) => setF((p) => ({ ...p, ...patch, page: 1 }));
  const ids = [...selected];

  const doExport = async (format: 'json' | 'csv' | 'txt') => {
    setExporting(true);
    try {
      await downloadPost('/episodes/export', { ids, format }, `episodes.${format}`);
      toast.success(`Exported ${ids.length} episodes`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader icon={FileText} title="Script Studio" description="Review, edit, approve and lock episode scripts. Everything here is loaded from MongoDB — approved and locked scripts are never regenerated automatically." />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceSelect allowAll value={f.sourceId ?? ''} onChange={(v) => set({ sourceId: v })} className="w-52" />
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 font-hindi" placeholder="Search title, narration, character or episode #" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <SimpleSelect
            className="w-44"
            value={f.character ?? ''}
            onValueChange={(v) => set({ character: v || undefined })}
            options={[{ value: '', label: 'All characters' }, ...(facets.data?.characters ?? []).map((c) => ({ value: c.name, label: `${c.name} (${c.count})` }))]}
          />
          <SimpleSelect
            className="w-52"
            value={f.style ?? ''}
            onValueChange={(v) => set({ style: v || undefined })}
            options={[{ value: '', label: 'All narration styles' }, ...NARRATION_STYLES.map((s) => ({ value: s.id, label: `${s.name}${facets.data?.styles.find((x) => x.id === s.id) ? ` (${facets.data.styles.find((x) => x.id === s.id)!.count})` : ''}` }))]}
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-40 justify-between">
                {f.status?.length ? `${f.status.length} status${f.status.length > 1 ? 'es' : ''}` : 'All statuses'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 space-y-1">
              {EPISODE_STATUSES.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                  <Checkbox
                    checked={f.status?.includes(s)}
                    onCheckedChange={(c) => set({ status: c ? [...(f.status ?? []), s] : (f.status ?? []).filter((x) => x !== s) })}
                  />
                  <span className="flex-1">{EPISODE_STATUS_LABELS[s]}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{facets.data?.statuses[s] ?? 0}</span>
                </label>
              ))}
            </PopoverContent>
          </Popover>
          <SimpleSelect
            className="w-40"
            value={f.videoStatus ?? ''}
            onValueChange={(v) => set({ videoStatus: v || undefined })}
            options={[{ value: '', label: 'Any video status' }, { value: 'none', label: 'No video' }, ...VIDEO_STATUSES.map((s) => ({ value: s, label: humanize(s) }))]}
          />
          <SimpleSelect
            className="w-44"
            value={f.sort ?? 'episodeNumber'}
            onValueChange={(v) => set({ sort: v })}
            options={[
              { value: 'episodeNumber', label: 'Chronological' },
              { value: '-episodeNumber', label: 'Reverse chronological' },
              { value: '-updatedAt', label: 'Recently updated' },
              { value: 'title', label: 'Title' },
            ]}
          />
          {(f.search || f.character || f.style || f.status?.length || f.videoStatus) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setF({ sourceId: f.sourceId, sort: f.sort, page: 1, pageSize: 50, status: [] });
              }}
            >
              <X /> Clear
            </Button>
          )}
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-surface-raised/95 px-4 py-2 shadow-lg backdrop-blur">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="secondary" loading={bulk.isPending && bulk.variables?.action === 'approve'} onClick={() => bulk.mutate({ ids, action: 'approve' })}>
            <CheckCheck /> Approve
          </Button>
          <Button size="sm" variant="outline" loading={bulk.isPending && bulk.variables?.action === 'lock'} onClick={() => bulk.mutate({ ids, action: 'lock' })}>
            <Lock /> Lock
          </Button>
          <Button size="sm" variant="outline" loading={bulk.isPending && bulk.variables?.action === 'unlock'} onClick={() => bulk.mutate({ ids, action: 'unlock' })}>
            <LockOpen /> Unlock
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" loading={exporting}>
                <Download /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => doExport('csv')}>CSV (spreadsheet)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => doExport('txt')}>Plain text (narration)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => doExport('json')}>JSON (full data)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {error && <ErrorState error={error} onRetry={() => refetch()} className="mb-4" />}
      {isLoading ? (
        <LoadingRows rows={10} />
      ) : !items.length ? (
        <EmptyState
          icon={FileText}
          title="No episodes match"
          description="Episodes appear here after you approve a source's outline and generate scripts."
          action={
            <Button variant="outline" asChild>
              <Link href="/sources">Go to Story Sources</Link>
            </Button>
          }
        />
      ) : (
        <Card className={cn('overflow-hidden transition-opacity', isFetching && 'opacity-80')}>
          <div className="max-h-[calc(100vh-300px)] overflow-auto">
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">
                    <Checkbox
                      checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                      onCheckedChange={(c) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          items.forEach((e) => (c ? n.add(e._id) : n.delete(e._id)));
                          return n;
                        })
                      }
                      aria-label="Select page"
                    />
                  </TH>
                  <TH>#</TH>
                  <TH>Episode</TH>
                  <TH>Main characters</TH>
                  <TH>Narration style</TH>
                  <TH>Duration</TH>
                  <TH>Script</TH>
                  <TH>Video</TH>
                  <TH>Updated</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((e) => (
                  <TR key={e._id} data-state={selected.has(e._id) ? 'selected' : undefined} className="cursor-pointer" onClick={() => router.push(`/scripts/${e._id}`)}>
                    <TD onClick={(ev) => ev.stopPropagation()}>
                      <Checkbox checked={selected.has(e._id)} onCheckedChange={() => toggle(e._id)} aria-label={`Select episode ${e.episodeNumber}`} />
                    </TD>
                    <TD className="tabular-nums text-muted-foreground">{e.episodeNumber}</TD>
                    <TD className="max-w-sm">
                      <div className="truncate font-hindi font-medium">{e.title}</div>
                      <div className="truncate font-hindi text-xs text-muted-foreground">{e.summary}</div>
                    </TD>
                    <TD className="max-w-[180px] truncate text-xs text-muted-foreground">{e.characters.slice(0, 3).join(', ')}</TD>
                    <TD className="text-xs">
                      {styleName(e.styleOverride || e.narrationStyle)}
                      {e.styleOverride && <span className="ml-1 text-[10px] text-primary">override</span>}
                    </TD>
                    <TD className="whitespace-nowrap text-xs tabular-nums">
                      {e.actualAudioDuration ? (
                        <Tooltip content="Measured from generated audio">
                          <span>{formatSeconds(e.actualAudioDuration)}</span>
                        </Tooltip>
                      ) : (
                        <Tooltip content="Estimated before audio exists">
                          <span className="text-muted-foreground">~{formatSeconds(e.estimatedDuration)}</span>
                        </Tooltip>
                      )}
                    </TD>
                    <TD>
                      <StatusBadge status={e.status} />
                      {e.quality?.overall !== undefined && <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">QA {e.quality.overall}/10</div>}
                    </TD>
                    <TD>
                      <StatusBadge status={e.videoStatus ?? 'none'} />
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(e.updatedAt)}</TD>
                    <TD className="text-right" onClick={(ev) => ev.stopPropagation()}>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/scripts/${e._id}`}>Open</Link>
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <SimpleSelect
              className="h-8 w-28"
              value={String(f.pageSize)}
              onValueChange={(v) => set({ pageSize: Number(v) })}
              options={[25, 50, 100, 200].map((n) => ({ value: String(n), label: `${n} / page` }))}
            />
            <Pagination page={f.page ?? 1} pageSize={f.pageSize ?? 50} total={data?.total ?? 0} onPage={(p) => setF((x) => ({ ...x, page: p }))} />
          </div>
        </Card>
      )}
    </>
  );
}
