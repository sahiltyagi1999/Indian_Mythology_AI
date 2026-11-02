/**
 * Frontend-only response shapes for endpoints whose payloads are not (yet) modelled in @mas/shared.
 * DTOs that exist in @mas/shared are re-exported from there.
 */
import type {
  BatchDTO,
  CharacterDTO,
  CostEstimate,
  EpisodeDTO,
  GenerationJobDTO,
  StoryOutlineDTO,
  StorySourceDTO,
  VideoAssetDTO,
  VideoSceneDTO,
  EpisodeStatus,
  VideoStatus,
} from '@mas/shared';

export type { BatchDTO, CharacterDTO, CostEstimate, EpisodeDTO, GenerationJobDTO, StoryOutlineDTO, StorySourceDTO, VideoAssetDTO, VideoSceneDTO };

export interface SourceListItem extends StorySourceDTO {
  edition: string;
  ocrMode: 'auto' | 'always' | 'never';
  latestOutline: { _id: string; version: number; status: string; episodes: number } | null;
  episodeCounts: Partial<Record<EpisodeStatus, number>>;
}

export interface SourceDetail extends SourceListItem {
  jobs: GenerationJobDTO[];
}

export interface ExtractedPage {
  page: number;
  text: string;
  method: 'text' | 'ocr' | 'failed';
  quality: number;
  issues: string[];
}

export interface ChunkItem {
  _id: string;
  chunkIndex: number;
  text: string;
  pageStart: number;
  pageEnd: number;
  section: string;
  tokenEstimate?: number;
  embedded: boolean;
}

export interface SearchResult {
  id: string;
  chunkIndex: number;
  text: string;
  pageStart: number;
  pageEnd: number;
  section: string;
  score?: number;
}

export interface OutlineVersion {
  _id: string;
  version: number;
  status: string;
  progress: { stage: string; percent: number; message?: string };
  segmentsTotal: number;
  segmentsProcessed: number;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  llmModel?: string;
}

export interface OutlineEvent {
  eventId: string;
  order: number;
  title: string;
  summary: string;
  characters: string[];
  pageStart: number;
  pageEnd: number;
  chunkIds: string[];
  certainty: 'certain' | 'uncertain' | 'varies';
  notes?: string;
  importance?: number;
  era?: string;
  embeddedTale?: boolean;
}

export interface OutlineFull extends Omit<StoryOutlineDTO, 'events'> {
  events: OutlineEvent[];
  llmModel?: string;
  approvedAt?: string;
  error?: string;
}

export interface Era {
  id: string;
  label: string;
}

export interface EpisodeListItem {
  _id: string;
  sourceId: string;
  episodeNumber: number;
  title: string;
  titleHinglish?: string;
  slug: string;
  summary: string;
  characters: string[];
  narrationStyle: string;
  styleOverride?: string;
  status: EpisodeStatus;
  videoStatus?: VideoStatus | 'none';
  estimatedDuration: number;
  actualAudioDuration?: number;
  currentVersion: number;
  quality?: { overall?: number; passed?: boolean };
  updatedAt: string;
  createdAt: string;
}

export interface EpisodeFacets {
  characters: { name: string; count: number }[];
  styles: { id: string; count: number }[];
  statuses: Partial<Record<EpisodeStatus, number>>;
  videoStatuses: Record<string, number>;
}

export interface EpisodeNeighbour {
  _id: string;
  episodeNumber: number;
  title: string;
  summary: string;
  status: EpisodeStatus;
  nextEpisodeTeaser?: string;
  hook?: string;
}

export interface ScriptVersionSummary {
  _id: string;
  version: number;
  createdBy: 'ai' | 'user';
  changeNote?: string;
  createdAt: string;
  quality?: { overall?: number };
  estimatedDuration?: number;
}

export interface EpisodeDetail {
  episode: EpisodeDTO & { styleReason?: string; highlightWords?: string[] };
  previous: EpisodeNeighbour | null;
  next: EpisodeNeighbour | null;
  versions: ScriptVersionSummary[];
  videos: { _id: string; version: number; status: VideoStatus; scriptVersion: number; duration?: number; thumbnailPath?: string; videoPath?: string; createdAt: string }[];
  jobs: GenerationJobDTO[];
}

export interface ScriptVersionFull {
  _id: string;
  version: number;
  title: string;
  summary: string;
  hook: string;
  narrationText: string;
  ending: string;
  nextEpisodeTeaser: string;
  narrationStyle: string;
  createdBy: 'ai' | 'user';
  changeNote?: string;
  createdAt: string;
  estimatedDuration?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JobsPage extends Paged<GenerationJobDTO> {
  counts: Record<string, number>;
}

export interface CharacterListItem extends CharacterDTO {
  episodeCount: number;
  userEdited?: boolean;
}

export interface VideoListItem extends VideoAssetDTO {
  warnings: string[];
}

export interface VideoDetail {
  video: VideoListItem;
  scenes: (VideoSceneDTO & { referenceImages?: string[] })[];
  jobs: GenerationJobDTO[];
}

export interface DashboardData {
  sources: number;
  episodes: { total: number; byStatus: Partial<Record<EpisodeStatus, number>> };
  videos: { total: number; byStatus: Partial<Record<VideoStatus, number>> };
  jobs: { active: number; failed: number };
  spend: { today: number; month: number; dailyLimit: number | null; monthlyLimit: number | null };
  recentVideos: VideoListItem[];
  recentJobs: GenerationJobDTO[];
}

export interface MusicTrack {
  _id: string;
  title: string;
  mood: string;
  license: string;
  licenseUrl?: string;
  attribution?: string;
  duration?: number;
  kind: 'music' | 'sfx';
  filePath: string;
}

export interface Voice {
  voiceId: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  previewUrl?: string;
  languages?: string[];
}

export interface SecretInfo {
  configured: boolean;
  masked: string | null;
  origin: 'database' | 'environment' | null;
}

export interface PricingEntry {
  provider: string;
  model: string;
  category: 'text' | 'embedding' | 'narration' | 'video' | 'ocr';
  unit: string;
  price: number;
  variant?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  source: string;
  verified: boolean;
  note?: string;
}

export interface SubtitleDefaults {
  font: string;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  backgroundOpacity: number;
  positionFromBottom: number;
  animation: 'none' | 'pop' | 'karaoke' | 'fade';
}

export interface AllSettings {
  llm: { provider: 'openai' | 'google' };
  openai: {
    textModel: string;
    analysisModel: string;
    qualityModel: string;
    ocrModel: string;
    lightModel: string;
    embeddingModel: string;
    embeddingDimensions: 768 | 1536 | 3072;
  };
  google: {
    textModel: string;
    analysisModel: string;
    qualityModel: string;
    ocrModel: string;
    embeddingModel: string;
    embeddingDimensions: 768 | 1536 | 3072;
    videoProvider: string;
    videoModel: string;
    videoResolution: '720p' | '1080p';
  };
  elevenlabs: {
    voiceId: string;
    model: string;
    languageCode: string;
    stability: number;
    similarityBoost: number;
    style: number;
    speed: number;
    useSpeakerBoost: boolean;
    outputFormat: string;
  };
  pricing: { currency: 'USD'; verifiedAt: string; staleAfterDays: number; entries: PricingEntry[] };
  budget: { dailyLimit: number | null; monthlyLimit: number | null; maxCostPerEpisode: number | null };
  render: {
    targetDuration: number;
    durationTolerance: number;
    fps: number;
    crf: number;
    preset: string;
    transition: string;
    transitionDuration: number;
    musicVolume: number;
    sfxIntensity: number;
    narrationLoudnessLufs: number;
    logoKey: string;
    logoPosition: 'top-left' | 'top-right';
    subtitles: SubtitleDefaults;
    maxSpeedAdjust: number;
  };
  story: {
    chunkChars: number;
    chunkOverlapChars: number;
    segmentChars: number;
    planningWindowEvents: number;
    scriptConcurrency: number;
    qualityThreshold: number;
    maxScriptAttempts: number;
    duplicateSimilarity: number;
    syllablesPerSecond: number;
    calibrationSamples: number;
    ocrEngine: 'llm' | 'gemini' | 'tesseract';
  };
  storage: Record<string, never>;
}

export interface SettingsResponse {
  settings: AllSettings;
  secrets: { google: { apiKey: SecretInfo }; openai: { apiKey: SecretInfo }; elevenlabs: { apiKey: SecretInfo } };
  pricingFreshness: { verifiedAt: string; stale: boolean; ageDays: number };
  environment: { mongoDb: string; storageDir: string; vectorStore: string; qdrantCollection: string };
}

export interface SystemStatus {
  mongo: { state: string; dbName: string };
  redis: { ok: boolean; message: string };
  vector: { kind: string; ok: boolean; message: string };
  binaries: Record<'ffmpeg' | 'ffprobe' | 'pdftotext' | 'pdftoppm' | 'tesseract', string | null>;
  disk: { total: number; free: number } | null;
  queues: Record<string, Record<string, number>> | null;
  storage: { dir: string; bytes: number; files: number };
}

export interface GeminiModel {
  id: string;
  name: string;
  displayName?: string;
  supportedGenerationMethods: string[];
  inputTokenLimit?: number;
}

export interface VideoCapabilities {
  provider: string;
  model: string;
  displayName: string;
  aspectRatios: string[];
  minClipSeconds: number;
  maxClipSeconds: number;
  durationControl: 'parameter' | 'prompt';
  resolutions: string[];
  referenceImages: { supported: boolean; max: number };
  generatesAudio: boolean;
  synchronous: boolean;
  watermark: string;
  requiresPaidTier: boolean;
  notes: string[];
  verifiedAt: string;
  docsUrl: string;
}

export interface GoogleTestResult {
  ok: boolean;
  modelCount: number;
  resolved: Record<string, string | null>;
  video: { provider?: string; model?: string; available: boolean; message: string; capabilities?: VideoCapabilities };
}

export interface ElevenTestResult {
  ok: boolean;
  subscription: { tier: string; status: string; characterCount: number; characterLimit: number; remaining: number; resetsAt: string | null };
  resolvedModel: string;
  models: { id: string; name: string; hindi: boolean; maxChars?: number }[];
}

export interface VideoProvidersResponse {
  providers: { id: string; label: string; capabilities: VideoCapabilities | null }[];
  selected: { provider: string; model: string };
}

export interface AnalyticsSummary {
  totals: { byCategory: Record<string, number>; total: number };
  daily: { date: string; byCategory: Record<string, number>; total: number }[];
  byModel: { provider: string; model: string; category: string; cost: number; quantity: number; unit: string }[];
  budget: { dailyLimit: number | null; monthlyLimit: number | null; maxCostPerEpisode: number | null; spentToday: number; spentThisMonth: number };
  storage: { bytes: number; files: number };
}

export interface EpisodeCostRow {
  episodeId: string;
  episodeNumber: number;
  title: string;
  cost: number;
  byCategory: Record<string, number>;
}

export interface BatchCostRow {
  batchId: string;
  name: string;
  createdAt: string;
  status: string;
  estimated: number;
  actual: number;
  videos: number;
}

export interface OpenAIModel {
  id: string;
  created: number;
  shutdownDate: string | null;
}

export interface OpenAITestResult {
  ok: boolean;
  active: boolean;
  modelCount: number;
  resolved: Record<'analysis' | 'text' | 'quality' | 'ocr' | 'light' | 'embedding', string>;
}
