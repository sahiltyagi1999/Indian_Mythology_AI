'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { del, get, patch, post, put, upload, type Query } from '../api';
import type {
  OpenAIModel,
  OpenAITestResult,
  AnalyticsSummary,
  BatchCostRow,
  CharacterListItem,
  DashboardData,
  ElevenTestResult,
  EpisodeCostRow,
  GeminiModel,
  GoogleTestResult,
  JobsPage,
  MusicTrack,
  SettingsResponse,
  SystemStatus,
} from '../types';
import type { CharacterDTO, GenerationJobDTO } from '@mas/shared';
import { useAction } from './mutate';

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardData>('/dashboard'), refetchInterval: (q) => ((q.state.data?.jobs.active ?? 0) > 0 ? 5000 : 30_000) });
}

// ------------------------------------------------------------- jobs
export function useJobs(f: { status?: string | string[]; queue?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['jobs', 'list', f],
    queryFn: () => get<JobsPage>('/jobs', f as Query),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => ((q.state.data?.counts.running ?? 0) + (q.state.data?.counts.queued ?? 0) > 0 ? 3000 : 15_000),
  });
}

export function useJob(id: string | null) {
  return useQuery({
    queryKey: ['jobs', 'detail', id],
    queryFn: () => get<GenerationJobDTO>(`/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ['running', 'queued'].includes(q.state.data.status) ? 3000 : false),
  });
}

export function useQueueHealth() {
  return useQuery({ queryKey: ['jobs', 'health'], queryFn: () => get<Record<string, Record<string, number>>>('/jobs/health'), refetchInterval: 10_000 });
}

export function useCancelJob() {
  return useAction((id: string) => post(`/jobs/${id}/cancel`), { success: 'Cancellation requested', invalidate: [['jobs']] });
}

export function useRetryJob() {
  return useAction((id: string) => post(`/jobs/${id}/retry`), { success: 'Job re-queued', invalidate: [['jobs']] });
}

// ------------------------------------------------------------- characters
export function useCharacters(f: { sourceId?: string; search?: string }) {
  return useQuery({ queryKey: ['characters', f], queryFn: () => get<{ items: CharacterListItem[] }>('/characters', f).then((r) => r.items), placeholderData: keepPreviousData });
}

export function useCharacter(id: string | null) {
  return useQuery({
    queryKey: ['characters', 'detail', id],
    queryFn: () => get<{ character: CharacterListItem; episodes: { _id: string; episodeNumber: number; title: string; status: string }[] }>(`/characters/${id}`),
    enabled: !!id,
  });
}

export function useSaveCharacter() {
  return useAction(
    (v: { id?: string; body: Partial<CharacterDTO> & { sourceId?: string } }) => (v.id ? patch<CharacterDTO>(`/characters/${v.id}`, v.body) : post<CharacterDTO>('/characters', v.body)),
    { success: 'Character saved', invalidate: [['characters']] },
  );
}

export function useDeleteCharacter() {
  return useAction((id: string) => del(`/characters/${id}`), { success: 'Character deleted', invalidate: [['characters']] });
}

export function useUploadReference() {
  return useAction(
    (v: { id: string; variant: string; file: File }) => {
      const form = new FormData();
      form.append('image', v.file);
      return upload(`/characters/${v.id}/variants/${v.variant}/images`, form);
    },
    { success: 'Reference image added', invalidate: [['characters']] },
  );
}

export function useRemoveReference() {
  return useAction((v: { id: string; variant: string; key: string }) => del(`/characters/${v.id}/variants/${v.variant}/images`, { key: v.key }), {
    success: 'Reference image removed',
    invalidate: [['characters']],
  });
}

// ------------------------------------------------------------- settings
export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => get<SettingsResponse>('/settings') });
}

export function useSystem() {
  return useQuery({ queryKey: ['settings', 'system'], queryFn: () => get<SystemStatus>('/settings/system'), refetchInterval: 30_000 });
}

export function useSaveSettings() {
  return useAction((v: { section: string; patch: Record<string, unknown> }) => put<{ settings: unknown }>(`/settings/${v.section}`, v.patch), {
    success: 'Settings saved',
    invalidate: [['settings'], ['video-providers']],
  });
}

export function useSaveSecret() {
  return useAction((v: { provider: 'google' | 'openai' | 'elevenlabs'; value: string | null }) => put(`/settings/${v.provider}/secrets/apiKey`, { value: v.value }), {
    success: (_r, v) => (v.value ? 'API key saved (encrypted)' : 'API key removed'),
    invalidate: [['settings'], ['voices']],
  });
}

export function useGoogleModels(enabled: boolean) {
  return useQuery({
    queryKey: ['google-models'],
    queryFn: () => get<{ models: GeminiModel[]; videoModels: string[] }>('/settings/google/models'),
    enabled,
    retry: false,
    staleTime: 300_000,
  });
}

export function useOpenAIModels(enabled: boolean) {
  return useQuery({
    queryKey: ['openai-models'],
    queryFn: () => get<{ models: OpenAIModel[] }>('/settings/openai/models'),
    enabled,
    retry: false,
    staleTime: 300_000,
  });
}

export function useTestOpenAI() {
  return useAction(() => post<OpenAITestResult>('/settings/openai/test'), { success: (r) => `Connected · ${r.modelCount} models visible`, invalidate: [['openai-models']] });
}

export function useTestGoogle() {
  return useAction(() => post<GoogleTestResult>('/settings/google/test'), { success: (r) => `Connected · ${r.modelCount} models visible`, invalidate: [['google-models']] });
}

export function useTestEleven() {
  return useAction(() => post<ElevenTestResult>('/settings/elevenlabs/test'), { success: (r) => `Connected · ${r.subscription.tier} plan` });
}

export function useTestVoice() {
  return useAction((v: { text?: string; voiceId?: string }) => post<{ url: string; cached: boolean }>('/settings/elevenlabs/test-voice', v), {
    success: (r) => (r.cached ? 'Played cached sample (no new charge)' : 'Voice sample generated'),
  });
}

export function useUploadLogo() {
  return useAction(
    (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      return upload('/settings/branding/logo', form);
    },
    { success: 'Logo uploaded', invalidate: [['settings']] },
  );
}

export function useRemoveLogo() {
  return useAction(() => del('/settings/branding/logo'), { success: 'Logo removed', invalidate: [['settings']] });
}

export function useMusicLibrary() {
  return useQuery({ queryKey: ['music'], queryFn: () => get<{ items: MusicTrack[] }>('/music').then((r) => r.items), retry: false });
}

export function useUploadMusic() {
  return useAction((v: { form: FormData; onProgress?: (p: number) => void }) => upload('/music', v.form, v.onProgress), { success: 'Track added to library', invalidate: [['music']] });
}

export function useDeleteMusic() {
  return useAction((id: string) => del(`/music/${id}`), { success: 'Track removed', invalidate: [['music']] });
}

// ------------------------------------------------------------- analytics
export function useAnalyticsSummary(from: string, to: string) {
  return useQuery({ queryKey: ['analytics', 'summary', from, to], queryFn: () => get<AnalyticsSummary>('/analytics/summary', { from, to }) });
}

export function useEpisodeCosts() {
  return useQuery({ queryKey: ['analytics', 'episodes'], queryFn: () => get<{ items: EpisodeCostRow[] }>('/analytics/episodes').then((r) => r.items) });
}

export function useBatchCosts() {
  return useQuery({ queryKey: ['analytics', 'batches'], queryFn: () => get<{ items: BatchCostRow[] }>('/analytics/batches').then((r) => r.items) });
}
