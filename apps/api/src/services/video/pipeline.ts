import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Types } from 'mongoose';
import {
  NARRATION_STYLES,
  VIDEO_READY_EPISODE_STATUSES,
  VISUAL_STYLES,
  countSyllables,
  punctuationPause,
  type EpisodeStatus,
  type VideoGenerationSettings,
} from '@mas/shared';
import {
  BatchGenerationModel,
  CharacterModel,
  EpisodeModel,
  GenerationJobModel,
  MusicTrackModel,
  NarrationAssetModel,
  VideoAssetModel,
  VideoSceneModel,
  type GenerationJobDoc,
} from '../../models';
import { storage, keys } from '../../storage';
import { enqueueJob, retryJob } from '../jobs';
import { getSettings, updateSettings } from '../settings';
import { recordUsage } from '../cost/usage';
import { lookupPrice } from '../cost/pricing';
import { assertBudget } from '../cost/budget';
import { stableHash, sha256 } from '../../lib/crypto';
import { AppError, conflict, notFound, ProviderError } from '../../lib/errors';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import * as eleven from '../../providers/tts/elevenlabs';
import { generateJson } from '../../providers/llm';
import { toJsonSchema } from '../../lib/schema';
import { getVideoProvider } from '../../providers/video/registry';
import { resolveVideoModel } from '../../providers/video/resolve';
import { MANUAL_MODEL, MANUAL_PROVIDER_ID } from '../../providers/video/manual';
import { segmentsFromWords, syntheticAlignment, wordsFromAlignment, type Segment } from './alignment';
import { buildCues, loadFonts, toAss, toSrt, writeSubtitleOverlay } from './subtitles';
import { probe } from './ffmpeg';
import { singleFlight } from '../../lib/lock';
import { renderVideo } from './render';
import { onTerminal, type JobContext } from '../../workers/runtime';

type Id = string | Types.ObjectId;
const ACTIVE_VIDEO = ['narrating', 'planning', 'generating_scenes', 'rendering'];
const permanent = (msg: string) => Object.assign(new Error(msg), { permanent: true });

// ------------------------------------------------------------------ settings

/** Fills unset generation settings from the saved provider/render defaults. */
export async function resolveVideoSettings(partial: Partial<VideoGenerationSettings>): Promise<VideoGenerationSettings> {
  const [render, el, google] = await Promise.all([getSettings('render'), getSettings('elevenlabs'), getSettings('google')]);
  const videoProvider = partial.videoProvider || google.videoProvider;
  return {
    voiceId: partial.voiceId || el.voiceId,
    ttsModel: partial.ttsModel ?? el.model,
    narrationStyleOverride: partial.narrationStyleOverride || undefined,
    visualStyle: partial.visualStyle || VISUAL_STYLES[1]!.id,
    resolution: partial.resolution ?? google.videoResolution,
    videoProvider,
    // A saved API model never applies to manual clips.
    videoModel: videoProvider === MANUAL_PROVIDER_ID ? MANUAL_MODEL : partial.videoModel ?? google.videoModel,
    musicTrackId: partial.musicTrackId || undefined,
    musicVolume: partial.musicVolume ?? render.musicVolume,
    sfxIntensity: partial.sfxIntensity ?? render.sfxIntensity,
    subtitles: { ...render.subtitles, ...(partial.subtitles ?? {}) },
    logoPath: partial.logoPath ?? (render.logoKey || undefined),
    variation: (partial as { variation?: number }).variation ?? 0,
  } as VideoGenerationSettings;
}

// ------------------------------------------------------------------ creation / scheduling

/** Creates a new VideoAsset version for an approved episode. Never overwrites an earlier version. */
export async function createVideoAsset(episodeId: Id, settings: VideoGenerationSettings, opts: { batchId?: Id; idempotencyKey: string }) {
  const existing = await VideoAssetModel.findOne({ idempotencyKey: opts.idempotencyKey });
  if (existing) return existing;
  const ep = await EpisodeModel.findById(episodeId).lean();
  if (!ep) throw notFound('Episode');
  if (!VIDEO_READY_EPISODE_STATUSES.includes(ep.status as EpisodeStatus)) throw conflict(`Episode ${ep.episodeNumber} is not approved (status: ${ep.status})`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await VideoAssetModel.findOne({ episodeId }).sort({ version: -1 }).select('version').lean();
    try {
      return await VideoAssetModel.create({
        episodeId,
        sourceId: ep.sourceId,
        episodeNumber: ep.episodeNumber,
        episodeTitle: ep.title,
        batchId: opts.batchId,
        version: (last?.version ?? 0) + 1,
        scriptVersion: ep.currentVersion,
        idempotencyKey: opts.idempotencyKey,
        status: 'queued',
        stage: 'queued',
        provider: settings.videoProvider,
        model: settings.videoModel,
        settings,
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      const raced = await VideoAssetModel.findOne({ idempotencyKey: opts.idempotencyKey });
      if (raced) return raced;
    }
  }
  throw conflict('Could not allocate a video version; try again');
}

async function setVideo(videoId: Id, patch: Record<string, unknown>) {
  const v = await VideoAssetModel.findByIdAndUpdate(videoId, { $set: patch }, { new: true }).lean();
  if (v && patch.status) {
    // Episode shows the status of its newest video.
    const newest = await VideoAssetModel.findOne({ episodeId: v.episodeId, deletedAt: null }).sort({ version: -1 }).select('_id status').lean();
    if (newest && String(newest._id) === String(v._id)) await EpisodeModel.updateOne({ _id: v.episodeId }, { $set: { videoStatus: v.status } });
  }
  return v;
}

/** Starts a queued video (narration step). Atomic: a video is started at most once. */
export async function startVideo(videoId: Id) {
  const v = await VideoAssetModel.findOneAndUpdate({ _id: videoId, status: 'queued' }, { $set: { status: 'narrating', stage: 'narration queued' } }, { new: true });
  if (!v) return null;
  await setVideo(v._id, { status: 'narrating' });
  await enqueueJob({ queue: 'audio', type: 'narrate', idempotencyKey: `audio:${v._id}`, videoId: v._id, episodeId: v.episodeId, episodeNumber: v.episodeNumber ?? undefined, batchId: v.batchId, sourceId: v.sourceId });
  return v;
}

/** Keeps at most batch.maxConcurrency videos of a batch in flight; starts the next queued ones in episode order. */
export async function scheduleBatch(batchId: Id) {
  const batch = await BatchGenerationModel.findById(batchId);
  if (!batch || !['running'].includes(batch.status)) return;
  let active = await VideoAssetModel.countDocuments({ batchId, status: { $in: ACTIVE_VIDEO } });
  while (active < batch.maxConcurrency) {
    const next = await VideoAssetModel.findOne({ batchId, status: 'queued' }).sort({ episodeNumber: 1 }).select('_id').lean();
    if (!next) break;
    if (await startVideo(next._id)) active++;
  }
  await refreshBatchStatus(batchId);
}

export async function refreshBatchStatus(batchId: Id) {
  const videos = await VideoAssetModel.find({ batchId }).select('status').lean();
  const batch = await BatchGenerationModel.findById(batchId);
  if (!batch || batch.status === 'cancelled' || batch.status === 'awaiting_confirmation') return;
  const counts = videos.reduce<Record<string, number>>((m, v) => ((m[v.status] = (m[v.status] ?? 0) + 1), m), {});
  const pending = (counts.queued ?? 0) + ACTIVE_VIDEO.reduce((n, s) => n + (counts[s] ?? 0), 0) + (counts.awaiting_confirmation ?? 0);
  if (pending > 0) return;
  const done = counts.completed ?? 0;
  batch.status = done === videos.length ? 'completed' : done === 0 ? 'failed' : 'partial';
  await batch.save();
}

// ------------------------------------------------------------------ step 1: narration

function blendTts(user: Awaited<ReturnType<typeof getSettings<'elevenlabs'>>>, styleId: string) {
  const style = NARRATION_STYLES.find((s) => s.id === styleId);
  if (!style) return user;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    ...user,
    stability: clamp((user.stability + style.ttsHints.stability) / 2, 0, 1),
    style: clamp((user.style + style.ttsHints.style) / 2, 0, 1),
    speed: clamp(user.speed * style.ttsHints.speed, 0.7, 1.2),
  };
}

export async function narrate(ctx: JobContext) {
  const video = await VideoAssetModel.findById(ctx.job.videoId);
  if (!video) throw permanent('Video not found');
  const ep = await EpisodeModel.findById(video.episodeId);
  if (!ep) throw permanent('Episode not found');
  if (!VIDEO_READY_EPISODE_STATUSES.includes(ep.status as EpisodeStatus)) throw permanent(`Episode is no longer approved (${ep.status})`);
  if (ep.currentVersion !== video.scriptVersion) {
    throw permanent(`Script changed after this video was queued (v${video.scriptVersion} → v${ep.currentVersion}). Regenerate the video to use the new script.`);
  }
  await setVideo(video._id, { status: 'narrating', stage: 'generating narration', progress: 5 });

  const user = await getSettings('elevenlabs');
  const styleId = video.settings?.narrationStyleOverride || ep.styleOverride || ep.narrationStyle;
  const tts = blendTts(user, styleId);
  const voiceId = video.settings?.voiceId || user.voiceId;
  const model = video.settings?.ttsModel || (await eleven.resolveTtsModel(user));
  const ttsSettings = { stability: tts.stability, similarityBoost: tts.similarityBoost, style: tts.style, speed: tts.speed, useSpeakerBoost: tts.useSpeakerBoost, languageCode: tts.languageCode, outputFormat: tts.outputFormat };
  const cacheKey = stableHash({ text: ep.narrationText, voiceId, model, ttsSettings });

  const findCached = async () => {
    const a = await NarrationAssetModel.findOne({ cacheKey });
    return a && (await storage().exists(a.filePath)) ? a : null;
  };
  let produced = false;
  const asset = await singleFlight(`narration:${cacheKey}`, findCached, async () => {
    produced = true;
    const price = await lookupPrice({ provider: 'elevenlabs', model, unit: '1k_characters' });
    await assertBudget(((ep.narrationText.length / 1000) * (price.price ?? 0)), video._id);
    await ctx.checkCancelled();
    const out = await eleven.textToSpeech(ep.narrationText, { voiceId, model, settings: ttsSettings });
    const filePath = keys.narration(String(ep.sourceId), ep.episodeNumber, cacheKey);
    await storage().put(filePath, out.audio);
    const info = await probe(await storage().localPath(filePath));
    const alignment = out.alignment ?? syntheticAlignment(ep.narrationText, info.duration);
    const alignmentPath = keys.alignment(String(ep.sourceId), ep.episodeNumber, cacheKey);
    await storage().put(alignmentPath, JSON.stringify({ synthetic: !out.alignment, ...alignment }));
    const cost = await recordUsage({ category: 'narration', provider: 'elevenlabs', model, operation: 'tts', quantity: out.characters, unit: '1k_characters' }, ctx.usage);
    // A stale asset with the same key (same text) is replaced by the fresh one.
    await NarrationAssetModel.deleteOne({ cacheKey });
    const created = await NarrationAssetModel.create({
      episodeId: ep._id, scriptVersion: ep.currentVersion, cacheKey, voiceId, model, settings: ttsSettings,
      filePath, alignmentPath, format: 'mp3', duration: info.duration, characters: out.characters, cost,
    });
    if (!out.alignment) await ctx.log('Provider returned no timestamps; subtitle timing is approximated', 'warn');
    await calibrate(ep.narrationText, info.duration);
    return created;
  }, { onWait: () => ctx.checkCancelled() });
  if (!produced) {
    await ctx.log(`Reusing cached narration ${asset._id} (same script, voice and settings)`);
    if (asset.status === 'stale') await NarrationAssetModel.updateOne({ _id: asset._id }, { $set: { status: 'active' } });
  }

  // Duration check against target range. Small deviations are corrected by tempo at render time.
  const render = await getSettings('render');
  const warnings: string[] = [];
  const dev = asset.duration - render.targetDuration;
  if (Math.abs(dev) > render.durationTolerance) {
    const needed = asset.duration / render.targetDuration;
    if (Math.abs(needed - 1) > render.maxSpeedAdjust) {
      warnings.push(
        `Narration is ${asset.duration.toFixed(1)}s (target ${render.targetDuration}±${render.durationTolerance}s). Consider revising the script; the video keeps the natural pace.`,
      );
    }
  }
  await EpisodeModel.updateOne({ _id: ep._id }, { $set: { actualAudioDuration: Math.round(asset.duration * 10) / 10 } });
  await setVideo(video._id, { narrationAssetId: asset._id, audioPath: asset.filePath, stage: 'narration ready', progress: 15, ...(warnings.length ? { warnings: [...video.warnings, ...warnings] } : {}) });
  await enqueueJob({ queue: 'video', type: 'plan-scenes', idempotencyKey: `plan:${video._id}`, videoId: video._id, episodeId: ep._id, episodeNumber: ep.episodeNumber, batchId: video.batchId, sourceId: ep.sourceId });
}

/** Learns the real speaking rate (syllables/second) from produced audio to improve future script estimates. */
async function calibrate(text: string, duration: number) {
  const speaking = duration - punctuationPause(text);
  if (speaking <= 5) return;
  const measured = countSyllables(text) / speaking;
  const story = await getSettings('story');
  const n = Math.min(story.calibrationSamples, 49);
  const next = (story.syllablesPerSecond * n + measured) / (n + 1);
  await updateSettings('story', { syllablesPerSecond: Math.round(next * 100) / 100, calibrationSamples: story.calibrationSamples + 1 } as never);
}

// ------------------------------------------------------------------ step 2: scene planning

const planSchema = z.object({
  scenes: z
    .array(
      z.object({
        segmentIds: z.array(z.number().int()).min(1),
        visualDescription: z.string(),
        characters: z.array(z.object({ name: z.string(), variantKey: z.string() })),
        environment: z.string(),
        cameraMovement: z.string(),
        lighting: z.string(),
        emotion: z.string(),
        continuity: z.string(),
      }),
    )
    .min(3)
    .max(12),
});
type PlannedScene = z.infer<typeof planSchema>['scenes'][number];

/** Checks that planned scenes cover every segment exactly once, in order. */
export function validCoverage(scenes: { segmentIds: number[] }[], segmentCount: number) {
  const flat = scenes.flatMap((s) => s.segmentIds);
  return flat.length === segmentCount && flat.every((id, i) => id === i + 1);
}

/** Deterministic fallback grouping: contiguous segments, ~equal duration, respecting the clip maximum. */
export function groupSegments(segments: Segment[], targetScenes: number, maxSeconds: number): number[][] {
  const total = segments.at(-1)!.end;
  const ideal = Math.min(maxSeconds, total / targetScenes);
  const groups: number[][] = [];
  let cur: Segment[] = [];
  for (const s of segments) {
    const start = cur[0]?.start ?? s.start;
    if (cur.length && (s.end - start > maxSeconds || s.end - start > ideal * 1.25)) {
      groups.push(cur.map((c) => c.id));
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length) groups.push(cur.map((c) => c.id));
  return groups;
}

export async function loadAlignment(narrationAssetId: unknown) {
  const asset = await NarrationAssetModel.findById(narrationAssetId).lean();
  if (!asset) throw permanent('Narration asset missing');
  const raw = asset.alignmentPath ? JSON.parse((await storage().get(asset.alignmentPath)).toString('utf8')) : null;
  return { asset, words: wordsFromAlignment(raw ?? syntheticAlignment('', asset.duration)) };
}

export async function planScenes(ctx: JobContext) {
  const video = await VideoAssetModel.findById(ctx.job.videoId);
  if (!video) throw permanent('Video not found');
  const ep = await EpisodeModel.findById(video.episodeId).lean();
  if (!ep) throw permanent('Episode not found');
  await setVideo(video._id, { status: 'planning', stage: 'planning scenes', progress: 18 });

  const settings = await resolveVideoSettings((video.settings ?? {}) as Partial<VideoGenerationSettings>);
  const { provider: providerId, model } = settings.videoModel ? { provider: settings.videoProvider, model: settings.videoModel } : await resolveVideoModel();
  const provider = getVideoProvider(providerId);
  const caps = await provider.getCapabilities(model);
  const visual = VISUAL_STYLES.find((v) => v.id === settings.visualStyle) ?? VISUAL_STYLES[0]!;

  const { asset, words } = await loadAlignment(video.narrationAssetId);
  const segments = segmentsFromWords(words, caps.maxClipSeconds);
  if (!segments.length) throw permanent('Narration alignment produced no segments');
  const characters = await CharacterModel.find({ sourceId: ep.sourceId, name: { $in: ep.characters } }).lean();
  const charText = characters.map((c) => `${c.name} (${c.nameHi ?? ''}): variants ${c.variants.map((v) => `${v.key}=${v.label}`).join(', ') || 'default'}`).join('\n');

  let planned: PlannedScene[] | null = null;
  try {
    const { data } = await generateJson({
      role: 'text',
      operation: 'video:scene-plan',
      system: `You are the director and cinematographer of a cinematic vertical (9:16) Mahabharata short film. Map timed narration segments to 7–9 consecutive visual scenes.
Rules:
- Every segment belongs to exactly one scene; scenes are contiguous and in order; together they cover all segments.
- A scene should last ${caps.minClipSeconds}–${caps.maxClipSeconds} seconds of narration.
- Visuals must literally depict what the narration says at that moment (specific characters, actions, places from the story), never generic filler.
- Keep characters, costumes, places and time of day consistent between scenes; state continuity explicitly.
- Choose character variants (age versions) that fit this point in the story.
- Vertical composition: subject centred, important action in the upper two-thirds. No on-screen text.`,
      prompt: `Episode ${ep.episodeNumber}: ${ep.title}\nTimeline: ${ep.storyTimeline}\nVisual style: ${visual.name} — ${visual.description}\n\nScript scene notes:\n${ep.sceneDescriptions
        .map((s) => `${s.sceneNumber}. ${s.visual} [${s.environment}; ${s.emotion}] — "${s.narrationExcerpt}"`)
        .join('\n')}\n\nCharacters available:\n${charText || '(none in library)'}\n\nNarration segments:\n${segments.map((s) => `S${s.id} [${s.start.toFixed(2)}-${s.end.toFixed(2)}s] ${s.text}`).join('\n')}`,
      jsonSchema: toJsonSchema(planSchema),
      validator: planSchema,
      maxOutputTokens: 8192,
      usage: ctx.usage,
    });
    if (validCoverage(data.scenes, segments.length)) planned = data.scenes;
    else await ctx.log('Scene plan did not cover narration segments exactly; using deterministic grouping', 'warn');
  } catch (err) {
    if (err instanceof ProviderError && !err.retryable) throw err;
    await ctx.log(`Scene planner failed (${(err as Error).message}); using deterministic grouping`, 'warn');
  }
  if (!planned) {
    const groups = groupSegments(segments, 8, caps.maxClipSeconds);
    planned = groups.map((ids, i) => {
      const note = ep.sceneDescriptions[Math.min(ep.sceneDescriptions.length - 1, Math.floor((i / groups.length) * ep.sceneDescriptions.length))];
      return {
        segmentIds: ids,
        visualDescription: note?.visual ?? ep.title,
        characters: (note?.characters ?? []).map((name) => ({ name, variantKey: '' })),
        environment: note?.environment ?? '',
        cameraMovement: i === 0 ? 'slow push-in' : 'gentle tracking shot',
        lighting: 'cinematic, motivated',
        emotion: note?.emotion ?? '',
        continuity: 'Same costumes and setting as the previous scene unless the narration moves elsewhere.',
      };
    });
  }

  // Build scene records with timings, prompts and cache keys.
  const segById = new Map(segments.map((s) => [s.id, s]));
  const scenesOut = [];
  for (let i = 0; i < planned.length; i++) {
    const p = planned[i]!;
    const segs = p.segmentIds.map((id) => segById.get(id)!).filter(Boolean);
    const start = i === 0 ? 0 : segs[0]!.start;
    const nextStart = i < planned.length - 1 ? segById.get(planned[i + 1]!.segmentIds[0]!)!.start : asset.duration + 0.6;
    const refs: { key: string; label: string }[] = [];
    const charLines = p.characters.map((c) => {
      const ch = characters.find((x) => x.name.toLowerCase() === c.name.toLowerCase() || x.aliases.includes(c.name));
      const variant = ch?.variants.find((v) => v.key === c.variantKey) ?? ch?.variants[0];
      if (!ch || !variant) return c.name;
      const img = variant.referenceImages[0];
      if (img && caps.referenceImages.supported && refs.length < caps.referenceImages.max) refs.push({ key: img, label: ch.name });
      return `${ch.name}: ${variant.identityPrompt}${img && refs.some((r) => r.key === img) ? ` (appearance as in {{REF:${ch.name}}})` : ''}`;
    });
    const prompt = [
      `SCENE ${i + 1}. ${visual.promptPrefix}.`,
      p.visualDescription,
      charLines.length ? `Characters — ${charLines.join(' | ')}` : '',
      `Setting: ${p.environment}. Camera: ${p.cameraMovement}. Lighting: ${p.lighting}. Mood: ${p.emotion}.`,
      `Continuity: ${p.continuity}`,
      `The scene illustrates this narration (do not render any text): "${segs.map((s) => s.text).join(' ')}"`,
    ]
      .filter(Boolean)
      .join('\n');
    const refHashes = await Promise.all(refs.map(async (r) => sha256(await storage().get(r.key))));
    const cacheKey = stableHash({ prompt, refHashes, provider: providerId, model, aspect: '9:16', resolution: settings.resolution, avoid: visual.negativeGuidance, variation: settings.variation ?? 0 });
    scenesOut.push({
      videoId: video._id,
      episodeId: ep._id,
      sceneNumber: i + 1,
      startTime: start,
      duration: Math.max(0.5, nextStart - start),
      narrationSegment: segs.map((s) => s.text).join(' '),
      visualDescription: p.visualDescription,
      characters: p.characters.map((c) => c.name),
      environment: p.environment,
      cameraMovement: p.cameraMovement,
      lighting: p.lighting,
      emotion: p.emotion,
      continuity: p.continuity,
      prompt,
      referenceImages: refs.map((r) => r.key),
      cacheKey,
    });
  }

  // Persist (idempotent per video+scene) and reuse identical completed scenes from any earlier video.
  await VideoSceneModel.deleteMany({ videoId: video._id, sceneNumber: { $gt: scenesOut.length } });
  for (const s of scenesOut) {
    const existing = await VideoSceneModel.findOne({ videoId: video._id, sceneNumber: s.sceneNumber });
    if (existing?.status === 'completed' && existing.cacheKey === s.cacheKey) continue;
    const cached = await VideoSceneModel.findOne({ cacheKey: s.cacheKey, status: 'completed', clipPath: { $exists: true } }).sort({ createdAt: 1 }).lean();
    const reusable = cached && (await storage().exists(cached.clipPath!));
    await VideoSceneModel.updateOne(
      { videoId: video._id, sceneNumber: s.sceneNumber },
      {
        $set: {
          ...s,
          ...(reusable
            ? { status: 'completed', clipPath: cached!.clipPath, clipDuration: cached!.clipDuration, hasAudio: cached!.hasAudio, reusedFrom: cached!._id, cost: 0 }
            : { status: 'pending', attempts: 0 }),
        },
        $unset: { error: 1 },
      },
      { upsert: true },
    );
  }
  const planHash = stableHash(scenesOut.map((s) => s.cacheKey));
  const reused = await VideoSceneModel.countDocuments({ videoId: video._id, reusedFrom: { $exists: true } });
  const stage = providerId === MANUAL_PROVIDER_ID ? `waiting for ${scenesOut.length} uploaded clips` : `generating ${scenesOut.length} scenes`;
  await setVideo(video._id, { status: 'generating_scenes', stage, progress: 25, provider: providerId, model, planHash });
  await ctx.log(`Planned ${scenesOut.length} scenes (${reused} reused from cache) with ${providerId}/${model}`);
  await enqueuePendingScenes(String(video._id));
}

export async function enqueuePendingScenes(videoId: string) {
  const video = await VideoAssetModel.findById(videoId).lean();
  const pending = await VideoSceneModel.find({ videoId, status: { $in: ['pending', 'failed'] } }).sort({ sceneNumber: 1 }).lean();
  // Manual clips arrive through uploadSceneClip; there is nothing to queue.
  if (video?.provider === MANUAL_PROVIDER_ID && pending.length) return;
  for (const s of pending) {
    await enqueueJob({
      queue: 'video',
      type: 'generate-scene',
      idempotencyKey: `scene:${videoId}:${s.sceneNumber}:${s.cacheKey.slice(0, 16)}`,
      videoId,
      episodeId: s.episodeId,
      episodeNumber: video?.episodeNumber ?? undefined,
      batchId: video?.batchId,
      sourceId: video?.sourceId,
      sceneNumber: s.sceneNumber,
      payload: { sceneId: String(s._id) },
      maxAttempts: 4,
    });
  }
  if (!pending.length) await maybeEnqueueRender(videoId);
}

// ------------------------------------------------------------------ step 3: scene clips

export async function generateScene(ctx: JobContext) {
  const scene = await VideoSceneModel.findById(ctx.payload.sceneId);
  if (!scene) throw permanent('Scene not found');
  const video = await VideoAssetModel.findById(scene.videoId);
  if (!video) throw permanent('Video not found');
  if (scene.status === 'completed' && scene.clipPath && (await storage().exists(scene.clipPath))) {
    await maybeEnqueueRender(String(video._id));
    return;
  }
  // Cross-video cache (e.g. a regenerated video, or two episodes in a batch with an identical scene).
  const findCached = async () => {
    const c = await VideoSceneModel.findOne({ cacheKey: scene.cacheKey, status: 'completed', _id: { $ne: scene._id } }).lean();
    return c?.clipPath && (await storage().exists(c.clipPath)) ? c : null;
  };
  const shared = await singleFlight(`scene:${scene.cacheKey}`, findCached, async () => {
    await produceScene(ctx, scene, video);
    return null as unknown as Awaited<ReturnType<typeof findCached>>;
  }, { onWait: () => ctx.checkCancelled() });
  if (shared) {
    Object.assign(scene, { status: 'completed', clipPath: shared.clipPath, clipDuration: shared.clipDuration, hasAudio: shared.hasAudio, reusedFrom: shared._id, cost: 0 });
    await scene.save();
  }
  await afterScene(String(video._id));
}

async function produceScene(ctx: JobContext, scene: InstanceType<typeof VideoSceneModel>, video: InstanceType<typeof VideoAssetModel>) {
  const provider = getVideoProvider(video.provider!);
  const caps = await provider.getCapabilities(video.model!);
  const clipSeconds = Math.min(caps.maxClipSeconds, Math.max(caps.minClipSeconds, scene.duration ?? caps.maxClipSeconds));
  const resolution = video.settings?.resolution ?? '720p';
  const est = await provider.estimateCost(video.model!, clipSeconds, resolution);
  await assertBudget(est.amount ?? 0, video._id);
  await ctx.checkCancelled();

  scene.status = 'generating';
  scene.attempts += 1;
  await scene.save();
  await ctx.progress(`generating scene ${scene.sceneNumber}`, 10);

  const refs = await Promise.all(
    scene.referenceImages.map(async (key) => {
      const ext = path.extname(key).toLowerCase();
      return { data: await storage().get(key), mimeType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', label: 'ref' };
    }),
  );
  // Labels in the prompt are character names; map each reference to the character whose placeholder appears.
  const labels = [...scene.prompt.matchAll(/\{\{REF:([^}]+)\}\}/g)].map((m) => m[1]!);
  refs.forEach((r, i) => (r.label = labels[i] ?? r.label));
  const visual = VISUAL_STYLES.find((v) => v.id === video.settings?.visualStyle) ?? VISUAL_STYLES[0]!;

  let handle = await provider.generateVideo(video.model!, { prompt: scene.prompt, aspectRatio: '9:16', durationSeconds: clipSeconds, resolution, referenceImages: refs, avoid: visual.negativeGuidance }, ctx.usage);
  const deadline = Date.now() + 20 * 60_000;
  while (handle.status === 'running' || (handle.uri && !handle.inline)) {
    const checked = await provider.checkStatus(video.model!, handle);
    if (checked.status !== 'running') {
      handle = checked;
      break;
    }
    if (Date.now() > deadline) throw new ProviderError('Video generation timed out after 20 minutes', provider.id, true);
    await ctx.checkCancelled();
    await new Promise((r) => setTimeout(r, 10_000));
  }
  if (handle.status === 'failed') {
    // Safety filtering and empty results are not fixed by retrying the same prompt.
    throw new ProviderError(`Scene ${scene.sceneNumber}: ${handle.error ?? 'generation failed'}`, provider.id, false, undefined, 'GENERATION_FAILED');
  }
  const bytes = await provider.downloadVideo(handle);
  const key = keys.sceneClip(String(video.sourceId), video.episodeNumber ?? 0, scene.cacheKey);
  await storage().put(key, bytes);
  const info = await probe(await storage().localPath(key));
  if (!info.hasVideo || info.duration < 0.5) throw new ProviderError(`Scene ${scene.sceneNumber}: provider returned an invalid clip`, provider.id, true);
  const cost = await recordUsage(
    { category: 'video', provider: 'google', model: video.model!, operation: `scene:${scene.sceneNumber}`, quantity: info.duration, unit: 'second', variant: resolution },
    ctx.usage,
  );
  Object.assign(scene, { status: 'completed', clipPath: key, clipDuration: info.duration, hasAudio: info.hasAudio, cost, providerMeta: { id: handle.providerJobId }, error: undefined });
  await scene.save();
}

async function afterScene(videoId: string) {
  const [total, done] = await Promise.all([VideoSceneModel.countDocuments({ videoId }), VideoSceneModel.countDocuments({ videoId, status: 'completed' })]);
  // Progress only while generating: a failure/pause message must stay visible.
  await VideoAssetModel.updateOne({ _id: videoId, status: 'generating_scenes' }, { $set: { stage: `scenes ${done}/${total}`, progress: 25 + Math.round((done / Math.max(1, total)) * 50) } });
  await maybeEnqueueRender(videoId);
}

export async function maybeEnqueueRender(videoId: string) {
  const video = await VideoAssetModel.findById(videoId).lean();
  if (!video || video.status === 'completed' || video.status === 'cancelled') return;
  const scenes = await VideoSceneModel.find({ videoId }).select('status').lean();
  if (!scenes.length || scenes.some((s) => s.status !== 'completed')) return;
  // Idempotency key includes the plan: re-running after a scene retry reuses the same render job.
  await enqueueJob({ queue: 'render', type: 'render-video', idempotencyKey: `render:${videoId}:${video.planHash}`, videoId, episodeId: video.episodeId, episodeNumber: video.episodeNumber ?? undefined, batchId: video.batchId, sourceId: video.sourceId });
}

// ------------------------------------------------------------------ step 4: render

export async function renderVideoJob(ctx: JobContext) {
  const video = await VideoAssetModel.findById(ctx.job.videoId);
  if (!video) throw permanent('Video not found');
  const ep = await EpisodeModel.findById(video.episodeId).lean();
  if (!ep) throw permanent('Episode not found');
  const scenes = await VideoSceneModel.find({ videoId: video._id }).sort({ sceneNumber: 1 }).lean();
  if (scenes.some((s) => s.status !== 'completed')) throw permanent('Not all scenes are complete');
  await setVideo(video._id, { status: 'rendering', stage: 'rendering', progress: 78 });
  const t0 = Date.now();

  const [render, settings] = await Promise.all([getSettings('render'), resolveVideoSettings((video.settings ?? {}) as Partial<VideoGenerationSettings>)]);
  const { asset, words } = await loadAlignment(video.narrationAssetId);
  const caps = await getVideoProvider(video.provider!).getCapabilities(video.model!);

  // Tempo: nudge narration toward the target only within maxSpeedAdjust (never audibly unnatural).
  let tempo = 1;
  if (Math.abs(asset.duration - render.targetDuration) > render.durationTolerance) {
    const needed = asset.duration / render.targetDuration;
    tempo = Math.min(1 + render.maxSpeedAdjust, Math.max(1 - render.maxSpeedAdjust, needed));
  }
  const total = asset.duration / tempo + 0.6;
  const timeline = scenes.map((s, i) => {
    const start = (i === 0 ? 0 : s.startTime!) / tempo;
    const end = i < scenes.length - 1 ? scenes[i + 1]!.startTime! / tempo : total;
    return { clipPath: s.clipPath!, duration: Math.max(0.4, end - start) };
  });

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `mas-render-${video._id}-`));
  try {
    const scaled = words.map((w) => ({ ...w, start: w.start / tempo, end: w.end / tempo }));
    const cues = buildCues(scaled);
    const subs = settings.subtitles;
    const chars = await CharacterModel.find({ sourceId: ep.sourceId, name: { $in: ep.characters } }).select('nameHi').lean();
    const highlight = new Set([...(ep.highlightWords ?? []), ...chars.map((c) => c.nameHi ?? '').filter(Boolean)].map((w) => w.replace(/[।,.!?]/g, '')));
    await loadFonts(path.join(env.STORAGE_DIR, 'library', 'fonts'));
    const subtitleList = await writeSubtitleOverlay(path.join(work, 'subs'), cues, total, subs, highlight);

    const music = settings.musicTrackId ? await MusicTrackModel.findById(settings.musicTrackId).lean() : null;
    const logoKey = settings.logoPath;
    const out = path.join(work, 'final.mp4');
    const thumb = path.join(work, 'thumbnail.jpg');
    const result = await renderVideo({
      workDir: path.join(work, 'clips'),
      scenes: await Promise.all(timeline.map(async (t) => ({ ...t, clipPath: await storage().localPath(t.clipPath) }))),
      narrationPath: await storage().localPath(asset.filePath),
      narrationTempo: tempo,
      totalDuration: total,
      musicPath: music ? await storage().localPath(music.filePath) : undefined,
      musicVolume: settings.musicVolume,
      sfxIntensity: caps.generatesAudio ? settings.sfxIntensity : 0,
      subtitleList,
      colorGrade: (VISUAL_STYLES.find((v) => v.id === settings.visualStyle) ?? VISUAL_STYLES[0]!).colorGrade,
      transition: render.transition,
      transitionDuration: render.transitionDuration,
      allowPushIn: !caps.visibleWatermark,
      fps: render.fps,
      crf: render.crf,
      preset: render.preset,
      loudnessLufs: render.narrationLoudnessLufs,
      logoPath: logoKey && (await storage().exists(logoKey)) ? await storage().localPath(logoKey) : undefined,
      logoPosition: render.logoPosition,
      output: out,
      thumbnail: thumb,
      onProgress: (p, stage) => void ctx.progress(stage, p * 100).catch(() => undefined),
    });

    const sid = String(video.sourceId);
    const k = (f: string) => keys.render(sid, video.episodeNumber ?? 0, String(video._id), f);
    await storage().putFile(k('final.mp4'), out, { move: true });
    await storage().putFile(k('thumbnail.jpg'), thumb, { move: true });
    await storage().put(k('subtitles.srt'), toSrt(cues));
    await storage().put(k('subtitles.ass'), toAss(cues, subs, highlight));
    const renderSeconds = (Date.now() - t0) / 1000;
    await recordUsage({ category: 'rendering', provider: 'local-ffmpeg', model: 'ffmpeg', operation: 'render', quantity: renderSeconds, unit: 'render_second', cost: 0 }, ctx.usage);
    await setVideo(video._id, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      videoPath: k('final.mp4'),
      thumbnailPath: k('thumbnail.jpg'),
      subtitlePaths: { srt: k('subtitles.srt'), ass: k('subtitles.ass') },
      duration: Math.round(result.duration * 100) / 100,
      resolution: `${result.width}x${result.height}`,
      fileSize: result.size,
      renderSeconds,
      narrationTempo: tempo,
      completedAt: new Date(),
      ...(tempo !== 1 ? { warnings: [...video.warnings, `Narration tempo adjusted ×${tempo.toFixed(3)} to approach the target duration`] } : {}),
    });
    if (video.batchId) await scheduleBatch(video.batchId);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ failure handling

const VIDEO_JOB_TYPES = ['narrate', 'plan-scenes', 'generate-scene', 'render-video'];

/** Reflects terminal job outcomes on the VideoAsset/VideoScene and keeps the batch moving. */
let hookRegistered = false;
export function registerVideoTerminalHook() {
  if (hookRegistered) return;
  hookRegistered = true;
  onTerminal(async (job: GenerationJobDoc, outcome, err) => {
    if (!VIDEO_JOB_TYPES.includes(job.type) || !job.videoId) return;
    const message = err.message;
    if (job.type === 'generate-scene' && job.payload?.sceneId) {
      await VideoSceneModel.updateOne({ _id: job.payload.sceneId, status: { $ne: 'completed' } }, { $set: { status: outcome === 'failed' ? 'failed' : 'pending', error: message } });
    }
    const status = outcome === 'awaiting_confirmation' ? 'awaiting_confirmation' : outcome === 'cancelled' ? 'cancelled' : 'failed';
    const stage =
      job.type === 'generate-scene' ? `scene ${job.sceneNumber} ${outcome === 'failed' ? 'failed' : outcome}` : `${job.type} ${outcome === 'failed' ? 'failed' : outcome}`;
    await setVideo(job.videoId, { status, stage, error: message });
    if (job.batchId) await scheduleBatch(job.batchId).catch((e) => logger.error(e, 'scheduleBatch failed'));
  });
}

// ------------------------------------------------------------------ user actions

/** Resumes a failed/paused video from where it stopped: re-runs only failed jobs; completed work is reused. */
export async function resumeVideo(videoId: string) {
  const video = await VideoAssetModel.findById(videoId);
  if (!video) throw notFound('Video');
  if (!['failed', 'awaiting_confirmation', 'cancelled'].includes(video.status)) throw conflict(`Video is ${video.status}`);
  const failedJobs = await GenerationJobModel.find({ videoId, status: { $in: ['failed', 'cancelled', 'awaiting_confirmation'] } }).sort({ createdAt: 1 });
  const stageStatus = video.narrationAssetId ? (video.planHash ? 'generating_scenes' : 'planning') : 'narrating';
  await setVideo(video._id, { status: stageStatus, stage: 'resuming', error: null });
  if (!failedJobs.length) {
    if (!video.narrationAssetId) {
      await VideoAssetModel.updateOne({ _id: video._id }, { $set: { status: 'queued' } });
      await startVideo(video._id);
    } else if (!video.planHash) await enqueueJob({ queue: 'video', type: 'plan-scenes', idempotencyKey: `plan:${video._id}`, videoId: video._id, episodeId: video.episodeId, force: true });
    else await enqueuePendingScenes(String(video._id));
    return video;
  }
  for (const j of failedJobs) {
    if (j.type === 'generate-scene' && j.payload?.sceneId) await VideoSceneModel.updateOne({ _id: j.payload.sceneId, status: 'failed' }, { $set: { status: 'pending' } });
    await retryJob(String(j._id));
  }
  return video;
}

export async function retryScene(videoId: string, sceneNumber: number) {
  const scene = await VideoSceneModel.findOne({ videoId, sceneNumber });
  if (!scene) throw notFound('Scene');
  if (scene.status === 'completed') throw conflict('Scene already completed');
  if (scene.status === 'generating') throw conflict('Scene is generating');
  scene.status = 'pending';
  scene.error = undefined;
  await scene.save();
  await setVideo(videoId, { status: 'generating_scenes', stage: `retrying scene ${sceneNumber}`, error: null });
  const job = await GenerationJobModel.findOne({ videoId, type: 'generate-scene', sceneNumber }).sort({ createdAt: -1 });
  if (job) return retryJob(String(job._id));
  await enqueuePendingScenes(videoId);
  return null;
}

/**
 * Attaches a user-made clip to a scene (manual provider, or to replace a failed generated scene). The clip is
 * stored like a generated one; once every scene has a clip the render is queued automatically.
 */
export async function uploadSceneClip(videoId: string, sceneNumber: number, file: { path: string; originalName: string }) {
  const video = await VideoAssetModel.findById(videoId);
  if (!video) throw notFound('Video');
  if (!['generating_scenes', 'failed'].includes(video.status) || !video.planHash) throw conflict(`Clips can be uploaded once scenes are planned (video is ${video.status})`);
  const scene = await VideoSceneModel.findOne({ videoId, sceneNumber });
  if (!scene) throw notFound('Scene');
  if (scene.status === 'generating') throw conflict('Scene is being generated');
  const info = await probe(file.path).catch(() => null);
  if (!info?.hasVideo || info.duration < 0.5) throw new AppError('The file is not a playable video clip', 422, 'INVALID_CLIP');
  const key = keys.sceneClip(String(video.sourceId), video.episodeNumber ?? 0, `u${sha256(await fs.readFile(file.path))}`);
  await storage().putFile(key, file.path, { move: true });
  Object.assign(scene, {
    status: 'completed',
    clipPath: key,
    clipDuration: info.duration,
    hasAudio: info.hasAudio,
    cost: 0,
    attempts: scene.attempts + 1,
    providerMeta: { uploaded: true, fileName: file.originalName, uploadedAt: new Date() },
    reusedFrom: undefined,
    error: undefined,
  });
  await scene.save();
  if (video.status === 'failed') await setVideo(video._id, { status: 'generating_scenes', error: null });
  await afterScene(videoId);
  return scene;
}

export async function confirmBudget(videoId: string) {
  const video = await VideoAssetModel.findById(videoId);
  if (!video) throw notFound('Video');
  if (video.status !== 'awaiting_confirmation') throw conflict('Video is not waiting for budget confirmation');
  video.budgetOverride = true;
  await video.save();
  return resumeVideo(videoId);
}

export async function regenerateVideo(videoId: string, opts: { reuseScenes: boolean; settings?: Partial<VideoGenerationSettings> }) {
  const prev = await VideoAssetModel.findById(videoId).lean();
  if (!prev) throw notFound('Video');
  const base = { ...(prev.settings as unknown as VideoGenerationSettings), ...(opts.settings ?? {}) };
  if (!opts.reuseScenes) (base as { variation?: number }).variation = ((prev.settings as { variation?: number })?.variation ?? 0) + 1;
  const settings = await resolveVideoSettings(base);
  const v = await createVideoAsset(prev.episodeId, settings, { idempotencyKey: `regen:${prev._id}:${Date.now()}` });
  await startVideo(v._id);
  return v;
}

/** Deletes one video version's rendered files. Scene clips and narration stay (shared cache). */
export async function deleteVideo(videoId: string) {
  const v = await VideoAssetModel.findById(videoId);
  if (!v) throw notFound('Video');
  if (ACTIVE_VIDEO.includes(v.status)) throw conflict('Video is still being generated; cancel it first');
  await storage().deletePrefix(`projects/${v.sourceId}/episodes/${String(v.episodeNumber ?? 0).padStart(4, '0')}/renders/${v._id}`).catch(() => undefined);
  v.deletedAt = new Date();
  await v.save();
  const newest = await VideoAssetModel.findOne({ episodeId: v.episodeId, deletedAt: null }).sort({ version: -1 }).select('status').lean();
  await EpisodeModel.updateOne({ _id: v.episodeId }, { $set: { videoStatus: newest?.status ?? 'none' } });
}
