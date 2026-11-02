'use client';
import * as React from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useSourceChunks, useSourcePages, useSourceSearch } from '@/lib/queries/sources';
import type { SourceDetail } from '@/lib/types';
import { EmptyState, ErrorState, LoadingRows, Pagination } from '../common';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export function TextPreview({ source }: { source: SourceDetail }) {
  const [from, setFrom] = React.useState(1);
  const per = 3;
  const { data, isLoading, error } = useSourcePages(source._id, from, from + per - 1);
  const total = data?.total ?? source.stats?.extractedPages ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {total} of {source.totalPages} pages extracted
        </p>
        <div className="flex items-center gap-2">
          <Button size="icon-sm" variant="outline" disabled={from <= 1} onClick={() => setFrom(Math.max(1, from - per))} aria-label="Previous pages">
            <ChevronLeft />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Pages {from}–{Math.min(from + per - 1, source.totalPages)}
          </span>
          <Button size="icon-sm" variant="outline" disabled={from + per > source.totalPages} onClick={() => setFrom(from + per)} aria-label="Next pages">
            <ChevronRight />
          </Button>
          <Input
            type="number"
            className="h-8 w-20"
            min={1}
            max={source.totalPages}
            placeholder="Go to"
            onKeyDown={(e) => {
              if (e.key === 'Enter') setFrom(Math.max(1, Math.min(source.totalPages, Number((e.target as HTMLInputElement).value) || 1)));
            }}
          />
        </div>
      </div>
      {error && <ErrorState error={error} />}
      {isLoading ? (
        <LoadingRows rows={3} />
      ) : !data?.pages.length ? (
        <EmptyState title="No extracted text for these pages" description="Process the source to extract its text." />
      ) : (
        data.pages.map((p) => (
          <Card key={p.page} className="p-4">
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="font-medium">Page {p.page}</span>
              <Badge tone={p.method === 'text' ? 'success' : p.method === 'ocr' ? 'info' : 'danger'}>{p.method === 'text' ? 'text layer' : p.method}</Badge>
              <span className="text-muted-foreground">quality {(p.quality * 100).toFixed(0)}%</span>
              {p.issues.length > 0 && <span className="truncate text-warning">{p.issues.join(' · ')}</span>}
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-hindi text-sm text-foreground/90">{p.text || '— empty —'}</pre>
          </Card>
        ))
      )}
    </div>
  );
}

export function ChunksAndSearch({ source }: { source: SourceDetail }) {
  const [page, setPage] = React.useState(1);
  const chunks = useSourceChunks(source._id, page, 10);
  const [input, setInput] = React.useState('');
  const [q, setQ] = React.useState('');
  const search = useSourceSearch(source._id, q);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Semantic search</h3>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(input);
          }}
        >
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. भीष्म की प्रतिज्ञा, Karna's armour…" className="font-hindi" />
          <Button type="submit" variant="secondary" loading={search.isFetching}>
            <Search /> Search
          </Button>
        </form>
        {search.error && <ErrorState error={search.error} />}
        {search.data?.length === 0 && <p className="text-sm text-muted-foreground">No matches.</p>}
        {search.data?.map((r) => (
          <Card key={r.id} className="p-3">
            <div className="mb-1 flex gap-2 text-xs text-muted-foreground">
              <span>
                pp. {r.pageStart}–{r.pageEnd}
              </span>
              {r.section && <span className="font-hindi">{r.section}</span>}
              {r.score !== undefined && <span className="ml-auto tabular-nums">score {r.score.toFixed(3)}</span>}
            </div>
            <p className="line-clamp-5 font-hindi text-sm">{r.text}</p>
          </Card>
        ))}
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Chunks</h3>
          {chunks.data && <Pagination page={page} pageSize={10} total={chunks.data.total} onPage={setPage} />}
        </div>
        {chunks.isLoading ? (
          <LoadingRows rows={4} />
        ) : !chunks.data?.items.length ? (
          <EmptyState title="No chunks yet" description="Chunks are created after text extraction." />
        ) : (
          chunks.data.items.map((c) => (
            <Card key={c._id} className="p-3">
              <div className="mb-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">#{c.chunkIndex}</span>
                <span>
                  pp. {c.pageStart}–{c.pageEnd}
                </span>
                {c.section && <span className="font-hindi">{c.section}</span>}
                <Badge tone={c.embedded ? 'success' : 'neutral'} className="ml-auto">
                  {c.embedded ? 'indexed' : 'not indexed'}
                </Badge>
              </div>
              <p className="line-clamp-4 font-hindi text-sm text-foreground/90">{c.text}</p>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
