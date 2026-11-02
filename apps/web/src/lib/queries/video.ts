'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { BatchDTO, CostEstimate, VideoGenerationSettings } from '@mas/shared';
import { del, get, post, upload, type Query } from '../api';
import type { MusicTrack, Paged, VideoDetail, VideoListItem, VideoProvidersResponse, Voice } from '../types';
import { useAction } from './mutate';

const ACTIVE_VIDEO = new Set(['queued', 'narrating', 'planning', 'generating_scenes', 'rendering']);

export function useVideos(f: { status?: string; episodeId?: string; batchId?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['videos', 'list', f],
    queryFn: () => get<Paged<VideoListItem>>('/videos', f as Query),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((v) => ACTIVE_VIDEO.has(v.status)) ? 4000 : false),
  });
}

export function useVideo(id: string) {
  return useQuery({
    queryKey: ['videos', 'detail', id],
    queryFn: () => get<VideoDetail>(`/videos/${id}`),
    refetchInterval: (q) => (q.state.data && ACTIVE_VIDEO.has(q.state.data.video.status) ? 3000 : false),
  });
}

export function useRegenerateVideo() {
  return useAction((v: { id: string; reuseScenes: boolean }) => post<{ video: VideoListItem }>(`/videos/${v.id}/regenerate`, { reuseScenes: v.reuseScenes }), {
    success: (r) => `New version v${r.video?.version ?? ''} queued`,
    invalidate: [['videos'], ['jobs']],
  });
}

export function useDeleteVideo() {
  return useAction((id: string) => del(`/videos/${id}`), { success: 'Video version deleted', invalidate: [['videos']] });
}

export function useRetryScene() {
  return useAction((v: { id: string; n: number }) => post(`/videos/${v.id}/scenes/${v.n}/retry`), { success: (_r, v) => `Scene ${v.n} re-queued`, invalidate: [['videos'], ['jobs']] });
}

export function useUploadSceneClip() {
  return useAction(
    (v: { id: string; n: number; file: File }) => {
      const form = new FormData();
      form.append('file', v.file);
      return upload(`/videos/${v.id}/scenes/${v.n}/clip`, form);
    },
    { success: (_r, v) => `Scene ${v.n} clip uploaded`, invalidate: [['videos'], ['jobs']] },
  );
}

export function useResumeVideo() {
  return useAction((id: string) => post(`/videos/${id}/resume`), { success: 'Video resumed', invalidate: [['videos'], ['jobs']] });
}

export function useConfirmBudget() {
  return useAction((id: string) => post(`/videos/${id}/confirm-budget`), { success: 'Budget override confirmed — generation resumed', invalidate: [['videos'], ['jobs']] });
}

// ------------------------------------------------------------- batches
export interface BatchRequest {
  name?: string;
  episodeIds: string[];
  settings: VideoGenerationSettings;
  maxConcurrency: number;
}

export function useEstimateBatch() {
  return useAction((body: BatchRequest) => post<CostEstimate>('/batches/estimate', body));
}

export function useCreateBatch() {
  return useAction(
    (body: BatchRequest & { confirm: true; acknowledgeBudget: boolean; idempotencyKey: string }) => post<{ batch: BatchDTO; videos: VideoListItem[] }>('/batches', body),
    {
      success: (r) => `Batch started · ${r.videos.length} video${r.videos.length === 1 ? '' : 's'} queued`,
      invalidate: [['batches'], ['videos'], ['jobs'], ['episodes']],
      onError: (e) => (e as { code?: string })?.code === 'BUDGET_CONFIRMATION_REQUIRED',
    },
  );
}

export function useBatches() {
  return useQuery({
    queryKey: ['batches'],
    queryFn: () => get<{ items: BatchDTO[] }>('/batches').then((r) => r.items),
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'running') ? 5000 : false),
  });
}

export function useBatch(id: string | null) {
  return useQuery({
    queryKey: ['batches', id],
    queryFn: () => get<{ batch: BatchDTO; videos: VideoListItem[] }>(`/batches/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.batch.status === 'running' ? 4000 : false),
  });
}

export function useCancelBatch() {
  return useAction((id: string) => post(`/batches/${id}/cancel`), { success: 'Batch cancelled', invalidate: [['batches'], ['jobs'], ['videos']] });
}

// ------------------------------------------------------------- inputs for the studio
export function useVoices(enabled = true) {
  return useQuery({ queryKey: ['voices'], queryFn: () => get<{ voices: Voice[] }>('/settings/elevenlabs/voices').then((r) => r.voices), enabled, retry: false, staleTime: 300_000 });
}

export function useVideoProviders() {
  return useQuery({ queryKey: ['video-providers'], queryFn: () => get<VideoProvidersResponse>('/settings/video-providers') });
}

export function useMusic() {
  return useQuery({ queryKey: ['music'], queryFn: () => get<{ items: MusicTrack[] }>('/music').then((r) => r.items), retry: false });
}
