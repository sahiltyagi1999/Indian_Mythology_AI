'use client';
import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Camera, Copy, Play, Recycle, RotateCcw, ShieldAlert, Sun, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { NARRATION_STYLES, VISUAL_STYLES } from '@mas/shared';
import { useConfirmBudget, useResumeVideo, useRetryScene, useUploadSceneClip, useVideo } from '@/lib/queries/video';
import { ErrorState, KeyValue, LoadingRows, StatusBadge } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/misc';
import { VideoActions } from '@/components/video/actions';
import { elapsed, fileUrl, formatBytes, formatDate, formatSeconds, formatUsd } from '@/lib/utils';

/** The scene prompt is written for video; for a still, ask for one frame and drop the camera move. */
function imagePrompt(prompt: string) {
  return `Create one cinematic still image in vertical 9:16 format. No text, captions or logos.\n${prompt.replace(/ Camera: [^.]*\./, '')}`;
}

export default function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading, error, refetch } = useVideo(id);
  const retry = useRetryScene();
  const resume = useResumeVideo();
  const confirmBudget = useConfirmBudget();
  const uploadClip = useUploadSceneClip();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const uploadFor = React.useRef<number | null>(null);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <LoadingRows rows={8} />;
  const { video: v, scenes, jobs } = data;
  const failedScenes = scenes.filter((s) => s.status === 'failed').length;
  const s = v.settings;
  const manual = v.provider === 'manual';
  const canUpload = ['generating_scenes', 'failed'].includes(v.status);

  const pickClip = (n: number) => {
    uploadFor.current = n;
    fileInput.current?.click();
  };
  const copyPrompt = async (n: number, prompt: string, kind: 'Video' | 'Image') => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(`${kind} prompt for scene ${n} copied`);
    } catch {
      toast.error('Could not copy; select the prompt text instead');
    }
  };

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="video/*,image/*,.mp4,.mov,.webm,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && uploadFor.current !== null) uploadClip.mutate({ id, n: uploadFor.current, file });
        }}
      />
      <Link href="/videos" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Video Library
      </Link>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-hindi text-2xl font-semibold">
            {v.episodeNumber}. {v.episodeTitle}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status={v.status} />
            <Badge>Version {v.version}</Badge>
            <Badge>Script v{v.scriptVersion}</Badge>
            <span>{v.stage}</span>
            <Link href={`/scripts/${v.episodeId}`} className="text-primary hover:underline">
              Open script
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {v.status === 'awaiting_confirmation' && (
            <Button variant="destructive" loading={confirmBudget.isPending} onClick={() => confirmBudget.mutate(id)}>
              <ShieldAlert /> Confirm budget override
            </Button>
          )}
          {['failed', 'cancelled'].includes(v.status) && (
            <Button loading={resume.isPending} onClick={() => resume.mutate(id)}>
              <RotateCcw /> Resume{failedScenes ? ` (${failedScenes} failed scene${failedScenes > 1 ? 's' : ''})` : ''}
            </Button>
          )}
          <VideoActions video={v} onDeleted={() => router.push('/videos')} />
        </div>
      </div>
      {v.status === 'awaiting_confirmation' && (
        <Card className="mb-4 border-warning/30 bg-warning/5 p-4 text-sm text-warning">Paused: continuing would exceed a budget limit. Nothing more is spent until you explicitly confirm.</Card>
      )}
      {v.error && (
        <Card className="mb-4 flex gap-2 border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {v.error}
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            {v.videoPath ? (
              <video src={fileUrl(v.videoPath)} controls playsInline className="aspect-[9/16] w-full bg-black" poster={v.thumbnailPath ? fileUrl(v.thumbnailPath) : undefined} />
            ) : (
              <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 bg-surface-sunken p-6 text-center">
                <Play className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{v.status === 'completed' ? 'File missing' : 'Rendering has not finished yet'}</p>
                {!['completed', 'failed', 'cancelled'].includes(v.status) && <Progress value={v.progress} className="w-2/3" />}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValue
                items={[
                  ['Duration', formatSeconds(v.duration)],
                  ['Resolution', v.resolution ?? '—'],
                  ['File size', formatBytes(v.fileSize)],
                  ['Provider', `${v.provider ?? '—'} · ${v.model ?? '—'}`],
                  ['Visual style', VISUAL_STYLES.find((x) => x.id === s?.visualStyle)?.name ?? s?.visualStyle ?? '—'],
                  ['Narration style', s?.narrationStyleOverride ? NARRATION_STYLES.find((x) => x.id === s.narrationStyleOverride)?.name : 'Episode style'],
                  ['Voice', s?.voiceId || 'Default'],
                  ['Quality', s?.resolution ?? '—'],
                  ['Estimated cost', formatUsd(v.estimatedCost)],
                  ['Actual cost', formatUsd(v.actualCost)],
                  ['Created', formatDate(v.createdAt, true)],
                ]}
              />
            </CardContent>
          </Card>
          {v.warnings?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Warnings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs text-warning">
                {v.warnings.map((w, i) => (
                  <div key={i} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {jobs.map((j) => (
                <div key={j._id} className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs">
                  <span className="font-medium">{j.type}</span>
                  {j.sceneNumber !== undefined && <span className="text-muted-foreground">#{j.sceneNumber}</span>}
                  <span className="flex-1 truncate text-muted-foreground">{elapsed(j.startedAt, j.finishedAt)}</span>
                  <StatusBadge status={j.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Scene timeline ({scenes.length})</h2>
            <span className="text-xs text-muted-foreground">
              {scenes.filter((x) => x.status === 'completed').length} completed · {scenes.filter((x) => x.reusedFrom).length} reused · {failedScenes} failed
            </span>
          </div>
          {scenes.length === 0 && <Card className="p-6 text-sm text-muted-foreground">Scenes are planned after the narration audio is generated.</Card>}
          {manual && scenes.length > 0 && v.status !== 'completed' && (
            <Card className="space-y-1 border-primary/30 bg-primary/5 p-4 text-sm">
              <p className="font-semibold">Manual clips · {scenes.filter((x) => x.status === 'completed').length}/{scenes.length} uploaded</p>
              <p className="text-muted-foreground">
                For each scene: copy the video prompt (for a clip from Gemini or Flow) or the image prompt (for a still), make it in vertical 9:16, download it and
                upload it here. Stills become a slow zoom shot; clips and stills can be mixed. The video renders automatically with narration and subtitles once
                every scene has one.
              </p>
            </Card>
          )}
          {scenes.map((sc) => (
            <Card key={sc._id} className="flex gap-4 p-3">
              <div className="w-24 shrink-0">
                {sc.clipPath ? (
                  <video src={fileUrl(sc.clipPath)} muted loop playsInline className="aspect-[9/16] w-full rounded bg-black" onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
                ) : (
                  <div className="flex aspect-[9/16] w-full items-center justify-center rounded border bg-surface-sunken text-xs text-muted-foreground">{sc.status}</div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">Scene {sc.sceneNumber}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatSeconds(sc.startTime)} → {formatSeconds(sc.startTime + sc.duration)} ({sc.duration.toFixed(1)}s)
                  </span>
                  <StatusBadge status={sc.status} />
                  {sc.reusedFrom && (
                    <Badge tone="success">
                      <Recycle className="h-3 w-3" /> reused
                    </Badge>
                  )}
                  {sc.attempts > 0 && <span className="text-muted-foreground">attempts {sc.attempts}</span>}
                  {sc.cost > 0 && <span className="tabular-nums text-muted-foreground">{formatUsd(sc.cost)}</span>}
                  {sc.status === 'failed' && !manual && (
                    <Button size="sm" variant="outline" className="ml-auto h-7" loading={retry.isPending && retry.variables?.n === sc.sceneNumber} onClick={() => retry.mutate({ id, n: sc.sceneNumber })}>
                      <RotateCcw /> Retry scene
                    </Button>
                  )}
                  {canUpload && sc.status !== 'generating' && (manual || sc.status === 'failed') && (
                    <span className={`flex gap-2 ${sc.status === 'failed' && !manual ? '' : 'ml-auto'}`}>
                      {manual && (
                        <>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => void copyPrompt(sc.sceneNumber, sc.prompt, 'Video')}>
                            <Copy /> Copy video prompt
                          </Button>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => void copyPrompt(sc.sceneNumber, imagePrompt(sc.prompt), 'Image')}>
                            <Copy /> Copy image prompt
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant={sc.status === 'completed' ? 'outline' : 'default'} className="h-7" loading={uploadClip.isPending && uploadClip.variables?.n === sc.sceneNumber} onClick={() => pickClip(sc.sceneNumber)}>
                        <Upload /> {sc.status === 'completed' ? 'Replace' : 'Upload image / clip'}
                      </Button>
                    </span>
                  )}
                </div>
                <p className="font-hindi text-sm text-primary/90">“{sc.narrationSegment}”</p>
                <p className="text-sm">{sc.visualDescription}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Camera className="h-3 w-3" /> {sc.cameraMovement}
                  </span>
                  <span className="flex items-center gap-1">
                    <Sun className="h-3 w-3" /> {sc.lighting}
                  </span>
                  <span>{sc.emotion}</span>
                  <span>{sc.environment}</span>
                  {sc.characters.length > 0 && <span>{sc.characters.join(', ')}</span>}
                </div>
                {sc.error && <p className="text-xs text-destructive">{sc.error}</p>}
                <details className="text-xs" open={manual && sc.status !== 'completed'}>
                  <summary className="cursor-pointer text-muted-foreground">Generation prompt</summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-surface-sunken p-2 text-[11px] text-muted-foreground">{sc.prompt}</pre>
                </details>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
