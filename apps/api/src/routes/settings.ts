import { Router } from 'express';
import { z } from 'zod';
import { ah, parse } from './util';
import { describeSecrets, getSettings, setSecret, updateSettings, type SettingsMap } from '../services/settings';
import { AppError } from '../lib/errors';
import * as gemini from '../providers/llm/gemini';
import * as openai from '../providers/llm/openai';
import { textProvider } from '../providers/llm';
import * as eleven from '../providers/tts/elevenlabs';
import { getVideoProvider, listVideoProviders } from '../providers/video/registry';
import { MANUAL_MODEL, MANUAL_PROVIDER_ID } from '../providers/video/manual';
import { OPENAI_IMAGE_PROVIDER_ID, resolveImageModel } from '../providers/video/openaiImage';
import { discoverVideoModels, resolveVideoModel } from '../providers/video/resolve';
import { recordUsage } from '../services/cost/usage';
import { storage } from '../storage';
import { stableHash } from '../lib/crypto';
import { pricingFreshness } from '../services/cost/pricing';
import { systemHealth } from './health';
import { queueHealth } from '../queues';
import { env } from '../config/env';

export const settingsRouter = Router();

const unit = z.number().min(0).max(1);
const PATCH_SCHEMAS: Record<keyof SettingsMap, z.ZodTypeAny> = {
  llm: z.object({ provider: z.enum(['openai', 'google']) }).partial().strict(),
  openai: z
    .object({
      textModel: z.string(),
      analysisModel: z.string(),
      qualityModel: z.string(),
      ocrModel: z.string(),
      lightModel: z.string(),
      embeddingModel: z.string(),
      embeddingDimensions: z.union([z.literal(768), z.literal(1536), z.literal(3072)]),
    })
    .partial()
    .strict(),
  google: z
    .object({
      textModel: z.string(),
      analysisModel: z.string(),
      qualityModel: z.string(),
      ocrModel: z.string(),
      embeddingModel: z.string(),
      embeddingDimensions: z.union([z.literal(768), z.literal(1536), z.literal(3072)]),
      videoProvider: z.string(),
      videoModel: z.string(),
      videoResolution: z.enum(['720p', '1080p']),
    })
    .partial()
    .strict(),
  elevenlabs: z
    .object({
      voiceId: z.string(),
      model: z.string(),
      languageCode: z.string().max(5),
      stability: unit,
      similarityBoost: unit,
      style: unit,
      speed: z.number().min(0.7).max(1.2),
      useSpeakerBoost: z.boolean(),
      outputFormat: z.string(),
    })
    .partial()
    .strict(),
  pricing: z
    .object({
      verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      staleAfterDays: z.number().int().min(1),
      entries: z.array(
        z.object({
          provider: z.string(),
          model: z.string(),
          category: z.enum(['text', 'embedding', 'narration', 'video', 'ocr']),
          unit: z.string(),
          price: z.number().min(0),
          variant: z.string().optional(),
          effectiveFrom: z.string().optional(),
          effectiveTo: z.string().optional(),
          source: z.string(),
          verified: z.boolean(),
          note: z.string().optional(),
        }),
      ),
    })
    .partial()
    .strict(),
  budget: z
    .object({ dailyLimit: z.number().min(0).nullable(), monthlyLimit: z.number().min(0).nullable(), maxCostPerEpisode: z.number().min(0).nullable() })
    .partial()
    .strict(),
  render: z
    .object({
      targetDuration: z.number().min(15).max(180),
      durationTolerance: z.number().min(1).max(30),
      fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
      crf: z.number().int().min(14).max(28),
      preset: z.enum(['ultrafast', 'veryfast', 'fast', 'medium', 'slow']),
      transition: z.enum(['fade', 'fadeblack', 'dissolve', 'smoothleft', 'smoothup', 'circleopen', 'none']),
      transitionDuration: z.number().min(0).max(1.5),
      musicVolume: unit,
      sfxIntensity: unit,
      narrationLoudnessLufs: z.number().min(-24).max(-9),
      logoKey: z.string(),
      logoPosition: z.enum(['top-left', 'top-right']),
      subtitles: z
        .object({
          font: z.string(),
          fontSize: z.number().min(24).max(120),
          textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
          highlightColor: z.string().regex(/^#[0-9a-f]{6}$/i),
          backgroundOpacity: unit,
          positionFromBottom: z.number().min(0.12).max(0.6),
          animation: z.enum(['none', 'pop', 'karaoke', 'fade']),
        })
        .partial(),
      maxSpeedAdjust: z.number().min(0).max(0.15),
    })
    .partial()
    .strict(),
  story: z
    .object({
      chunkChars: z.number().int().min(800).max(12000),
      chunkOverlapChars: z.number().int().min(0).max(3000),
      segmentChars: z.number().int().min(10000).max(400000),
      outlineConcurrency: z.number().int().min(1).max(10),
      planningWindowEvents: z.number().int().min(10).max(200),
      scriptConcurrency: z.number().int().min(1).max(10),
      qualityThreshold: z.number().min(1).max(10),
      maxScriptAttempts: z.number().int().min(1).max(6),
      duplicateSimilarity: z.number().min(0.5).max(0.999),
      ocrEngine: z.enum(['llm', 'gemini', 'tesseract']),
    })
    .partial()
    .strict(),
  storage: z.object({}).strict(),
};

const KEYS = Object.keys(PATCH_SCHEMAS) as (keyof SettingsMap)[];

function assertKey(key: string): asserts key is keyof SettingsMap {
  if (!KEYS.includes(key as keyof SettingsMap)) throw new AppError(`Unknown settings section ${key}`, 404, 'NOT_FOUND');
}

settingsRouter.get(
  '/',
  ah(async (_req, res) => {
    const out: Record<string, unknown> = {};
    for (const key of KEYS) out[key] = await getSettings(key);
    res.json({
      settings: out,
      secrets: { google: await describeSecrets('google'), openai: await describeSecrets('openai'), elevenlabs: await describeSecrets('elevenlabs') },
      pricingFreshness: await pricingFreshness(),
      environment: { mongoDb: env.MONGODB_DB, storageDir: env.STORAGE_DIR, vectorStore: env.VECTOR_STORE, qdrantCollection: env.QDRANT_COLLECTION },
    });
  }),
);

settingsRouter.put(
  '/:key',
  ah(async (req, res) => {
    const key = req.params.key!;
    assertKey(key);
    const patch = parse(PATCH_SCHEMAS[key], req.body);
    res.json({ settings: await updateSettings(key, patch) });
  }),
);

settingsRouter.put(
  '/:key/secrets/:name',
  ah(async (req, res) => {
    const key = req.params.key!;
    if (key !== 'google' && key !== 'elevenlabs' && key !== 'openai') throw new AppError('This provider has no secrets', 404, 'NOT_FOUND');
    const { value } = parse(z.object({ value: z.string().max(500).nullable() }), req.body);
    await setSecret(key, req.params.name!, value);
    res.json({ secrets: await describeSecrets(key) });
  }),
);

settingsRouter.get(
  '/system',
  ah(async (_req, res) => {
    const [health, queues, usage] = await Promise.all([systemHealth(), queueHealth().catch(() => null), storage().usage()]);
    res.json({ ...health, queues, storage: { dir: env.STORAGE_DIR, ...usage } });
  }),
);

// ------------------------------------------------------------- Google
settingsRouter.get(
  '/google/models',
  ah(async (req, res) => {
    const models = await gemini.listModels(req.query.refresh === '1');
    res.json({ models, videoModels: await discoverVideoModels() });
  }),
);

settingsRouter.post(
  '/google/test',
  ah(async (_req, res) => {
    const models = await gemini.listModels(true);
    const roles = ['text', 'analysis', 'quality', 'ocr', 'embedding'] as const;
    const resolved: Record<string, string | null> = {};
    for (const role of roles) resolved[role] = await gemini.resolveModel(role).catch((e: Error) => `unavailable: ${e.message}`);
    let video: Record<string, unknown>;
    try {
      const { provider, model } = await resolveVideoModel();
      const p = getVideoProvider(provider);
      video = { provider, model, ...(await p.checkAvailability(model)), capabilities: await p.getCapabilities(model) };
    } catch (e) {
      video = { available: false, message: (e as Error).message };
    }
    res.json({ ok: true, modelCount: models.length, resolved, video });
  }),
);

settingsRouter.get(
  '/video-providers',
  ah(async (_req, res) => {
    const s = await getSettings('google');
    const providers = await Promise.all(
      listVideoProviders().map(async (p) => {
        const model =
          p.id === MANUAL_PROVIDER_ID ? MANUAL_MODEL : p.id === OPENAI_IMAGE_PROVIDER_ID ? await resolveImageModel().catch(() => '') : s.videoModel;
        return { id: p.id, label: p.label, capabilities: model ? await p.getCapabilities(model) : null };
      }),
    );
    res.json({ providers, selected: { provider: s.videoProvider, model: s.videoModel } });
  }),
);

// ------------------------------------------------------------- OpenAI (text provider)
settingsRouter.get(
  '/openai/models',
  ah(async (req, res) => {
    const models = await openai.listModels(req.query.refresh === '1');
    res.json({ models: models.filter((m) => /^(gpt-|o\d|text-embedding-)/.test(m.id)).sort((a, b) => b.created - a.created) });
  }),
);

settingsRouter.post(
  '/openai/test',
  ah(async (_req, res) => {
    const models = await openai.listModels(true);
    const roles = ['analysis', 'text', 'quality', 'ocr', 'light', 'embedding'] as const;
    const resolved: Record<string, string> = {};
    for (const role of roles) resolved[role] = await openai.resolveModel(role).catch((e: Error) => `unavailable: ${e.message}`);
    res.json({ ok: true, active: (await textProvider()) === 'openai', modelCount: models.length, resolved });
  }),
);

// ------------------------------------------------------------- ElevenLabs
settingsRouter.post(
  '/elevenlabs/test',
  ah(async (_req, res) => {
    const [sub, models] = await Promise.all([eleven.subscription(), eleven.listModels()]);
    const s = await getSettings('elevenlabs');
    res.json({
      ok: true,
      subscription: sub,
      resolvedModel: await eleven.resolveTtsModel(s).catch((e: Error) => `unavailable: ${e.message}`),
      models: models
        .filter((m) => m.can_do_text_to_speech)
        .map((m) => ({ id: m.model_id, name: m.name, hindi: m.languages?.some((l) => l.language_id === s.languageCode), maxChars: m.maximum_text_length_per_request })),
    });
  }),
);

settingsRouter.get(
  '/elevenlabs/voices',
  ah(async (req, res) => {
    res.json({ voices: await eleven.listVoices(typeof req.query.search === 'string' ? req.query.search : undefined) });
  }),
);

settingsRouter.post(
  '/elevenlabs/test-voice',
  ah(async (req, res) => {
    const body = parse(z.object({ text: z.string().min(1).max(300).optional(), voiceId: z.string().optional() }), req.body ?? {});
    const s = await getSettings('elevenlabs');
    const text = body.text ?? 'कुरुक्षेत्र की धरती पर, एक ऐसा युद्ध होने वाला था, जिसे इतिहास कभी नहीं भूलेगा।';
    const voiceId = body.voiceId || s.voiceId;
    const model = await eleven.resolveTtsModel(s);
    const key = `library/voice-tests/${stableHash({ text, voiceId, model, s }).slice(0, 24)}.mp3`;
    const cached = await storage().exists(key);
    if (!cached) {
      const out = await eleven.textToSpeech(text, { voiceId, model, settings: s });
      await storage().put(key, out.audio);
      await recordUsage({ category: 'narration', provider: 'elevenlabs', model, operation: 'tts:test', quantity: out.characters, unit: '1k_characters' });
    }
    res.json({ url: `/api/files/${key}`, model, voiceId, cached });
  }),
);
