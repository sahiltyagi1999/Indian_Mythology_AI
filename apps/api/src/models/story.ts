import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { EPISODE_STATUSES, OUTLINE_STATUSES, SOURCE_STATUSES } from '@mas/shared';

const progressSchema = new Schema(
  { stage: { type: String, default: '' }, percent: { type: Number, default: 0 }, message: String },
  { _id: false },
);

// ---------------------------------------------------------------- StorySource
const storySourceSchema = new Schema(
  {
    title: { type: String, required: true },
    edition: { type: String, default: '' },
    language: { type: String, default: 'hi' },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    fileSize: { type: Number, required: true },
    sha256: { type: String, required: true },
    totalPages: { type: Number, default: 0 },
    status: { type: String, enum: SOURCE_STATUSES, default: 'uploaded', index: true },
    progress: { type: progressSchema, default: () => ({}) },
    /** Extracted page texts live on disk (can be tens of MB); this is the storage key. */
    pagesKey: String,
    ocrMode: { type: String, enum: ['auto', 'always', 'never'], default: 'auto' },
    stats: {
      extractedPages: { type: Number, default: 0 },
      ocrPages: { type: Number, default: 0 },
      failedPages: { type: Number, default: 0 },
      chunks: { type: Number, default: 0 },
      embeddedChunks: { type: Number, default: 0 },
    },
    extractionErrors: [{ _id: false, page: Number, message: String }],
    embeddingModel: String,
    embeddingDimensions: Number,
  },
  { timestamps: true },
);
storySourceSchema.index({ sha256: 1 }, { unique: true });
export type StorySource = InferSchemaType<typeof storySourceSchema>;
export type StorySourceDoc = HydratedDocument<StorySource>;
export const StorySourceModel = mongoose.model('StorySource', storySourceSchema);

// ---------------------------------------------------------------- DocumentChunk
const documentChunkSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'StorySource', required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    pageStart: { type: Number, required: true },
    pageEnd: { type: Number, required: true },
    section: { type: String, default: '' },
    tokenEstimate: Number,
    contentHash: { type: String, required: true },
    /** Deterministic UUID used as the vector point id (idempotent upserts). */
    vectorId: { type: String, required: true },
    embedded: { type: Boolean, default: false },
    embeddingModel: String,
  },
  { timestamps: true },
);
documentChunkSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });
documentChunkSchema.index({ sourceId: 1, embedded: 1 });
documentChunkSchema.index({ vectorId: 1 }, { unique: true });
export type DocumentChunk = InferSchemaType<typeof documentChunkSchema>;
export const DocumentChunkModel = mongoose.model('DocumentChunk', documentChunkSchema);

// ---------------------------------------------------------------- Character
const characterVariantSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    ageRange: { type: String, default: '' },
    facialFeatures: { type: String, default: '' },
    hair: { type: String, default: '' },
    clothing: { type: String, default: '' },
    armorAndAccessories: { type: String, default: '' },
    bodyType: { type: String, default: '' },
    colorPalette: { type: [String], default: [] },
    identityPrompt: { type: String, default: '' },
    referenceImages: { type: [String], default: [] },
  },
  { _id: false },
);
const characterSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'StorySource' },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    nameHi: String,
    aliases: { type: [String], default: [] },
    description: { type: String, default: '' },
    role: { type: String, default: '' },
    variants: { type: [characterVariantSchema], default: [] },
    firstAppearanceEpisode: Number,
    /** True once a user has edited this character; AI refreshes will not overwrite it. */
    userEdited: { type: Boolean, default: false },
  },
  { timestamps: true },
);
characterSchema.index({ sourceId: 1, nameKey: 1 }, { unique: true });
characterSchema.index({ aliases: 1 });
export type Character = InferSchemaType<typeof characterSchema>;
export const CharacterModel = mongoose.model('Character', characterSchema);

// ---------------------------------------------------------------- StoryOutline
const outlineEventSchema = new Schema(
  {
    eventId: { type: String, required: true },
    order: Number,
    title: String,
    summary: String,
    characters: [String],
    pageStart: Number,
    pageEnd: Number,
    chunkIds: [String],
    certainty: { type: String, enum: ['certain', 'uncertain', 'varies'], default: 'certain' },
    notes: String,
    importance: { type: Number, default: 3 },
    era: { type: String, default: 'E00' },
    embeddedTale: { type: Boolean, default: false },
    /** Summary/preview of an event narrated in full elsewhere; dropped when the full narration exists. */
    recap: { type: Boolean, default: false },
  },
  { _id: false },
);
const outlineSegmentSchema = new Schema(
  {
    index: Number,
    chunkStart: Number,
    chunkEnd: Number,
    pageStart: Number,
    pageEnd: Number,
    status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' },
    events: { type: [outlineEventSchema], default: [] },
    characters: { type: [{ _id: false, name: String, nameHi: String, aliases: [String], note: String }], default: [] },
    contradictions: { type: [{ _id: false, topic: String, description: String }], default: [] },
    error: String,
  },
  { _id: false },
);
const outlineEpisodeSchema = new Schema(
  {
    episodeNumber: Number,
    title: String,
    synopsis: String,
    eventIds: [String],
    characters: [String],
    pageStart: Number,
    pageEnd: Number,
    continuityNote: String,
  },
  { _id: false },
);
const storyOutlineSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'StorySource', required: true },
    version: { type: Number, required: true },
    status: { type: String, enum: OUTLINE_STATUSES, default: 'generating' },
    progress: { type: progressSchema, default: () => ({}) },
    llmModel: String,
    segmentsTotal: { type: Number, default: 0 },
    segmentsProcessed: { type: Number, default: 0 },
    segments: { type: [outlineSegmentSchema], default: [] },
    events: { type: [outlineEventSchema], default: [] },
    episodes: { type: [outlineEpisodeSchema], default: [] },
    contradictions: { type: [{ _id: false, topic: String, description: String, pageRefs: [Number] }], default: [] },
    planningCursor: { type: Number, default: 0 },
    charactersDone: { type: Boolean, default: false },
    approvedAt: Date,
    error: String,
  },
  { timestamps: true },
);
storyOutlineSchema.index({ sourceId: 1, version: 1 }, { unique: true });
export type StoryOutline = InferSchemaType<typeof storyOutlineSchema>;
export const StoryOutlineModel = mongoose.model('StoryOutline', storyOutlineSchema);

// ---------------------------------------------------------------- Episode + ScriptVersion
const sourceRefSchema = new Schema(
  { chunkId: String, pageStart: Number, pageEnd: Number, section: String, excerpt: String },
  { _id: false },
);
const sceneDescriptionSchema = new Schema(
  {
    sceneNumber: Number,
    narrationExcerpt: String,
    visual: String,
    characters: [String],
    environment: String,
    emotion: String,
  },
  { _id: false },
);
const qualitySchema = new Schema(
  {
    scores: { type: Schema.Types.Mixed, default: {} },
    overall: Number,
    passed: Boolean,
    issues: [String],
    evaluatedAt: Date,
    attempts: Number,
  },
  { _id: false },
);
const storyArcSchema = new Schema(
  { setup: String, conflict: String, climax: String, resolution: String },
  { _id: false },
);

const episodeSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'StorySource', required: true },
    outlineId: { type: Schema.Types.ObjectId, ref: 'StoryOutline', required: true },
    episodeNumber: { type: Number, required: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    summary: { type: String, default: '' },
    hook: { type: String, default: '' },
    narrationText: { type: String, default: '' },
    ending: { type: String, default: '' },
    nextEpisodeTeaser: { type: String, default: '' },
    narrationStyle: { type: String, default: '' },
    styleOverride: String,
    styleReason: String,
    characters: { type: [String], default: [] },
    storyArc: { type: storyArcSchema, default: () => ({}) },
    storyTimeline: { type: String, default: '' },
    sourceReferences: { type: [sourceRefSchema], default: [] },
    previousEpisodeId: { type: Schema.Types.ObjectId, ref: 'Episode' },
    nextEpisodeId: { type: Schema.Types.ObjectId, ref: 'Episode' },
    sceneDescriptions: { type: [sceneDescriptionSchema], default: [] },
    estimatedDuration: { type: Number, default: 0 },
    estimatedWordCount: { type: Number, default: 0 },
    actualAudioDuration: Number,
    status: { type: String, enum: EPISODE_STATUSES, default: 'pending', index: true },
    currentVersion: { type: Number, default: 0 },
    quality: qualitySchema,
    uncertaintyNotes: String,
    highlightWords: { type: [String], default: [] },
    /** Roman-script (Hinglish) reading copy of the Hindi script; `hinglishVersion` = script version it matches. */
    titleHinglish: { type: String, default: '' },
    narrationHinglish: { type: String, default: '' },
    hinglishVersion: { type: Number, default: 0 },
    videoStatus: { type: String, default: 'none' },
    approvedAt: Date,
    lockedAt: Date,
    /** Set when the user explicitly asks for regeneration; consumed by the script worker. */
    regenerationRequestedAt: Date,
  },
  { timestamps: true },
);
episodeSchema.index({ sourceId: 1, episodeNumber: 1 }, { unique: true });
episodeSchema.index({ sourceId: 1, slug: 1 }, { unique: true });
episodeSchema.index({ characters: 1 });
episodeSchema.index({ narrationStyle: 1 });
episodeSchema.index({ title: 'text', summary: 'text', narrationText: 'text' });
export type Episode = InferSchemaType<typeof episodeSchema>;
export type EpisodeDoc = HydratedDocument<Episode>;
export const EpisodeModel = mongoose.model('Episode', episodeSchema);

const scriptVersionSchema = new Schema(
  {
    episodeId: { type: Schema.Types.ObjectId, ref: 'Episode', required: true },
    version: { type: Number, required: true },
    title: String,
    summary: String,
    hook: String,
    narrationText: { type: String, required: true },
    titleHinglish: String,
    narrationHinglish: String,
    ending: String,
    nextEpisodeTeaser: String,
    narrationStyle: String,
    characters: [String],
    sceneDescriptions: { type: [sceneDescriptionSchema], default: [] },
    sourceReferences: { type: [sourceRefSchema], default: [] },
    storyArc: storyArcSchema,
    estimatedDuration: Number,
    quality: qualitySchema,
    contentHash: { type: String, required: true },
    createdBy: { type: String, enum: ['ai', 'user'], required: true },
    /** Narration embedding used for duplicate detection; excluded from normal queries. */
    embedding: { type: [Number], select: false, default: undefined },
    embeddingModel: String,
    changeNote: String,
    model: String,
  },
  { timestamps: true },
);
scriptVersionSchema.index({ episodeId: 1, version: 1 }, { unique: true });
export type ScriptVersion = InferSchemaType<typeof scriptVersionSchema>;
export const ScriptVersionModel = mongoose.model('ScriptVersion', scriptVersionSchema);
