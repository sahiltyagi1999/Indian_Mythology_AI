'use client';
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, BookMarked, Check, CheckCircle2, ListTree, Pencil, Sparkles, Wand2, X } from 'lucide-react';
import { useApproveOutline, useEditPlannedEpisode, useEras, useGenerateOutline, useGenerateScripts, useOutline, useOutlineVersions } from '@/lib/queries/sources';
import type { OutlineFull, SourceDetail } from '@/lib/types';
import { EmptyState, ErrorState, LoadingRows, StatusBadge } from '../common';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input, Textarea } from '../ui/input';
import { Field } from '../ui/label';
import { Progress, Tooltip } from '../ui/misc';
import { SimpleSelect } from '../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '../ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { formatDate } from '@/lib/utils';

export function OutlinePanel({ source }: { source: SourceDetail }) {
  const versions = useOutlineVersions(source._id);
  const [selected, setSelected] = React.useState<string | null>(null);
  const current = selected ?? versions.data?.[0]?._id ?? null;
  const outline = useOutline(current);
  const generate = useGenerateOutline();
  const canGenerate = ['indexed', 'outlined', 'analyzing'].includes(source.status);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Master storyline</CardTitle>
            <CardDescription>
              Events are extracted from every segment, put in story chronology (not narration order), de-duplicated, and grouped into ~55-second episodes. Review and approve before scripts are written.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {!!versions.data?.length && (
              <SimpleSelect
                className="w-44"
                value={current ?? ''}
                onValueChange={setSelected}
                options={versions.data.map((v) => ({ value: v._id, label: `Version ${v.version} · ${v.status}` }))}
              />
            )}
            <Tooltip content={canGenerate ? undefined : 'Process and index the PDF first'}>
              <span>
                <Button onClick={() => generate.mutate(source._id, { onSuccess: (r) => setSelected(r.outline._id) })} disabled={!canGenerate} loading={generate.isPending}>
                  <Sparkles /> {versions.data?.length ? 'New outline version' : 'Generate outline'}
                </Button>
              </span>
            </Tooltip>
          </div>
        </CardHeader>
      </Card>
      {versions.isLoading || (current && outline.isLoading) ? (
        <LoadingRows rows={4} />
      ) : outline.error ? (
        <ErrorState error={outline.error} />
      ) : !outline.data ? (
        <EmptyState icon={ListTree} title="No outline yet" description={canGenerate ? 'Generate the master storyline from the indexed source.' : 'Process the PDF first; outline generation needs the indexed text.'} />
      ) : (
        <OutlineView outline={outline.data} />
      )}
    </div>
  );
}

function OutlineView({ outline }: { outline: OutlineFull }) {
  const approve = useApproveOutline();
  const [genOpen, setGenOpen] = React.useState(false);
  const eras = useEras();
  const eraLabel = (id?: string) => eras.data?.find((e) => e.id === id)?.label ?? id ?? '';

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Version {outline.version}</span>
              <StatusBadge status={outline.status} />
              {outline.llmModel && <Badge>{outline.llmModel}</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {outline.events.length} events · {outline.episodes.length} planned episodes · {outline.contradictions.length} contradictions / variants · created {formatDate(outline.createdAt, true)}
            </div>
          </div>
          <div className="flex gap-2">
            {outline.status === 'draft' && (
              <Button variant="secondary" onClick={() => approve.mutate(outline._id)} loading={approve.isPending}>
                <CheckCircle2 /> Approve outline
              </Button>
            )}
            {outline.status === 'approved' && (
              <Button onClick={() => setGenOpen(true)}>
                <Wand2 /> Generate scripts
              </Button>
            )}
          </div>
        </div>
        {outline.status === 'generating' && (
          <div className="mt-4 space-y-1.5">
            <Progress value={outline.progress?.percent ?? 0} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{outline.progress?.message || outline.progress?.stage}</span>
              <span className="tabular-nums">
                {outline.segmentsProcessed}/{outline.segmentsTotal} segments
              </span>
            </div>
          </div>
        )}
        {outline.status === 'failed' && outline.error && <p className="mt-3 text-sm text-destructive">{outline.error}</p>}
      </Card>

      <Tabs defaultValue="episodes">
        <TabsList>
          <TabsTrigger value="episodes">Planned episodes ({outline.episodes.length})</TabsTrigger>
          <TabsTrigger value="events">Event timeline ({outline.events.length})</TabsTrigger>
          <TabsTrigger value="contradictions">Variants & contradictions ({outline.contradictions.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="episodes">
          <PlannedEpisodes outline={outline} />
        </TabsContent>
        <TabsContent value="events">
          <Card className="max-h-[640px] overflow-auto">
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Era</TH>
                  <TH>Event</TH>
                  <TH>Characters</TH>
                  <TH>Importance</TH>
                  <TH>Certainty</TH>
                  <TH>Pages</TH>
                </TR>
              </THead>
              <TBody>
                {outline.events.map((e) => (
                  <TR key={e.eventId}>
                    <TD className="tabular-nums text-muted-foreground">{e.order + 1}</TD>
                    <TD>
                      <Tooltip content={eraLabel(e.era)}>
                        <span className="cursor-help text-xs">{e.era}</span>
                      </Tooltip>
                    </TD>
                    <TD className="max-w-xl">
                      <div className="font-hindi font-medium">{e.title}</div>
                      <div className="text-xs text-muted-foreground">{e.summary}</div>
                      {e.notes && <div className="mt-1 text-[11px] text-warning/90">{e.notes}</div>}
                      {e.embeddedTale && <Badge tone="indigo" className="mt-1">embedded tale</Badge>}
                    </TD>
                    <TD className="text-xs text-muted-foreground">{e.characters.join(', ')}</TD>
                    <TD className="tabular-nums">{e.importance ?? '—'}/5</TD>
                    <TD>
                      <Badge tone={e.certainty === 'certain' ? 'success' : e.certainty === 'varies' ? 'warning' : 'neutral'}>{e.certainty}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {e.pageStart}–{e.pageEnd}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="contradictions">
          {outline.contradictions.length === 0 ? (
            <EmptyState icon={Check} title="No contradictions detected" description="Events where the source presents differing accounts would appear here; they are never merged silently." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {outline.contradictions.map((c, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div>
                      <div className="font-hindi font-medium">{c.topic}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                      <p className="mt-2 text-xs text-muted-foreground">Pages {c.pageRefs.join('–')}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      <GenerateScriptsDialog outline={outline} open={genOpen} onOpenChange={setGenOpen} />
    </div>
  );
}

function PlannedEpisodes({ outline }: { outline: OutlineFull }) {
  const [editing, setEditing] = React.useState<number | null>(null);
  const [title, setTitle] = React.useState('');
  const [synopsis, setSynopsis] = React.useState('');
  const edit = useEditPlannedEpisode(outline._id);
  if (!outline.episodes.length) return <EmptyState icon={BookMarked} title="No episodes planned yet" description="Episodes appear as the planner works through the event timeline." />;
  return (
    <div className="space-y-2">
      {outline.episodes.map((ep) => (
        <Card key={ep.episodeNumber} className="p-4">
          {editing === ep.episodeNumber ? (
            <div className="space-y-3">
              <Field label="Title">
                <Input className="font-hindi" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Synopsis">
                <Textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} rows={3} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  <X /> Cancel
                </Button>
                <Button size="sm" loading={edit.isPending} onClick={() => edit.mutate({ n: ep.episodeNumber, title, synopsis }, { onSuccess: () => setEditing(null) })}>
                  <Check /> Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold tabular-nums text-primary">{ep.episodeNumber}</div>
              <div className="min-w-0 flex-1">
                <div className="font-hindi font-medium">{ep.title}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{ep.synopsis}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  <span>{ep.characters.join(', ')}</span>
                  <span>
                    pp. {ep.pageStart}–{ep.pageEnd}
                  </span>
                  <span>{ep.eventIds.length} events</span>
                </div>
                {ep.continuityNote && <p className="mt-1 text-[11px] italic text-muted-foreground/80">{ep.continuityNote}</p>}
              </div>
              {outline.status === 'draft' && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Edit planned episode"
                  onClick={() => {
                    setEditing(ep.episodeNumber);
                    setTitle(ep.title);
                    setSynopsis(ep.synopsis);
                  }}
                >
                  <Pencil />
                </Button>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function GenerateScriptsDialog({ outline, open, onOpenChange }: { outline: OutlineFull; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mode, setMode] = React.useState<'all' | 'next' | 'range'>('next');
  const [limit, setLimit] = React.useState(10);
  const [from, setFrom] = React.useState(1);
  const [to, setTo] = React.useState(Math.min(10, outline.episodes.length));
  const gen = useGenerateScripts();
  const [result, setResult] = React.useState<{ created: number; queued: number; total: number } | null>(null);
  React.useEffect(() => {
    if (!open) setResult(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate episode scripts</DialogTitle>
          <DialogDescription>
            Scripts are written in chronological order in the background, quality-checked, and saved as drafts for your review. Episodes that already have a script are skipped — nothing is regenerated automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {(
            [
              ['next', 'Next batch', 'Write the next N pending episodes (recommended for a first review pass)'],
              ['range', 'Episode range', 'Write a specific range of episode numbers'],
              ['all', `All ${outline.episodes.length} episodes`, 'Queue the complete storyline'],
            ] as const
          ).map(([v, label, hint]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${mode === v ? 'border-primary/60 bg-primary/5' : ''}`}>
              <input type="radio" className="mt-1 accent-[hsl(var(--primary))]" checked={mode === v} onChange={() => setMode(v)} />
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{hint}</div>
              </div>
            </label>
          ))}
        </div>
        {mode === 'next' && (
          <Field label="Number of episodes">
            <Input type="number" min={1} max={2000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </Field>
        )}
        {mode === 'range' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From episode">
              <Input type="number" min={1} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
            </Field>
            <Field label="To episode">
              <Input type="number" min={from} value={to} onChange={(e) => setTo(Number(e.target.value))} />
            </Field>
          </div>
        )}
        {result && (
          <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
            {result.created} new episodes · {result.queued} scripts queued · {result.total} in selection.{' '}
            <Link href="/queue" className="text-primary underline">
              Watch the queue
            </Link>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            loading={gen.isPending}
            onClick={() =>
              gen.mutate(
                { outlineId: outline._id, ...(mode === 'next' ? { limit } : mode === 'range' ? { from, to } : {}) },
                { onSuccess: (r) => setResult(r) },
              )
            }
          >
            <Wand2 /> Queue scripts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
