'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowDown, BookOpen, Clock } from 'lucide-react';
import { NARRATION_STYLES } from '@mas/shared';
import { useEpisodes } from '@/lib/queries/episodes';
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatusBadge } from '@/components/common';
import { SourceSelect } from '@/components/source-select';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatSeconds } from '@/lib/utils';

const PAGE = 200;

export default function LibraryPage() {
  const [sourceId, setSourceId] = React.useState('');
  const [limit, setLimit] = React.useState(PAGE);
  const [hinglish, setHinglish] = React.useState(false);
  const { data, isLoading, error, refetch } = useEpisodes({ sourceId, sort: 'episodeNumber', pageSize: Math.min(limit, 500) }, { enabled: !!sourceId });
  const styleName = (id: string) => NARRATION_STYLES.find((s) => s.id === id)?.name ?? id;

  return (
    <>
      <PageHeader
        icon={BookOpen}
        title="Story Library"
        description="The complete storyline in chronological order. Each episode's teaser leads into the next episode's hook."
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border bg-surface-sunken p-1 text-xs">
              <button type="button" onClick={() => setHinglish(false)} className={`rounded-md px-2.5 py-1 font-hindi ${!hinglish ? 'bg-surface-raised text-foreground' : 'text-muted-foreground'}`}>
                हिंदी
              </button>
              <button type="button" onClick={() => setHinglish(true)} className={`rounded-md px-2.5 py-1 ${hinglish ? 'bg-surface-raised text-foreground' : 'text-muted-foreground'}`}>
                Hinglish
              </button>
            </div>
            <SourceSelect value={sourceId} onChange={setSourceId} />
          </div>
        }
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {!sourceId || isLoading ? (
        <LoadingRows />
      ) : !data?.items.length ? (
        <EmptyState
          icon={BookOpen}
          title="No episodes for this source yet"
          description="Approve the master outline on the source page, then generate scripts."
          action={
            <Button asChild>
              <Link href={`/sources/${sourceId}`}>Open source</Link>
            </Button>
          }
        />
      ) : (
        <div className="relative mx-auto max-w-4xl">
          <div className="absolute bottom-0 left-[19px] top-0 w-px bg-gradient-to-b from-primary/50 via-border to-transparent" />
          <div className="space-y-3">
            {data.items.map((e) => (
              <div key={e._id} className="relative flex gap-4">
                <div className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-surface-raised text-xs font-semibold tabular-nums text-primary">{e.episodeNumber}</div>
                <Link href={`/scripts/${e._id}`} className="block flex-1">
                  <Card className="p-4 transition-colors hover:border-primary/40">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      {hinglish && e.titleHinglish ? (
                        <h3 className="text-base font-semibold">{e.titleHinglish}</h3>
                      ) : (
                        <h3 className="font-hindi text-base font-semibold">{e.title}</h3>
                      )}
                      <div className="flex gap-1.5">
                        <StatusBadge status={e.status} />
                        <StatusBadge status={e.videoStatus ?? 'none'} />
                      </div>
                    </div>
                    <p className="mt-1 font-hindi text-sm text-muted-foreground">{e.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{e.characters.slice(0, 5).join(', ')}</span>
                      {e.narrationStyle && <span>{styleName(e.styleOverride || e.narrationStyle)}</span>}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatSeconds(e.actualAudioDuration ?? e.estimatedDuration)}
                      </span>
                    </div>
                  </Card>
                </Link>
              </div>
            ))}
          </div>
          {data.total > data.items.length && (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={() => setLimit(limit + PAGE)}>
                <ArrowDown /> Load more ({data.total - data.items.length} remaining)
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
