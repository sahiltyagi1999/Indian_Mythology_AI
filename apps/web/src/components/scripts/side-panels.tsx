'use client';
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, BookMarked, CheckCircle2, History, XCircle } from 'lucide-react';
import { NARRATION_STYLES } from '@mas/shared';
import type { EpisodeDetail } from '@/lib/types';
import { useScriptVersion } from '@/lib/queries/episodes';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { LoadingRows, StatusBadge } from '../common';
import { HighlightedNarration } from './narration';
import { formatDate, formatSeconds } from '@/lib/utils';

const SCORE_LABELS: Record<string, string> = {
  storyAccuracy: 'Story accuracy',
  sourceConsistency: 'Source consistency',
  chronologicalContinuity: 'Continuity',
  hookQuality: 'Hook',
  narrationNaturalness: 'Naturalness',
  endingQuality: 'Ending',
  nonRepetition: 'Non-repetition',
  characterConsistency: 'Characters',
  durationSuitability: 'Duration',
};

export function QualityCard({ ep }: { ep: EpisodeDetail['episode'] }) {
  const q = ep.quality;
  if (!q) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Quality report</CardTitle>
        <Badge tone={q.passed ? 'success' : 'warning'}>
          {q.passed ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {q.passed ? 'Passed' : 'Needs review'} · {q.overall}/10
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {Object.entries(q.scores).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 text-muted-foreground">{SCORE_LABELS[k] ?? k}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${Number(v) >= 7 ? 'bg-success' : Number(v) >= 5 ? 'bg-warning' : 'bg-destructive'}`} style={{ width: `${Number(v) * 10}%` }} />
              </div>
              <span className="w-8 text-right tabular-nums">{Number(v).toFixed(1)}</span>
            </div>
          ))}
        </div>
        {q.issues?.length > 0 && (
          <ul className="space-y-1 text-xs">
            {q.issues.map((i, n) => (
              <li key={n} className={`flex gap-1.5 ${i.startsWith('CRITICAL') ? 'text-destructive' : 'text-muted-foreground'}`}>
                <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {i}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Evaluated {formatDate(q.evaluatedAt, true)} · {q.attempts} attempt{q.attempts === 1 ? '' : 's'}
        </p>
      </CardContent>
    </Card>
  );
}

export function StyleCard({ ep }: { ep: EpisodeDetail['episode'] }) {
  const style = NARRATION_STYLES.find((s) => s.id === (ep.styleOverride || ep.narrationStyle));
  if (!style) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Narration style</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{style.name}</span>
          <span className="font-hindi text-xs text-muted-foreground">{style.nameHi}</span>
          {ep.styleOverride && <Badge tone="primary">override</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{style.description}</p>
        {ep.styleReason && <p className="text-xs italic text-muted-foreground/90">Why: {ep.styleReason}</p>}
        <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
          <span>Voice: {style.voice}</span>
          <span>Pacing: {style.pacing}</span>
          <span>Intensity: {style.intensity}/5</span>
          <span>Music: {style.musicMood}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function ContinuityCard({ d }: { d: EpisodeDetail }) {
  const ep = d.episode;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Continuity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {d.previous ? (
          <Link href={`/scripts/${d.previous._id}`} className="block rounded-md border p-3 hover:border-primary/40">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Previous · #{d.previous.episodeNumber}</div>
            <div className="font-hindi font-medium">{d.previous.title}</div>
            {d.previous.nextEpisodeTeaser && <div className="mt-1 font-hindi text-xs text-muted-foreground">Teaser: “{d.previous.nextEpisodeTeaser}”</div>}
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">This is the first episode.</p>
        )}
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <ArrowRight className="h-3 w-3" />
          <span className="font-hindi">This hook: “{ep.hook || '—'}”</span>
        </div>
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <ArrowRight className="h-3 w-3" />
          <span className="font-hindi">This teaser: “{ep.nextEpisodeTeaser || '—'}”</span>
        </div>
        {d.next ? (
          <Link href={`/scripts/${d.next._id}`} className="block rounded-md border p-3 hover:border-primary/40">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Next · #{d.next.episodeNumber}</div>
            <div className="font-hindi font-medium">{d.next.title}</div>
            {d.next.hook && <div className="mt-1 font-hindi text-xs text-muted-foreground">Hook: “{d.next.hook}”</div>}
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">No next episode yet.</p>
        )}
        {ep.storyTimeline && <p className="text-xs text-muted-foreground">Timeline: {ep.storyTimeline}</p>}
      </CardContent>
    </Card>
  );
}

export function SourcesCard({ ep }: { ep: EpisodeDetail['episode'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source references ({ep.sourceReferences.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {ep.sourceReferences.length === 0 && <p className="text-xs text-muted-foreground">No references recorded.</p>}
        {ep.sourceReferences.map((r, i) => (
          <details key={i} className="group rounded-md border bg-surface-sunken/60 p-2.5 text-xs">
            <summary className="flex cursor-pointer items-center gap-2">
              <BookMarked className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">
                pp. {r.pageStart}–{r.pageEnd}
              </span>
              {r.section && <span className="truncate font-hindi text-muted-foreground">{r.section}</span>}
            </summary>
            <p className="mt-2 font-hindi leading-6 text-muted-foreground">{r.excerpt}…</p>
          </details>
        ))}
        {ep.uncertaintyNotes && (
          <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {ep.uncertaintyNotes}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VersionsCard({ d }: { d: EpisodeDetail }) {
  const [v, setV] = React.useState<number | null>(null);
  const version = useScriptVersion(d.episode._id, v);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Version history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {d.versions.map((x) => (
          <button key={x._id} onClick={() => setV(x.version)} className="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs hover:border-primary/40">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">v{x.version}</span>
            {x.version === d.episode.currentVersion && <Badge tone="primary">current</Badge>}
            <Badge tone={x.createdBy === 'ai' ? 'indigo' : 'neutral'}>{x.createdBy === 'ai' ? 'AI' : 'Edited'}</Badge>
            <span className="flex-1 truncate text-muted-foreground">{x.changeNote}</span>
            <span className="text-muted-foreground">{formatDate(x.createdAt)}</span>
          </button>
        ))}
        <Dialog open={v !== null} onOpenChange={(o) => !o && setV(null)}>
          <DialogContent size="lg">
            <DialogHeader>
              <DialogTitle>Version {v}</DialogTitle>
              <DialogDescription>
                {version.data ? `${version.data.createdBy === 'ai' ? 'AI generated' : 'User edit'} · ${formatDate(version.data.createdAt, true)} · ~${formatSeconds(version.data.estimatedDuration)}` : 'Loading…'}
              </DialogDescription>
            </DialogHeader>
            {version.isLoading || !version.data ? (
              <LoadingRows rows={4} />
            ) : (
              <div className="space-y-3">
                <h3 className="font-hindi text-lg font-semibold">{version.data.title}</h3>
                <HighlightedNarration text={version.data.narrationText} hook={version.data.hook} ending={version.data.ending} teaser={version.data.nextEpisodeTeaser} className="text-base" />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function VideosCard({ d }: { d: EpisodeDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Videos ({d.videos.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {d.videos.length === 0 && <p className="text-xs text-muted-foreground">No videos yet. Approve this script and add it to a batch in the Video Studio.</p>}
        {d.videos.map((v) => (
          <Link key={v._id} href={`/videos/${v._id}`} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:border-primary/40">
            <span className="font-medium">v{v.version}</span>
            <span className="text-muted-foreground">script v{v.scriptVersion}</span>
            <span className="flex-1 text-muted-foreground">{formatSeconds(v.duration)}</span>
            <StatusBadge status={v.status} />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
