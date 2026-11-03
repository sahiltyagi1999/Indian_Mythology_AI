import type {
  BatchStatus,
  EpisodeStatus,
  JobStatus,
  OutlineStatus,
  QueueKey,
  SceneStatus,
  SourceStatus,
  UsageCategory,
  VideoStatus,
} from './constants';

export interface SourceReference {
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  section?: string;
  excerpt: string;
}

export interface StorySourceDTO {
  _id: string;
  title: string;
  edition: string;
  language: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  totalPages: number;
  status: SourceStatus;
  progress: { stage: string; percent: number; message?: string };
  stats: { extractedPages: number; ocrPages: number; failedPages: number; chunks: number; embeddedChunks: number };
  extractionErrors: { page: number; message: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface OutlineEventDTO {
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
}

export interface OutlineEpisodePlanDTO {
  episodeNumber: number;
  title: string;
  synopsis: string;
  eventIds: string[];
  characters: string[];
  pageStart: number;
  pageEnd: number;
  continuityNote?: string;
}

export interface StoryOutlineDTO {
  _id: string;
  sourceId: string;
  version: number;
  status: OutlineStatus;
  progress: { stage: string; percent: number; message?: string };
  segmentsProcessed: number;
  segmentsTotal: number;
  events: OutlineEventDTO[];
  episodes: OutlineEpisodePlanDTO[];
  contradictions: { topic: string; description: string; pageRefs: number[] }[];
  createdAt: string;
  updatedAt: string;
}

export interface SceneDescription {
  sceneNumber: number;
  narrationExcerpt: string;
  visual: string;
  characters: string[];
  environment: string;
  emotion: string;
}

export interface QualityReport {
  scores: Record<string, number>;
  overall: number;
  passed: boolean;
  issues: string[];
  evaluatedAt: string;
  attempts: number;
}

export interface EpisodeDTO {
  _id: string;
  sourceId: string;
  outlineId: string;
  episodeNumber: number;
  title: string;
  slug: string;
  summary: string;
  hook: string;
  narrationText: string;
  /** Roman-script Hindi (Hinglish) reading copy; empty until generated. */
  titleHinglish: string;
  narrationHinglish: string;
  /** Script version the Hinglish copy was made from (stale if < currentVersion). */
  hinglishVersion: number;
  ending: string;
  nextEpisodeTeaser: string;
  narrationStyle: string;
  styleOverride?: string;
  characters: string[];
  storyArc: { setup: string; conflict: string; climax: string; resolution: string };
  storyTimeline: string;
  sourceReferences: SourceReference[];
  previousEpisodeId?: string;
  nextEpisodeId?: string;
  sceneDescriptions: SceneDescription[];
  estimatedDuration: number;
  estimatedWordCount: number;
  actualAudioDuration?: number;
  status: EpisodeStatus;
  currentVersion: number;
  quality?: QualityReport;
  uncertaintyNotes?: string;
  videoStatus?: VideoStatus | 'none';
  approvedAt?: string;
  lockedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterDTO {
  _id: string;
  sourceId?: string;
  name: string;
  nameHi?: string;
  aliases: string[];
  description: string;
  role: string;
  variants: {
    key: string;
    label: string;
    ageRange: string;
    facialFeatures: string;
    hair: string;
    clothing: string;
    armorAndAccessories: string;
    bodyType: string;
    colorPalette: string[];
    identityPrompt: string;
    referenceImages: string[];
  }[];
  firstAppearanceEpisode?: number;
  createdAt: string;
  updatedAt: string;
}

export interface VideoSceneDTO {
  _id: string;
  videoId: string;
  sceneNumber: number;
  startTime: number;
  duration: number;
  narrationSegment: string;
  visualDescription: string;
  characters: string[];
  environment: string;
  cameraMovement: string;
  lighting: string;
  emotion: string;
  continuity: string;
  prompt: string;
  status: SceneStatus;
  clipPath?: string;
  clipDuration?: number;
  attempts: number;
  error?: string;
  cost: number;
  reusedFrom?: string;
}

export interface VideoAssetDTO {
  _id: string;
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  batchId?: string;
  version: number;
  scriptVersion: number;
  status: VideoStatus;
  stage: string;
  progress: number;
  provider: string;
  model: string;
  settings: VideoGenerationSettings;
  audioPath?: string;
  videoPath?: string;
  subtitlePaths?: { srt?: string; ass?: string };
  thumbnailPath?: string;
  duration?: number;
  resolution?: string;
  fileSize?: number;
  estimatedCost: number;
  actualCost: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubtitleSettings {
  font: string;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  backgroundOpacity: number;
  /** Distance of subtitle baseline from the bottom, as a fraction of the frame height. */
  positionFromBottom: number;
  animation: 'none' | 'pop' | 'karaoke' | 'fade';
}

export interface VideoGenerationSettings {
  voiceId: string;
  ttsModel: string;
  narrationStyleOverride?: string;
  visualStyle: string;
  resolution: '720p' | '1080p';
  videoProvider: string;
  videoModel: string;
  /** Still-image providers (openai-image): low | medium | high. */
  imageQuality?: 'low' | 'medium' | 'high';
  musicTrackId?: string;
  musicVolume: number;
  sfxIntensity: number;
  subtitles: SubtitleSettings;
  logoPath?: string;
  /** Bumped by "regenerate with new visuals" so cached scene clips are not reused. */
  variation?: number;
}

export interface CostLine {
  category: UsageCategory;
  label: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  note?: string;
}

export interface CostEstimate {
  currency: 'USD';
  lines: CostLine[];
  total: number;
  perEpisode: { episodeId: string; episodeNumber: number; total: number; reusedAssets: string[] }[];
  expectedClips: number;
  estimatedRenderMinutes: number;
  pricingVerifiedAt: string;
  pricingStale: boolean;
  warnings: string[];
  budget: { dailyRemaining: number | null; monthlyRemaining: number | null; maxPerEpisode: number | null; exceeds: string[] };
}

export interface BatchDTO {
  _id: string;
  name: string;
  episodeIds: string[];
  videoIds: string[];
  settings: VideoGenerationSettings;
  maxConcurrency: number;
  status: BatchStatus;
  estimate: CostEstimate;
  actualCost: number;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationJobDTO {
  _id: string;
  queue: QueueKey;
  type: string;
  idempotencyKey: string;
  status: JobStatus;
  stage: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  sourceId?: string;
  episodeId?: string;
  episodeNumber?: number;
  videoId?: string;
  batchId?: string;
  sceneNumber?: number;
  estimatedCost: number;
  actualCost: number;
  error?: { message: string; code?: string; at: string; retryable: boolean };
  logs: { at: string; level: 'info' | 'warn' | 'error'; message: string }[];
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: { message: string; code: string; details?: unknown };
}
