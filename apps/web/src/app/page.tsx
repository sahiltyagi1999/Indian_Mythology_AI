'use client';
import Link from 'next/link';
import { ArrowRight, BookOpen, CheckCircle2, Clapperboard, FileText, Film, LayoutDashboard, ListChecks, Upload, Wallet, XCircle } from 'lucide-react';
import { EPISODE_STATUSES } from '@mas/shared';
import { useDashboard } from '@/lib/queries/misc';
import { EmptyState, ErrorState, PageHeader, StatCard, StatusBadge, humanize } from '@/components/common';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress, Skeleton } from '@/components/ui/misc';
import { BudgetMeter } from '@/components/budget-meter';
import { VideoThumb } from '@/components/video-thumb';
import { formatSeconds, formatUsd, timeAgo } from '@/lib/utils';

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard();

  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        title="Production overview"
        description="Story Engine turns your source into approved Hindi scripts once. Video Engine turns approved scripts into cinematic 9:16 shorts — as many times as you like."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/sources">
                <Upload /> Upload source
              </Link>
            </Button>
            <Button asChild>
              <Link href="/video-studio">
                <Clapperboard /> New video batch
              </Link>
            </Button>
          </>
        }
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} className="mb-6" />}

      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Story sources" value={data.sources} icon={Upload} href="/sources" sub="Uploaded editions" />
            <StatCard
              label="Episodes"
              value={data.episodes.total}
              icon={FileText}
              href="/scripts"
              sub={`${data.episodes.byStatus.review_required ?? 0} need review · ${data.episodes.byStatus.draft ?? 0} drafts`}
            />
            <StatCard
              label="Ready for video"
              value={(data.episodes.byStatus.approved ?? 0) + (data.episodes.byStatus.locked ?? 0)}
              icon={CheckCircle2}
              tone="success"
              href="/video-studio"
              sub="Approved + locked scripts"
            />
            <StatCard label="Videos completed" value={data.videos.byStatus.completed ?? 0} icon={Film} tone="primary" href="/videos" sub={`${data.videos.total} versions total`} />
            <StatCard label="Active jobs" value={data.jobs.active} icon={ListChecks} tone={data.jobs.active ? 'primary' : 'default'} href="/queue" sub="Running or queued" />
            <StatCard label="Failed jobs" value={data.jobs.failed} icon={XCircle} tone={data.jobs.failed ? 'danger' : 'default'} href="/queue" sub="Retry from the queue" />
            <Card className="p-4 sm:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Spend vs budget</span>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <BudgetMeter label="Today" spent={data.spend.today} limit={data.spend.dailyLimit} />
                <BudgetMeter label="This month" spent={data.spend.month} limit={data.spend.monthlyLimit} />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
              <CardDescription>Scripts flow left to right. Approved scripts are never regenerated automatically.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
                <PipelineStage
                  icon={BookOpen}
                  title="Story Engine"
                  href="/sources"
                  lines={[
                    ['Sources', data.sources],
                    ['Pending', data.episodes.byStatus.pending ?? 0],
                    ['Generating', data.episodes.byStatus.generating ?? 0],
                  ]}
                />
                <ArrowRight className="mx-auto hidden h-5 w-5 self-center text-muted-foreground lg:block" />
                <PipelineStage
                  icon={FileText}
                  title="Script Studio"
                  href="/scripts"
                  lines={EPISODE_STATUSES.filter((s) => ['draft', 'review_required', 'approved', 'locked'].includes(s)).map((s) => [humanize(s), data.episodes.byStatus[s] ?? 0])}
                />
                <ArrowRight className="mx-auto hidden h-5 w-5 self-center text-muted-foreground lg:block" />
                <PipelineStage
                  icon={Clapperboard}
                  title="Video Engine"
                  href="/videos"
                  lines={[
                    ['In production', ['queued', 'narrating', 'planning', 'generating_scenes', 'rendering'].reduce((n, s) => n + ((data.videos.byStatus as Record<string, number>)[s] ?? 0), 0)],
                    ['Completed', data.videos.byStatus.completed ?? 0],
                    ['Failed', data.videos.byStatus.failed ?? 0],
                  ]}
                />
              </div>
              {data.episodes.total > 0 && (
                <div className="mt-5">
                  <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>Script approval progress</span>
                    <span className="tabular-nums">
                      {(data.episodes.byStatus.approved ?? 0) + (data.episodes.byStatus.locked ?? 0)} / {data.episodes.total}
                    </span>
                  </div>
                  <Progress value={(((data.episodes.byStatus.approved ?? 0) + (data.episodes.byStatus.locked ?? 0)) / data.episodes.total) * 100} tone="success" />
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Recent videos</CardTitle>
                  <CardDescription>Latest renders across all episodes</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/videos">
                    View all <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {data.recentVideos.length === 0 ? (
                  <EmptyState icon={Film} title="No videos yet" description="Approve scripts in the Script Studio, then start a batch in the Video Studio." action={<Button size="sm" asChild><Link href="/video-studio">Open Video Studio</Link></Button>} />
                ) : (
                  <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
                    {data.recentVideos.map((v) => (
                      <Link key={v._id} href={`/videos/${v._id}`} className="group space-y-1.5">
                        <VideoThumb path={v.thumbnailPath} className="transition-colors group-hover:border-primary/50" />
                        <div className="truncate font-hindi text-xs">
                          {v.episodeNumber}. {v.episodeTitle}
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <StatusBadge status={v.status} />
                          <span className="text-[10px] text-muted-foreground">{formatSeconds(v.duration)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Recent jobs</CardTitle>
                  <CardDescription>Background processing activity</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/queue">
                    Queue <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.recentJobs.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No jobs yet.</p>}
                {data.recentJobs.map((j) => (
                  <div key={j._id} className="flex items-center gap-3 rounded-md border bg-surface-sunken/60 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="truncate font-medium">{j.type}</span>
                        {j.episodeNumber !== undefined && <span className="text-xs text-muted-foreground">Ep {j.episodeNumber}</span>}
                        {j.sceneNumber !== undefined && <span className="text-xs text-muted-foreground">Scene {j.sceneNumber}</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {j.stage} · {timeAgo(j.updatedAt)}
                        {j.actualCost > 0 && ` · ${formatUsd(j.actualCost)}`}
                      </div>
                    </div>
                    <StatusBadge status={j.status} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function PipelineStage({ icon: Icon, title, href, lines }: { icon: typeof BookOpen; title: string; href: string; lines: [string, number][] }) {
  return (
    <Link href={href} className="group rounded-lg border bg-surface-sunken/60 p-4 transition-colors hover:border-primary/40">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </div>
      <div className="space-y-1.5">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}
