import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { BATCH_STATUSES, JOB_STATUSES, SCENE_STATUSES, USAGE_CATEGORIES, VIDEO_STATUSES } from '@mas/shared';

// ---------------------------------------------------------------- NarrationAsset
const narrationAssetSchema = new Schema(
  {
    episodeId: { type: Schema.Types.ObjectId, ref: 'Episode', required: true },
    scriptVersion: { type: Number, required: true },
    /** hash(script text, voice, model, settings) — identical inputs reuse the same audio. */
    cacheKey: { type: String, required: true },
    voiceId: { type: String, required: true },
    model: { type: String, required: true },
    settings: { type: Schema.Types.Mixed, default: {} },
    filePath: { type: String, required: true },
    alignmentPath: String,
    format: { type: String, default: 'mp3' },
    duration: { type: Number, required: true },
    characters: Number,
    cost: { type: Number, default: 0 },
    /** stale = script edited after this audio was produced. Never deleted silently. */
    status: { type: String, enum: ['active', 'stale'], default: 'active' },
  },
  { timestamps: true },
);
narrationAssetSchema.index({ cacheKey: 1 }, { unique: true });
narrationAssetSchema.index({ episodeId: 1, status: 1 });
export type NarrationAsset = InferSchemaType<typeof narrationAssetSchema>;
export const NarrationAssetModel = mongoose.model('NarrationAsset', narrationAssetSchema);

// ---------------------------------------------------------------- VideoAsset
const subtitleSettingsSchema = new Schema(
  {
    font: String,
    fontSize: Number,
    textColor: String,
    highlightColor: String,
    backgroundOpacity: Number,
    positionFromBottom: Number,
    animation: String,
  },
  { _id: false },
);
const videoSettingsSchema = new Schema(
  {
    voiceId: String,
    ttsModel: String,
    narrationStyleOverride: String,
    visualStyle: String,
    resolution: String,
    videoProvider: String,
    videoModel: String,
    musicTrackId: String,
    musicVolume: Number,
    sfxIntensity: Number,
    subtitles: subtitleSettingsSchema,
    logoPath: String,
    /** Incremented by "regenerate with new visuals" so scene cache keys change. */
    variation: { type: Number, default: 0 },
  },
  { _id: false },
);

const videoAssetSchema = new Schema(
  {
    episodeId: { type: Schema.Types.ObjectId, ref: 'Episode', required: true },
    sourceId: { type: Schema.Types.ObjectId, ref: 'StorySource', required: true },
    episodeNumber: Number,
    episodeTitle: String,
    batchId: { type: Schema.Types.ObjectId, ref: 'BatchGeneration' },
    version: { type: Number, required: true },
    scriptVersion: { type: Number, required: true },
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: VIDEO_STATUSES, default: 'queued', index: true },
    stage: { type: String, default: 'queued' },
    progress: { type: Number, default: 0 },
    provider: String,
    model: String,
    settings: videoSettingsSchema,
    narrationAssetId: { type: Schema.Types.ObjectId, ref: 'NarrationAsset' },
    audioPath: String,
    videoPath: String,
    subtitlePaths: { srt: String, ass: String },
    thumbnailPath: String,
    duration: Number,
    resolution: String,
    fileSize: Number,
    estimatedCost: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },
    renderLog: String,
    renderSeconds: Number,
    narrationTempo: Number,
    budgetOverride: { type: Boolean, default: false },
    planHash: String,
    warnings: { type: [String], default: [] },
    error: String,
    completedAt: Date,
    deletedAt: Date,
  },
  { timestamps: true },
);
videoAssetSchema.index({ episodeId: 1, version: 1 }, { unique: true });
videoAssetSchema.index({ idempotencyKey: 1 }, { unique: true });
videoAssetSchema.index({ batchId: 1 });
export type VideoAsset = InferSchemaType<typeof videoAssetSchema>;
export type VideoAssetDoc = HydratedDocument<VideoAsset>;
export const VideoAssetModel = mongoose.model('VideoAsset', videoAssetSchema);

// ---------------------------------------------------------------- VideoScene
const videoSceneSchema = new Schema(
  {
    videoId: { type: Schema.Types.ObjectId, ref: 'VideoAsset', required: true },
    episodeId: { type: Schema.Types.ObjectId, ref: 'Episode', required: true },
    sceneNumber: { type: Number, required: true },
    startTime: Number,
    duration: Number,
    narrationSegment: String,
    visualDescription: String,
    characters: [String],
    environment: String,
    cameraMovement: String,
    lighting: String,
    emotion: String,
    continuity: String,
    prompt: { type: String, required: true },
    referenceImages: { type: [String], default: [] },
    /** hash(prompt, references, provider, model, aspect, resolution): identical scenes are reused across versions. */
    cacheKey: { type: String, required: true },
    status: { type: String, enum: SCENE_STATUSES, default: 'pending' },
    clipPath: String,
    clipDuration: Number,
    hasAudio: Boolean,
    attempts: { type: Number, default: 0 },
    error: String,
    cost: { type: Number, default: 0 },
    reusedFrom: { type: Schema.Types.ObjectId, ref: 'VideoScene' },
    providerMeta: Schema.Types.Mixed,
  },
  { timestamps: true },
);
videoSceneSchema.index({ videoId: 1, sceneNumber: 1 }, { unique: true });
videoSceneSchema.index({ cacheKey: 1, status: 1 });
export type VideoScene = InferSchemaType<typeof videoSceneSchema>;
export const VideoSceneModel = mongoose.model('VideoScene', videoSceneSchema);

// ---------------------------------------------------------------- GenerationJob
const generationJobSchema = new Schema(
  {
    queue: { type: String, required: true },
    type: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    bullJobId: String,
    status: { type: String, enum: JOB_STATUSES, default: 'queued', index: true },
    stage: { type: String, default: 'queued' },
    progress: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    payload: { type: Schema.Types.Mixed, default: {} },
    sourceId: { type: Schema.Types.ObjectId, ref: 'StorySource' },
    episodeId: { type: Schema.Types.ObjectId, ref: 'Episode' },
    episodeNumber: Number,
    videoId: { type: Schema.Types.ObjectId, ref: 'VideoAsset' },
    batchId: { type: Schema.Types.ObjectId, ref: 'BatchGeneration' },
    sceneNumber: Number,
    estimatedCost: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },
    cancelRequested: { type: Boolean, default: false },
    error: { message: String, code: String, at: Date, retryable: Boolean },
    logs: { type: [{ _id: false, at: Date, level: String, message: String }], default: [] },
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true },
);
generationJobSchema.index({ idempotencyKey: 1 }, { unique: true });
generationJobSchema.index({ queue: 1, status: 1, createdAt: -1 });
generationJobSchema.index({ videoId: 1 });
generationJobSchema.index({ batchId: 1 });
export type GenerationJob = InferSchemaType<typeof generationJobSchema>;
export type GenerationJobDoc = HydratedDocument<GenerationJob>;
export const GenerationJobModel = mongoose.model('GenerationJob', generationJobSchema);

// ---------------------------------------------------------------- BatchGeneration
const batchSchema = new Schema(
  {
    name: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    episodeIds: [{ type: Schema.Types.ObjectId, ref: 'Episode' }],
    videoIds: [{ type: Schema.Types.ObjectId, ref: 'VideoAsset' }],
    settings: videoSettingsSchema,
    maxConcurrency: { type: Number, default: 2 },
    status: { type: String, enum: BATCH_STATUSES, default: 'awaiting_confirmation' },
    estimate: Schema.Types.Mixed,
    actualCost: { type: Number, default: 0 },
    budgetOverride: { type: Boolean, default: false },
    confirmedAt: Date,
  },
  { timestamps: true },
);
batchSchema.index({ idempotencyKey: 1 }, { unique: true });
export type BatchGeneration = InferSchemaType<typeof batchSchema>;
export const BatchGenerationModel = mongoose.model('BatchGeneration', batchSchema);

// ---------------------------------------------------------------- ProviderConfiguration
const providerConfigSchema = new Schema(
  {
    key: { type: String, required: true },
    settings: { type: Schema.Types.Mixed, default: {} },
    /** name -> AES-256-GCM encrypted value. Never serialised to API responses. */
    secrets: { type: Map, of: new Schema({ iv: String, tag: String, data: String }, { _id: false }), default: {} },
  },
  { timestamps: true, minimize: false },
);
providerConfigSchema.index({ key: 1 }, { unique: true });
export type ProviderConfiguration = InferSchemaType<typeof providerConfigSchema>;
export const ProviderConfigurationModel = mongoose.model('ProviderConfiguration', providerConfigSchema);

// ---------------------------------------------------------------- UsageRecord
const usageRecordSchema = new Schema(
  {
    category: { type: String, enum: USAGE_CATEGORIES, required: true },
    provider: { type: String, required: true },
    model: String,
    operation: String,
    quantity: { type: Number, default: 0 },
    unit: String,
    inputTokens: Number,
    outputTokens: Number,
    cost: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    pricingSource: String,
    sourceId: { type: Schema.Types.ObjectId, ref: 'StorySource' },
    episodeId: { type: Schema.Types.ObjectId, ref: 'Episode' },
    videoId: { type: Schema.Types.ObjectId, ref: 'VideoAsset' },
    batchId: { type: Schema.Types.ObjectId, ref: 'BatchGeneration' },
    jobId: { type: Schema.Types.ObjectId, ref: 'GenerationJob' },
  },
  { timestamps: true },
);
usageRecordSchema.index({ createdAt: -1 });
usageRecordSchema.index({ category: 1, createdAt: -1 });
usageRecordSchema.index({ episodeId: 1 });
usageRecordSchema.index({ batchId: 1 });
export type UsageRecord = InferSchemaType<typeof usageRecordSchema>;
export const UsageRecordModel = mongoose.model('UsageRecord', usageRecordSchema);

// ---------------------------------------------------------------- MusicTrack (user-supplied, licensed)
const musicTrackSchema = new Schema(
  {
    title: { type: String, required: true },
    filePath: { type: String, required: true },
    mood: { type: String, default: '' },
    duration: Number,
    license: { type: String, required: true },
    licenseUrl: String,
    attribution: String,
    commercialUseConfirmed: { type: Boolean, required: true },
    kind: { type: String, enum: ['music', 'sfx'], default: 'music' },
  },
  { timestamps: true },
);
export type MusicTrack = InferSchemaType<typeof musicTrackSchema>;
export const MusicTrackModel = mongoose.model('MusicTrack', musicTrackSchema);
