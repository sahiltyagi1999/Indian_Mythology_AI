'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { NarrationStyle } from '@mas/shared';
import { get, patch, post, type Query } from '../api';
import type { EpisodeDetail, EpisodeFacets, EpisodeListItem, Paged, ScriptVersionFull } from '../types';
import { useAction } from './mutate';

export interface EpisodeFilters {
  sourceId?: string;
  search?: string;
  character?: string;
  style?: string;
  status?: string[];
  videoStatus?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useEpisodes(f: EpisodeFilters, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['episodes', 'list', f],
    queryFn: () => get<Paged<EpisodeListItem>>('/episodes', f as Query),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    refetchInterval: (q) => (q.state.data?.items.some((e) => e.status === 'generating') ? 4000 : false),
  });
}

export function useEpisodeFacets(sourceId?: string) {
  return useQuery({ queryKey: ['episodes', 'facets', sourceId], queryFn: () => get<EpisodeFacets>('/episodes/facets', { sourceId }) });
}

export function useEpisode(id: string) {
  return useQuery({
    queryKey: ['episodes', 'detail', id],
    queryFn: () => get<EpisodeDetail>(`/episodes/${id}`),
    refetchInterval: (q) => (q.state.data?.episode.status === 'generating' || q.state.data?.jobs?.some((j) => j.status === 'running' || j.status === 'queued') ? 3000 : false),
  });
}

export function useScriptVersion(id: string, version: number | null) {
  return useQuery({
    queryKey: ['episodes', 'detail', id, 'version', version],
    queryFn: () => get<ScriptVersionFull>(`/episodes/${id}/versions/${version}`),
    enabled: version !== null,
  });
}

export function useNarrationStyles() {
  return useQuery({ queryKey: ['narration-styles'], queryFn: () => get<{ styles: NarrationStyle[] }>('/narration-styles').then((r) => r.styles), staleTime: Infinity });
}

export function useEditEpisode(id: string) {
  return useAction((body: Record<string, unknown>) => patch(`/episodes/${id}`, body), { success: 'Script saved as a new version', invalidate: [['episodes']] });
}

export type EpisodeAction = 'approve' | 'unapprove' | 'lock' | 'unlock';

export function useEpisodeAction() {
  const labels: Record<EpisodeAction, string> = { approve: 'Approved', unapprove: 'Moved back to draft', lock: 'Locked', unlock: 'Unlocked' };
  return useAction((v: { id: string; action: EpisodeAction }) => post(`/episodes/${v.id}/${v.action}`), {
    success: (_r, v) => labels[v.action],
    invalidate: [['episodes']],
  });
}

export function useBulkEpisodes() {
  return useAction((v: { ids: string[]; action: EpisodeAction }) => post<{ succeeded: number; failed: number; results: { id: string; ok: boolean; error?: string }[] }>('/episodes/bulk', v), {
    success: (r) => `${r.succeeded} updated${r.failed ? ` · ${r.failed} skipped` : ''}`,
    invalidate: [['episodes']],
  });
}

export function useRegenerateEpisode() {
  return useAction((v: { id: string; instructions?: string; confirmProtected?: boolean }) => post(`/episodes/${v.id}/regenerate`, { instructions: v.instructions || undefined, confirmProtected: v.confirmProtected }), {
    success: 'Regeneration queued — a new version will be created',
    invalidate: [['episodes'], ['jobs']],
    // CONFIRM_REQUIRED is handled by the caller (asks the user, then resends).
    onError: (e) => (e as { code?: string })?.code === 'CONFIRM_REQUIRED',
  });
}

export function useRegenerateHinglish() {
  return useAction((id: string) => post(`/episodes/${id}/hinglish`, {}), {
    success: 'Hinglish copy queued',
    invalidate: [['episodes'], ['jobs']],
  });
}
