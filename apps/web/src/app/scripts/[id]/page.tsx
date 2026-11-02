'use client';
import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Lock, LockOpen, Pencil, RotateCcw, ShieldCheck, Undo2, Users, Wand2 } from 'lucide-react';
import { useEpisode, useEpisodeAction, useRegenerateEpisode, useRegenerateHinglish } from '@/lib/queries/episodes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { ErrorState, LoadingRows, StatusBadge } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HighlightedNarration, Legend } from '@/components/scripts/narration';
import { ScriptEditor } from '@/components/scripts/editor';
import { ContinuityCard, QualityCard, SourcesCard, StyleCard, VersionsCard, VideosCard } from '@/components/scripts/side-panels';
import { formatSeconds, timeAgo } from '@/lib/utils';

export default function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, isLoading, error, refetch } = useEpisode(id);
  const action = useEpisodeAction();
  const regen = useRegenerateEpisode();
  const [editing, setEditing] = React.useState(false);
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [instructions, setInstructions] = React.useState('');
  const [needsConfirm, setNeedsConfirm] = React.useState(false);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !d) return <LoadingRows rows={8} />;
  const ep = d.episode;
  const busy = action.isPending;

  const submitRegen = (confirmProtected: boolean) =>
    regen.mutate(
      { id, instructions, confirmProtected },
      {
        onSuccess: () => {
          setRegenOpen(false);
          setNeedsConfirm(false);
          setInstructions('');
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'CONFIRM_REQUIRED') setNeedsConfirm(true);
        },
      },
    );

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <Link href="/scripts" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Script Studio
        </Link>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={!d.previous} asChild={!!d.previous}>
            {d.previous ? (
              <Link href={`/scripts/${d.previous._id}`}>
                <ChevronLeft /> #{d.previous.episodeNumber}
              </Link>
            ) : (
              <span>
                <ChevronLeft /> Prev
              </span>
            )}
          </Button>
          <Button size="sm" variant="ghost" disabled={!d.next} asChild={!!d.next}>
            {d.next ? (
              <Link href={`/scripts/${d.next._id}`}>
                #{d.next.episodeNumber} <ChevronRight />
              </Link>
            ) : (
              <span>
                Next <ChevronRight />
              </span>
            )}
          </Button>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-lg font-semibold tabular-nums text-primary">{ep.episodeNumber}</div>
          <div>
            <h1 className="font-hindi text-2xl font-semibold leading-snug">{ep.title}</h1>
            <p className="mt-1 max-w-3xl font-hindi text-sm text-muted-foreground">{ep.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={ep.status} />
              <Badge>v{ep.currentVersion}</Badge>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {ep.actualAudioDuration ? `${formatSeconds(ep.actualAudioDuration)} (audio)` : `~${formatSeconds(ep.estimatedDuration)} est.`} · {ep.estimatedWordCount} words
              </span>
              <span>Updated {timeAgo(ep.updatedAt)}</span>
            </div>
          </div>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {ep.status !== 'locked' && ep.status !== 'generating' && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {['draft', 'review_required'].includes(ep.status) && (
              <Button onClick={() => action.mutate({ id, action: 'approve' })} loading={busy}>
                <ShieldCheck /> Approve
              </Button>
            )}
            {ep.status === 'approved' && (
              <>
                <Button variant="outline" onClick={() => action.mutate({ id, action: 'unapprove' })} loading={busy}>
                  <Undo2 /> Unapprove
                </Button>
                <Button variant="secondary" onClick={() => action.mutate({ id, action: 'lock' })} loading={busy}>
                  <Lock /> Lock
                </Button>
              </>
            )}
            {ep.status === 'locked' && (
              <Button variant="outline" onClick={() => action.mutate({ id, action: 'unlock' })} loading={busy}>
                <LockOpen /> Unlock
              </Button>
            )}
            {ep.status !== 'locked' && ep.status !== 'generating' && (
              <Button variant="ghost" onClick={() => setRegenOpen(true)}>
                <RotateCcw /> Regenerate
              </Button>
            )}
          </div>
        )}
      </div>

      {ep.status === 'generating' && (
        <Card className="mb-4 border-info/30 bg-info/5 p-4 text-sm text-info">A new script version is being generated in the background. This page refreshes automatically.</Card>
      )}

      {editing ? (
        <ScriptEditor ep={ep} onDone={() => setEditing(false)} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
          <div className="space-y-6">
            <NarrationCard ep={ep} />
            {ep.storyArc?.setup && (
              <Card>
                <CardHeader>
                  <CardTitle>Story arc</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-4">
                  {(['setup', 'conflict', 'climax', 'resolution'] as const).map((k) => (
                    <div key={k} className="rounded-md border bg-surface-sunken/60 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
                      <div className="mt-1 font-hindi text-sm">{ep.storyArc[k]}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Scene descriptions ({ep.sceneDescriptions.length})</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {ep.sceneDescriptions.map((s) => (
                  <div key={s.sceneNumber} className="rounded-md border bg-surface-sunken/60 p-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-semibold">Scene {s.sceneNumber}</span>
                      <span className="text-muted-foreground">{s.emotion}</span>
                    </div>
                    <p className="font-hindi text-xs text-primary/90">“{s.narrationExcerpt}”</p>
                    <p className="mt-1.5 text-sm">{s.visual}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {s.environment}
                      {s.characters.length ? ` · ${s.characters.join(', ')}` : ''}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            <QualityCard ep={ep} />
            <ContinuityCard d={d} />
            <StyleCard ep={ep} />
            <Card>
              <CardHeader>
                <CardTitle>Characters</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {ep.characters.map((c) => (
                  <Link key={c} href={`/characters?search=${encodeURIComponent(c)}`}>
                    <Badge tone="indigo" className="hover:border-primary/50">
                      <Users className="h-3 w-3" /> {c}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
            <SourcesCard ep={ep} />
            <VersionsCard d={d} />
            <VideosCard d={d} />
          </div>
        </div>
      )}

      <Dialog
        open={regenOpen}
        onOpenChange={(o) => {
          setRegenOpen(o);
          if (!o) setNeedsConfirm(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate this script?</DialogTitle>
            <DialogDescription>A new version is written from the source passages and quality-checked. The current version stays in history; existing audio and videos are kept but marked as built from an older script.</DialogDescription>
          </DialogHeader>
          <Textarea className="font-hindi" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Optional instructions, e.g. “हुक को और रहस्यमय बनाइए” or “focus on Karna's perspective”" />
          {needsConfirm && (
            <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">This episode is approved. Regenerating will replace the approved text with a new draft that needs re-approval. Confirm to continue.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => submitRegen(needsConfirm)} loading={regen.isPending} variant={needsConfirm ? 'destructive' : 'default'}>
              <Wand2 /> {needsConfirm ? 'Yes, regenerate approved script' : 'Regenerate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type EpisodeData = NonNullable<ReturnType<typeof useEpisode>['data']>['episode'];

/** Hindi narration (what is voiced) with a Hinglish reading copy alongside. */
function NarrationCard({ ep }: { ep: EpisodeData }) {
  const regen = useRegenerateHinglish();
  const stale = !!ep.narrationHinglish && (ep.hinglishVersion ?? 0) < ep.currentVersion;
  return (
    <Card>
      <Tabs defaultValue="hindi">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <CardTitle>Narration</CardTitle>
            <TabsList>
              <TabsTrigger value="hindi" className="font-hindi">हिंदी</TabsTrigger>
              <TabsTrigger value="hinglish">Hinglish</TabsTrigger>
            </TabsList>
          </div>
          <Legend />
        </CardHeader>
        <CardContent>
          <TabsContent value="hindi" className="mt-0">
            {ep.narrationText ? (
              <HighlightedNarration text={ep.narrationText} hook={ep.hook} ending={ep.ending} teaser={ep.nextEpisodeTeaser} />
            ) : (
              <p className="text-sm text-muted-foreground">No script yet — generation is pending.</p>
            )}
          </TabsContent>
          <TabsContent value="hinglish" className="mt-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Reading copy in Roman script. The Hindi text is what gets narrated.</p>
              <div className="flex items-center gap-2">
                {stale && <Badge tone="warning">Out of date — script was edited</Badge>}
                <Button size="sm" variant="outline" disabled={!ep.narrationText} loading={regen.isPending} onClick={() => regen.mutate(ep._id)}>
                  <RotateCcw /> {ep.narrationHinglish ? 'Regenerate Hinglish' : 'Generate Hinglish'}
                </Button>
              </div>
            </div>
            {ep.titleHinglish && <p className="text-base font-semibold">{ep.titleHinglish}</p>}
            {ep.narrationHinglish ? (
              <p className="whitespace-pre-wrap text-lg leading-[1.9] text-foreground/95">{ep.narrationHinglish}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{ep.narrationText ? 'Hinglish copy is being prepared…' : 'Available once the script is written.'}</p>
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
