'use client';
import { useQuery } from '@tanstack/react-query';
import { del, get, patch, post, upload } from '../api';
import type { ChunkItem, Era, ExtractedPage, OutlineFull, OutlineVersion, Paged, SearchResult, SourceDetail, SourceListItem } from '../types';
import { useAction } from './mutate';

const ACTIVE_SOURCE = new Set(['extracting', 'extracted', 'chunking', 'embedding', 'analyzing']);

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: () => get<{ items: SourceListItem[] }>('/sources').then((r) => r.items),
    refetchInterval: (q) => (q.state.data?.some((s) => ACTIVE_SOURCE.has(s.status)) ? 3000 : false),
  });
}

export function useSource(id: string) {
  return useQuery({
    queryKey: ['sources', id],
    queryFn: () => get<SourceDetail>(`/sources/${id}`),
    refetchInterval: (q) => (q.state.data && (ACTIVE_SOURCE.has(q.state.data.status) || q.state.data.jobs?.some((j) => j.status === 'running' || j.status === 'queued')) ? 3000 : false),
  });
}

export function useUploadSource() {
  return useAction(
    (v: { form: FormData; onProgress: (p: number) => void }) => upload<SourceListItem>('/sources', v.form, v.onProgress),
    { success: 'PDF uploaded', invalidate: [['sources']] },
  );
}

export function useReplaceSourceFile(id: string) {
  return useAction((v: { form: FormData; onProgress: (p: number) => void }) => upload<SourceListItem>(`/sources/${id}/file`, v.form, v.onProgress, 'PUT'), {
    success: 'File replaced',
    invalidate: [['sources']],
  });
}

export function useProcessSource() {
  return useAction((v: { id: string; retryFailedOcr?: boolean }) => post<{ created: boolean; requeued: boolean }>(`/sources/${v.id}/process`, v.retryFailedOcr ? { retryFailedOcr: true } : {}), {
    success: (r) => (r.created || r.requeued ? 'Processing started' : 'Processing is already queued'),
    invalidate: [['sources'], ['jobs']],
  });
}

export function useUpdateSource(id: string) {
  return useAction((body: { title?: string; edition?: string; language?: string; ocrMode?: string }) => patch(`/sources/${id}`, body), {
    success: 'Source updated',
    invalidate: [['sources']],
  });
}

export function useDeleteSource() {
  return useAction((id: string) => del(`/sources/${id}`), { success: 'Source deleted', invalidate: [['sources']] });
}

export function useSourcePages(id: string, from: number, to: number) {
  return useQuery({
    queryKey: ['sources', id, 'pages', from, to],
    queryFn: () => get<{ total: number; pages: ExtractedPage[] }>(`/sources/${id}/pages`, { from, to }),
  });
}

export function useSourceChunks(id: string, page: number, pageSize = 10) {
  return useQuery({
    queryKey: ['sources', id, 'chunks', page, pageSize],
    queryFn: () => get<Paged<ChunkItem>>(`/sources/${id}/chunks`, { page, pageSize }),
  });
}

export function useSourceSearch(id: string, q: string) {
  return useQuery({
    queryKey: ['sources', id, 'search', q],
    queryFn: () => get<{ results: SearchResult[] }>(`/sources/${id}/search`, { q, limit: 8 }).then((r) => r.results),
    enabled: q.trim().length >= 2,
    retry: false,
  });
}

// ------------------------------------------------------------- outlines
export function useOutlineVersions(sourceId: string) {
  return useQuery({
    queryKey: ['outlines', 'bySource', sourceId],
    queryFn: () => get<{ items: OutlineVersion[] }>(`/sources/${sourceId}/outlines`).then((r) => r.items),
    refetchInterval: (q) => (q.state.data?.some((o) => o.status === 'generating') ? 4000 : false),
  });
}

export function useOutline(id?: string | null) {
  return useQuery({
    queryKey: ['outlines', id],
    queryFn: () => get<OutlineFull>(`/outlines/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? 4000 : false),
  });
}

export function useEras() {
  return useQuery({ queryKey: ['eras'], queryFn: () => get<{ eras: Era[] }>('/outlines/eras').then((r) => r.eras), staleTime: Infinity });
}

export function useGenerateOutline() {
  return useAction((sourceId: string) => post<{ outline: OutlineVersion; resumed?: boolean }>(`/sources/${sourceId}/outlines`), {
    success: (r) => (r.resumed ? 'Resumed outline generation' : `Outline v${r.outline.version} started`),
    invalidate: [['outlines'], ['sources'], ['jobs']],
  });
}

export function useApproveOutline() {
  return useAction((id: string) => post(`/outlines/${id}/approve`), { success: 'Outline approved', invalidate: [['outlines']] });
}

export function useEditPlannedEpisode(outlineId: string) {
  return useAction((v: { n: number; title?: string; synopsis?: string }) => patch(`/outlines/${outlineId}/episodes/${v.n}`, { title: v.title, synopsis: v.synopsis }), {
    success: 'Planned episode updated',
    invalidate: [['outlines', outlineId]],
  });
}

export function useGenerateScripts() {
  return useAction(
    (v: { outlineId: string; from?: number; to?: number; limit?: number }) =>
      post<{ created: number; queued: number; total: number }>(`/outlines/${v.outlineId}/generate-scripts`, { from: v.from, to: v.to, limit: v.limit }),
    { success: (r) => `${r.created} episodes created · ${r.queued} scripts queued (of ${r.total})`, invalidate: [['episodes'], ['jobs'], ['sources']] },
  );
}
