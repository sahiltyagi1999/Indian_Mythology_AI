/**
 * Workflow B (batch video production) and Workflow C (failure recovery) against real MongoDB, Redis,
 * BullMQ workers and FFmpeg. Provider HTTP APIs are local stubs (see helpers/stubProviders.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startHarness, waitFor, type Harness } from '../helpers/harness';
import { state } from '../helpers/stubProviders';
import {
  CharacterModel, EpisodeModel, GenerationJobModel, NarrationAssetModel, StoryOutlineModel, StorySourceModel,
  UsageRecordModel, VideoAssetModel, VideoSceneModel,
} from '../../src/models';
import { storage } from '../../src/storage';
import { probe } from '../../src/services/video/ffmpeg';

let h: Harness;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-wfb-'));
const NARRATION =
  'क्या आप जानते हैं कि भीष्म ने ऐसा कौन सा वचन दिया था, जिसने पूरे हस्तिनापुर का भविष्य बदल दिया? राजा शान्तनु उदास थे। देवव्रत निषादराज के पास पहुँचे। वहाँ एक कठोर शर्त रखी गई। देवव्रत ने आजीवन ब्रह्मचर्य की प्रतिज्ञा ली। देवताओं ने पुष्प बरसाए। और इस तरह देवव्रत भीष्म कहलाए। अब जानिए आगे क्या हुआ।';
let episodeIds: string[] = [];

beforeAll(async () => {
  // Provider stand-ins: a 6 s 720×1280 clip with ambience, and a narration track.
  state.videoClipPath = path.join(dir, 'clip.mp4');
  state.ttsAudioPath = path.join(dir, 'tts.mp3');
  state.ttsDuration = 16;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=6', '-f', 'lavfi', '-i', 'anoisesrc=d=6:a=0.05', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', state.videoClipPath]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=180:duration=16', '-c:a', 'libmp3lame', state.ttsAudioPath]);
  h = await startHarness();

  // Seed saved, approved scripts (the Video Engine only ever reads saved scripts).
  const src = await StorySourceModel.create({ title: 'Seed', fileName: 's.pdf', filePath: 'x', fileSize: 1, sha256: 'seed', status: 'outlined' });
  const outline = await StoryOutlineModel.create({ sourceId: src._id, version: 1, status: 'approved' });
  for (let n = 1; n <= 5; n++) {
    const ep = await EpisodeModel.create({
      sourceId: src._id, outlineId: outline._id, episodeNumber: n, title: `भीष्म प्रतिज्ञा ${n}`, slug: `ep-${n}`, narrationText: NARRATION,
      hook: NARRATION.split('?')[0] + '?', narrationStyle: 'vow-and-destiny', characters: ['Shantanu', 'Bhishma'], status: 'approved', currentVersion: 1,
      highlightWords: ['प्रतिज्ञा'],
      sceneDescriptions: [{ sceneNumber: 1, narrationExcerpt: 'x', visual: 'Bhishma takes the vow at the Yamuna', characters: ['Bhishma'], environment: 'riverbank', emotion: 'solemn' }],
    });
    episodeIds.push(String(ep._id));
  }
  const refKey = 'characters/seed/bhishma.png';
  await storage().put(refKey, execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']));
  for (const name of ['Shantanu', 'Bhishma']) {
    await CharacterModel.create({
      sourceId: src._id, name, nameKey: name.toLowerCase(), nameHi: name === 'Bhishma' ? 'भीष्म' : 'शान्तनु',
      variants: [{ key: 'adult', label: `Adult ${name}`, identityPrompt: `${name}, tall regal Kuru prince in white silk`, referenceImages: name === 'Bhishma' ? [refKey] : [] }],
    });
  }
  await request(h.app).put('/api/settings/elevenlabs').send({ voiceId: 'voice-hindi-1' }).expect(200);
  await request(h.app).put('/api/settings/render').send({ preset: 'ultrafast', fps: 24, crf: 28, targetDuration: 16, durationTolerance: 3 }).expect(200);
});
afterAll(async () => h?.stop());

const settings = { visualStyle: 'epic-mythology', resolution: '720p', subtitles: { animation: 'karaoke' } };

describe('Workflow B — batch video generation', () => {
  let batchVideoIds: string[] = [];

  it('estimates cost from configured models and current pricing', async () => {
    const res = await request(h.app).post('/api/batches/estimate').send({ episodeIds, settings, maxConcurrency: 2 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.lines.find((l: any) => l.category === 'video').label).toContain('gemini-omni-1.1-flash');
    expect(res.body.lines.find((l: any) => l.category === 'narration').label).toContain('eleven_multilingual_v2');
    expect(res.body.expectedClips).toBeGreaterThanOrEqual(5 * 6);
    expect(res.body.pricingVerifiedAt).toBe('2026-11-02');
  });

  it('never starts paid generation without explicit confirmation, and enforces budgets', async () => {
    expect((await request(h.app).post('/api/batches').send({ episodeIds, settings })).status).toBe(422);
    await request(h.app).put('/api/settings/budget').send({ dailyLimit: 0.5 }).expect(200);
    const over = await request(h.app).post('/api/batches').send({ episodeIds, settings, confirm: true, idempotencyKey: 'budget-test-1' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('BUDGET_CONFIRMATION_REQUIRED');
    await request(h.app).put('/api/settings/budget').send({ dailyLimit: null }).expect(200);
    expect(await VideoAssetModel.countDocuments()).toBe(0);
  });

  it('runs a confirmed batch of 5 episodes in the background', async () => {
    const res = await request(h.app).post('/api/batches').send({ episodeIds, settings, maxConcurrency: 2, confirm: true, idempotencyKey: 'batch-wfb-0001' });
    expect(res.status).toBe(201);
    expect(res.body.videos).toHaveLength(5);
    batchVideoIds = res.body.videos.map((v: any) => v._id);
    const dup = await request(h.app).post('/api/batches').send({ episodeIds, settings, maxConcurrency: 2, confirm: true, idempotencyKey: 'batch-wfb-0001' });
    expect(dup.body.duplicate).toBe(true);
    expect(await VideoAssetModel.countDocuments()).toBe(5);
    // Concurrency limit honoured right after start.
    expect(await VideoAssetModel.countDocuments({ status: { $in: ['narrating', 'planning', 'generating_scenes', 'rendering'] } })).toBeLessThanOrEqual(2);

    await waitFor(async () => (await VideoAssetModel.countDocuments({ status: 'completed' })) === 5, { timeout: 240_000, interval: 1000, label: 'batch completed' });
    const batch = await request(h.app).get(`/api/batches/${res.body.batch._id}`);
    expect(batch.body.batch.status).toBe('completed');
  }, 300_000);

  it('saves all assets with correct format and metadata (survives a "refresh")', async () => {
    const list = await request(h.app).get('/api/videos');
    expect(list.body.total).toBe(5);
    for (const v of list.body.items) {
      expect(v.resolution).toBe('1080x1920');
      expect(v.duration).toBeGreaterThan(15);
      expect(v.duration).toBeLessThan(18);
      for (const key of [v.videoPath, v.thumbnailPath, v.subtitlePaths.srt, v.subtitlePaths.ass, v.audioPath]) expect(await storage().exists(key)).toBe(true);
      const info = await probe(await storage().localPath(v.videoPath));
      expect(info.hasAudio && info.hasVideo).toBe(true);
      expect(info.fps).toBe(24);
    }
    const srt = (await storage().get(list.body.items[0].subtitlePaths.srt)).toString();
    expect(srt).toContain('भीष्म');
    const ranged = await request(h.app).get(`/api/files/${list.body.items[0].videoPath}`).set('Range', 'bytes=0-1023');
    expect(ranged.status).toBe(206);
    // Same script + voice + settings → narration generated once and reused.
    expect(await NarrationAssetModel.countDocuments()).toBe(1);
    expect(state.calls.tts).toBe(1);
    // Identical scene prompts across episodes are cached, so far fewer provider calls than 5 × scenes.
    const sceneTotal = await VideoSceneModel.countDocuments();
    expect(state.sceneCalls).toBeLessThan(sceneTotal);
    expect(await VideoSceneModel.countDocuments({ referenceImages: { $ne: [] } })).toBeGreaterThan(0);
    const usage = await UsageRecordModel.aggregate([{ $group: { _id: '$category', cost: { $sum: '$cost' } } }]);
    expect(usage.find((u) => u._id === 'video')?.cost).toBeGreaterThan(0);
    expect(usage.find((u) => u._id === 'narration')?.cost).toBeGreaterThan(0);
    const ep = await EpisodeModel.findById(episodeIds[0]).lean();
    expect(ep?.videoStatus).toBe('completed');
    expect(ep?.actualAudioDuration).toBeCloseTo(16, 0);
  });

  it('Workflow C — a failed scene is retried alone; successful scenes are reused; render resumes', async () => {
    const original = await VideoAssetModel.findOne({ episodeId: episodeIds[0] }).lean();
    state.failScenes = new Set([3]);
    const before = state.sceneCalls;
    const regen = await request(h.app).post(`/api/videos/${original!._id}/regenerate`).send({ reuseScenes: false });
    expect(regen.status).toBe(201);
    const vid = regen.body.video._id;
    expect(regen.body.video.version).toBe(2);

    const failed = await waitFor(async () => {
      const v = await VideoAssetModel.findById(vid).lean();
      return v?.status === 'failed' ? v : null;
    }, { timeout: 120_000, label: 'video failed on scene 3' });
    expect(failed.stage).toContain('scene 3');
    const scenes = await VideoSceneModel.find({ videoId: vid }).sort({ sceneNumber: 1 }).lean();
    expect(scenes.find((s) => s.sceneNumber === 3)!.status).toBe('failed');
    await waitFor(async () => (await VideoSceneModel.countDocuments({ videoId: vid, status: 'generating' })) === 0, { label: 'other scenes settled' });
    const completedBefore = (await VideoSceneModel.find({ videoId: vid, status: 'completed' }).lean()).map((s) => [s.sceneNumber, s.clipPath]);
    expect(completedBefore.length).toBe(scenes.length - 1);
    const callsAfterFailure = state.sceneCalls;
    expect(callsAfterFailure - before).toBe(scenes.length);

    state.failScenes.clear();
    const retry = await request(h.app).post(`/api/videos/${vid}/scenes/3/retry`).send({});
    expect(retry.status).toBe(202);
    await waitFor(async () => (await VideoAssetModel.findById(vid).lean())?.status === 'completed', { timeout: 120_000, label: 'video completed after retry' });
    expect(state.sceneCalls - callsAfterFailure).toBe(1); // only scene 3 regenerated
    const after = (await VideoSceneModel.find({ videoId: vid, sceneNumber: { $ne: 3 } }).lean()).map((s) => [s.sceneNumber, s.clipPath]);
    expect(after.sort()).toEqual(completedBefore.sort());
    expect(await GenerationJobModel.countDocuments({ videoId: vid, type: 'render-video' })).toBe(1);
    expect(await GenerationJobModel.countDocuments({ videoId: vid, type: 'generate-scene', sceneNumber: 3 })).toBe(1);

    // The previous successful version is untouched.
    const v1 = await VideoAssetModel.findById(original!._id).lean();
    expect(v1!.status).toBe('completed');
    expect(await storage().exists(v1!.videoPath!)).toBe(true);
  }, 300_000);

  it('regenerating with unchanged visuals reuses every cached scene and creates a new version', async () => {
    const original = await VideoAssetModel.findOne({ episodeId: episodeIds[1] }).lean();
    const before = state.sceneCalls;
    const res = await request(h.app).post(`/api/videos/${original!._id}/regenerate`).send({ reuseScenes: true });
    const vid = res.body.video._id;
    await waitFor(async () => (await VideoAssetModel.findById(vid).lean())?.status === 'completed', { timeout: 120_000, label: 'cached regen' });
    expect(state.sceneCalls).toBe(before);
    expect(await VideoSceneModel.countDocuments({ videoId: vid, reusedFrom: { $exists: true } })).toBeGreaterThan(0);
    expect(await VideoAssetModel.countDocuments({ episodeId: episodeIds[1] })).toBe(2);
  }, 180_000);

  it('manual clips: nothing is generated, uploads complete the scenes and the render starts by itself', async () => {
    const est = await request(h.app).post('/api/batches/estimate').send({ episodeIds: [episodeIds[3]], settings: { ...settings, videoProvider: 'manual' } });
    expect(est.body.lines.find((l: any) => l.category === 'video').amount).toBe(0);
    const res = await request(h.app)
      .post('/api/batches')
      .send({ episodeIds: [episodeIds[3]], settings: { ...settings, videoProvider: 'manual' }, confirm: true, idempotencyKey: 'batch-manual-0001' });
    expect(res.status).toBe(201);
    const vid = res.body.videos[0]._id;
    const planned = await waitFor(async () => {
      const v = await VideoAssetModel.findById(vid).lean();
      return v?.status === 'generating_scenes' ? v : null;
    }, { label: 'manual scenes planned' });
    expect(planned.model).toBe('manual');
    expect(planned.stage).toContain('uploaded clips');
    const scenes = await VideoSceneModel.find({ videoId: vid }).sort({ sceneNumber: 1 }).lean();
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.every((s) => s.status === 'pending')).toBe(true);
    expect(await GenerationJobModel.countDocuments({ videoId: vid, type: 'generate-scene' })).toBe(0);

    const bad = await request(h.app).post(`/api/videos/${vid}/scenes/1/clip`).attach('file', Buffer.from('not a video'), 'fake.mp4');
    expect(bad.status).toBe(422);
    // Scene 1 gets a still image (made into a zoom clip as long as the scene), the rest get video clips.
    const still = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=576x1024', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
    const img = await request(h.app).post(`/api/videos/${vid}/scenes/1/clip`).attach('file', still, { filename: 'scene1.png', contentType: 'image/png' });
    expect(img.status).toBe(200);
    expect(img.body.scene.providerMeta.kind).toBe('image');
    const stillInfo = await probe(await storage().localPath(img.body.scene.clipPath));
    expect([stillInfo.width, stillInfo.height]).toEqual([1080, 1920]);
    expect(stillInfo.duration).toBeGreaterThanOrEqual(scenes[0]!.duration!);
    expect(stillInfo.fps).toBe(24);
    expect(img.body.scene.stillPath).toMatch(/\.png$/);
    for (const s of scenes.slice(1)) await request(h.app).post(`/api/videos/${vid}/scenes/${s.sceneNumber}/clip`).attach('file', state.videoClipPath!).expect(200);

    const done = await waitFor(async () => {
      const v = await VideoAssetModel.findById(vid).lean();
      return v?.status === 'completed' ? v : null;
    }, { timeout: 120_000, label: 'manual video rendered' });
    expect(await storage().exists(done.videoPath!)).toBe(true);
    expect(await UsageRecordModel.countDocuments({ videoId: vid, category: 'video' })).toBe(0);
    const uploaded = await VideoSceneModel.findOne({ videoId: vid, sceneNumber: 1 }).lean();
    expect((uploaded!.providerMeta as any).uploaded).toBe(true);
  }, 180_000);

  it('OpenAI images: one still per scene, priced per image, rendered automatically', async () => {
    const imgSettings = { ...settings, videoProvider: 'openai-image', imageQuality: 'low' };
    const est = await request(h.app).post('/api/batches/estimate').send({ episodeIds: [episodeIds[2]], settings: imgSettings });
    const line = est.body.lines.find((l: any) => l.category === 'video');
    expect(line.label).toContain('gpt-image-2');
    expect(line.unit).toBe('images');
    expect(line.amount).toBeGreaterThan(0);
    expect(line.amount).toBeLessThan(0.1);

    state.imageRequests = [];
    const res = await request(h.app).post('/api/batches').send({ episodeIds: [episodeIds[2]], settings: imgSettings, confirm: true, idempotencyKey: 'batch-oai-img-0001' });
    expect(res.status).toBe(201);
    const vid = res.body.videos[0]._id;
    const done = await waitFor(async () => {
      const v = await VideoAssetModel.findById(vid).lean();
      if (v?.status === 'failed') throw new Error(`video failed: ${v.error}`);
      return v?.status === 'completed' ? v : null;
    }, { timeout: 180_000, interval: 1000, label: 'image video rendered' });

    expect(done.model).toBe('gpt-image-2');
    const scenes = await VideoSceneModel.find({ videoId: vid }).lean();
    expect(state.imageRequests).toHaveLength(scenes.length);
    expect(state.imageRequests!.every((r) => r.model === 'gpt-image-2' && r.quality === 'low' && r.size === '1024x1536')).toBe(true);
    expect(state.imageRequests![0]!.prompt).not.toContain('Camera:');
    const usage = await UsageRecordModel.find({ videoId: vid, category: 'video' }).lean();
    expect(usage).toHaveLength(scenes.length);
    expect(usage.every((u) => u.provider === 'openai' && u.pricingSource === 'catalog' && u.cost > 0)).toBe(true);
    const clip = await probe(await storage().localPath(scenes[0]!.clipPath!));
    expect([clip.width, clip.height]).toEqual([1080, 1920]);
    // Animated at the render frame rate (24 in this suite) and long enough that the renderer never stretches it.
    expect(clip.fps).toBe(24);
    expect(clip.duration).toBeGreaterThan(scenes[0]!.duration!);
    expect(scenes.every((s) => s.stillPath && s.stillPath.endsWith('.png'))).toBe(true);
    expect(await storage().exists(scenes[0]!.stillPath!)).toBe(true);
    expect(await storage().exists(done.videoPath!)).toBe(true);
  }, 240_000);

  it('editing an approved script invalidates narration but keeps old videos', async () => {
    const ep = await EpisodeModel.findById(episodeIds[4]).lean();
    await request(h.app).patch(`/api/episodes/${ep!._id}`).send({ narrationText: `${ep!.narrationText} नई पंक्ति।` }).expect(200);
    const after = await EpisodeModel.findById(ep!._id).lean();
    expect(after!.status).toBe('draft');
    expect(after!.videoStatus).toBe('none');
    const v = await VideoAssetModel.findOne({ episodeId: ep!._id }).lean();
    expect(v!.warnings.join(' ')).toContain('Script was edited');
    expect(await storage().exists(v!.videoPath!)).toBe(true);
  });
});
