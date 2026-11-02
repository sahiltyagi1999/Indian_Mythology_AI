'use client';
import * as React from 'react';
import Link from 'next/link';
import { Calculator, Clapperboard, Rocket, ShieldCheck } from 'lucide-react';
import { NARRATION_STYLES, type CostEstimate, type VideoGenerationSettings } from '@mas/shared';
import { useEpisodes } from '@/lib/queries/episodes';
import { useCreateBatch, useEstimateBatch } from '@/lib/queries/video';
import { useSettings } from '@/lib/queries/misc';
import { ApiError } from '@/lib/api';
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatusBadge } from '@/components/common';
import { SourceSelect } from '@/components/source-select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VideoSettingsPanel } from '@/components/video/settings-panel';
import { EstimateView } from '@/components/video/estimate-view';
import { formatSeconds, formatUsd, uuid } from '@/lib/utils';

const DEFAULT_SUBS: VideoGenerationSettings['subtitles'] = {
  font: 'Kohinoor Devanagari',
  fontSize: 64,
  textColor: '#FFFFFF',
  highlightColor: '#FFC83D',
  backgroundOpacity: 0.45,
  positionFromBottom: 0.24,
  animation: 'pop',
};

export default function VideoStudioPage() {
  const [sourceId, setSourceId] = React.useState('');
  const episodes = useEpisodes({ sourceId: sourceId || undefined, status: ['approved', 'locked'], sort: 'episodeNumber', pageSize: 500 });
  const settings = useSettings();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [concurrency, setConcurrency] = React.useState(2);
  const [cfg, setCfg] = React.useState<VideoGenerationSettings | null>(null);
  const [estimate, setEstimate] = React.useState<CostEstimate | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [idemKey, setIdemKey] = React.useState('');
  const [name, setName] = React.useState('');
  const [budgetExceeds, setBudgetExceeds] = React.useState<string[] | null>(null);
  const [ackBudget, setAckBudget] = React.useState(false);
  const [started, setStarted] = React.useState<{ batchId: string; count: number } | null>(null);
  const estimateM = useEstimateBatch();
  const create = useCreateBatch();

  React.useEffect(() => {
    if (!cfg && settings.data) {
      const s = settings.data.settings;
      setCfg({
        voiceId: s.elevenlabs.voiceId,
        ttsModel: '',
        visualStyle: 'epic-mythology',
        resolution: s.google.videoResolution ?? '720p',
        videoProvider: s.google.videoProvider || 'gemini-omni',
        videoModel: '',
        musicVolume: s.render.musicVolume,
        sfxIntensity: s.render.sfxIntensity,
        subtitles: { ...DEFAULT_SUBS, ...s.render.subtitles },
      });
    }
  }, [settings.data, cfg]);

  // Any change to the selection or settings invalidates the shown estimate.
  React.useEffect(() => setEstimate(null), [selected, cfg, concurrency]);

  const items = episodes.data?.items ?? [];
  const ids = [...selected];
  const all = items.length > 0 && items.every((e) => selected.has(e._id));
  const request = () => ({ name: name || undefined, episodeIds: ids, settings: cfg!, maxConcurrency: concurrency });

  const runEstimate = () => estimateM.mutate(request(), { onSuccess: setEstimate });
  const openConfirm = () => {
    setIdemKey(uuid());
    setBudgetExceeds(null);
    setAckBudget(false);
    setName((n) => n || `Batch · ${ids.length} episode${ids.length === 1 ? '' : 's'} · ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
    setConfirmOpen(true);
  };
  const start = () =>
    create.mutate(
      { ...request(), confirm: true, acknowledgeBudget: ackBudget, idempotencyKey: idemKey },
      {
        onSuccess: (r) => {
          setConfirmOpen(false);
          setStarted({ batchId: r.batch._id, count: r.videos.length });
          setSelected(new Set());
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'BUDGET_CONFIRMATION_REQUIRED') {
            const d = e.details as { exceeds?: string[]; estimate?: CostEstimate } | undefined;
            setBudgetExceeds(d?.exceeds ?? ['Budget limit exceeded']);
            if (d?.estimate) setEstimate(d.estimate);
          }
        },
      },
    );

  return (
    <>
      <PageHeader
        icon={Clapperboard}
        title="Video Studio"
        description="Turn approved scripts into vertical 9:16 cinematic shorts. Nothing is generated until you review the cost estimate and confirm. Jobs keep running if you leave this page."
        actions={<SourceSelect allowAll value={sourceId} onChange={setSourceId} />}
      />
      {started && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-success/30 bg-success/5 p-4 text-sm">
          <span>
            Batch started with {started.count} video{started.count === 1 ? '' : 's'}. Generation continues in the background.
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/queue">Open queue</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/videos">Video Library</Link>
            </Button>
          </div>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Approved episodes</CardTitle>
              <p className="text-xs text-muted-foreground">Only approved or locked scripts can be produced.</p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{selected.size} selected</span>
          </CardHeader>
          {episodes.error && <ErrorState error={episodes.error} className="m-4" />}
          {episodes.isLoading ? (
            <LoadingRows className="p-4" />
          ) : !items.length ? (
            <CardContent>
              <EmptyState
                icon={ShieldCheck}
                title="No approved scripts yet"
                description="Approve scripts in the Script Studio. Approved scripts are reused for every video — the storyline is never regenerated here."
                action={
                  <Button asChild variant="outline">
                    <Link href="/scripts">Open Script Studio</Link>
                  </Button>
                }
              />
            </CardContent>
          ) : (
            <div className="max-h-[calc(100vh-260px)] overflow-auto border-t">
              <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-3 border-b bg-surface-raised/95 px-4 py-2.5 text-sm backdrop-blur">
                <Checkbox checked={all ? true : selected.size ? 'indeterminate' : false} onCheckedChange={(c) => setSelected(c ? new Set(items.map((e) => e._id)) : new Set())} />
                Select all {items.length} approved episodes
              </label>
              {items.map((e) => (
                <label key={e._id} className="flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 last:border-0 hover:bg-accent/40">
                  <Checkbox
                    checked={selected.has(e._id)}
                    onCheckedChange={(c) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (c) n.add(e._id);
                        else n.delete(e._id);
                        return n;
                      })
                    }
                  />
                  <span className="w-8 text-xs tabular-nums text-muted-foreground">{e.episodeNumber}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-hindi text-sm font-medium">{e.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {NARRATION_STYLES.find((s) => s.id === (e.styleOverride || e.narrationStyle))?.name} · ~{formatSeconds(e.actualAudioDuration ?? e.estimatedDuration)}
                    </div>
                  </div>
                  <StatusBadge status={e.status} />
                  <StatusBadge status={e.videoStatus ?? 'none'} />
                </label>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Production settings</CardTitle>
            </CardHeader>
            <CardContent>{cfg ? <VideoSettingsPanel value={cfg} onChange={setCfg} concurrency={concurrency} onConcurrency={setConcurrency} /> : <LoadingRows rows={5} />}</CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Cost estimate</CardTitle>
              <Button size="sm" variant="outline" disabled={!selected.size || !cfg} loading={estimateM.isPending} onClick={runEstimate}>
                <Calculator /> {estimate ? 'Re-estimate' : 'Estimate cost'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {estimate ? <EstimateView estimate={estimate} /> : <p className="text-sm text-muted-foreground">Select episodes and estimate the cost before starting. Estimates use your configured models and the pricing catalog in Settings.</p>}
              <Button className="w-full" size="lg" disabled={!estimate || !selected.size} onClick={openConfirm}>
                <Rocket /> Start batch for {selected.size} episode{selected.size === 1 ? '' : 's'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Confirm video generation</DialogTitle>
            <DialogDescription>
              This will call paid APIs (ElevenLabs narration and video generation). Estimated total <strong className="text-foreground">{formatUsd(estimate?.total ?? 0, 2)}</strong> for {ids.length} episode
              {ids.length === 1 ? '' : 's'}. Previously generated audio and scene clips are reused where possible.
            </DialogDescription>
          </DialogHeader>
          <Field label="Batch name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {estimate && <EstimateView estimate={estimate} />}
          {budgetExceeds && (
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <Checkbox checked={ackBudget} onCheckedChange={(c) => setAckBudget(!!c)} className="mt-0.5" />
              <span>
                <span className="font-medium text-destructive">This batch exceeds your budget:</span>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {budgetExceeds.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <span className="mt-1 block text-xs">I understand and want to exceed the budget for this batch.</span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={start} loading={create.isPending} disabled={!!budgetExceeds && !ackBudget} variant={budgetExceeds ? 'destructive' : 'default'}>
              <Rocket /> {budgetExceeds ? 'Start and exceed budget' : `Start · ${formatUsd(estimate?.total ?? 0, 2)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
