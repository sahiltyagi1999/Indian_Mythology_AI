'use client';
import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, FileText, Play, Save, ScanText } from 'lucide-react';
import { useProcessSource, useSource, useUpdateSource } from '@/lib/queries/sources';
import { ErrorState, KeyValue, LoadingRows, PageHeader, StatusBadge } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SourceProgress } from '@/components/sources/source-progress';
import { ChunksAndSearch, TextPreview } from '@/components/sources/source-tabs';
import { OutlinePanel } from '@/components/sources/outline-panel';
import { elapsed, formatBytes, formatDate } from '@/lib/utils';

export default function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: s, isLoading, error, refetch } = useSource(id);
  const update = useUpdateSource(id);
  const process = useProcessSource();
  const [meta, setMeta] = React.useState({ title: '', edition: '', language: 'hi', ocrMode: 'auto' });
  React.useEffect(() => {
    if (s) setMeta({ title: s.title, edition: s.edition ?? '', language: s.language, ocrMode: s.ocrMode ?? 'auto' });
  }, [s?._id, s?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !s) return <LoadingRows />;

  return (
    <>
      <Link href="/sources" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Story Sources
      </Link>
      <PageHeader
        icon={FileText}
        title={<span className="font-hindi">{s.title}</span>}
        description={`${s.fileName} · ${formatBytes(s.fileSize)} · ${s.totalPages} pages${s.edition ? ` · ${s.edition}` : ''}`}
        actions={
          <>
            <StatusBadge status={s.status} />
            {(s.stats?.failedPages ?? 0) > 0 && (
              <Button variant="outline" onClick={() => process.mutate({ id, retryFailedOcr: true })} loading={process.isPending}>
                <ScanText /> Retry failed OCR
              </Button>
            )}
            {['uploaded', 'failed'].includes(s.status) && (
              <Button onClick={() => process.mutate({ id })} loading={process.isPending}>
                <Play /> Process PDF
              </Button>
            )}
          </>
        }
      />
      <Tabs defaultValue={['indexed', 'outlined', 'analyzing'].includes(s.status) ? 'outline' : 'overview'}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="text">Extracted text</TabsTrigger>
          <TabsTrigger value="chunks">Chunks & search</TabsTrigger>
          <TabsTrigger value="outline">Outline</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Processing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <SourceProgress s={s} />
                <KeyValue
                  items={[
                    ['Uploaded', formatDate(s.createdAt, true)],
                    ['SHA-256', <code key="h" className="text-xs text-muted-foreground">{s.sha256.slice(0, 16)}…</code>],
                    ['Pages extracted', `${s.stats?.extractedPages ?? 0} / ${s.totalPages}`],
                    ['OCR pages', s.stats?.ocrPages ?? 0],
                    ['Failed pages', s.stats?.failedPages ?? 0],
                    ['Chunks indexed', `${s.stats?.embeddedChunks ?? 0} / ${s.stats?.chunks ?? 0}`],
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Metadata</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Field label="Title" className="sm:col-span-2">
                  <Input className="font-hindi" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
                </Field>
                <Field label="Edition" className="sm:col-span-2">
                  <Input value={meta.edition} onChange={(e) => setMeta({ ...meta, edition: e.target.value })} />
                </Field>
                <Field label="Language">
                  <SimpleSelect value={meta.language} onValueChange={(v) => setMeta({ ...meta, language: v })} options={[{ value: 'hi', label: 'Hindi' }, { value: 'en', label: 'English' }, { value: 'sa', label: 'Sanskrit' }]} />
                </Field>
                <Field label="OCR mode">
                  <SimpleSelect value={meta.ocrMode} onValueChange={(v) => setMeta({ ...meta, ocrMode: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }]} />
                </Field>
                <div className="flex justify-end sm:col-span-2">
                  <Button size="sm" onClick={() => update.mutate(meta)} loading={update.isPending}>
                    <Save /> Save
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Extraction errors ({s.extractionErrors?.length ?? 0})</CardTitle>
              </CardHeader>
              <CardContent className="max-h-72 space-y-1.5 overflow-auto">
                {!s.extractionErrors?.length ? (
                  <p className="text-sm text-muted-foreground">No extraction errors.</p>
                ) : (
                  s.extractionErrors.map((e) => (
                    <div key={e.page} className="flex gap-3 rounded border border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs">
                      <span className="shrink-0 font-medium">p. {e.page}</span>
                      <span className="text-muted-foreground">{e.message}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Recent jobs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!s.jobs?.length && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
                {s.jobs?.map((j) => (
                  <div key={j._id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                    <span className="font-medium">{j.type}</span>
                    <span className="flex-1 truncate text-xs text-muted-foreground">
                      {j.stage} · {elapsed(j.startedAt, j.finishedAt)}
                    </span>
                    {j.error?.message && <span className="max-w-xs truncate text-xs text-destructive">{j.error.message}</span>}
                    <StatusBadge status={j.status} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="text">
          <TextPreview source={s} />
        </TabsContent>
        <TabsContent value="chunks">
          <ChunksAndSearch source={s} />
        </TabsContent>
        <TabsContent value="outline">
          <OutlinePanel source={s} />
        </TabsContent>
      </Tabs>
    </>
  );
}
