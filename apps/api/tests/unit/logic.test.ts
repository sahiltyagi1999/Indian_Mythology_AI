import { describe, expect, it } from 'vitest';
import { pickStyle, structuralIssues } from '../../src/services/story/scripts';
import { findPrice } from '../../src/services/cost/pricing';
import { DEFAULT_PRICING } from '../../src/services/settings';
import { decryptSecret, encryptSecret, maskSecret, stableHash } from '../../src/lib/crypto';
import { chooseModel } from '../../src/providers/llm/gemini';
import { scrubSecrets } from '../../src/config/logger';

describe('narration style selection', () => {
  const scores = [
    { id: 'warrior-battlefield', score: 9 },
    { id: 'fast-dramatic', score: 8.6 },
    { id: 'philosophical', score: 3 },
  ];
  it('picks deterministically among near-ties and avoids repeating the previous style', () => {
    expect(pickStyle(scores, 4, 'warrior-battlefield')).toBe('fast-dramatic');
    expect(pickStyle(scores, 4)).toBe(pickStyle(scores, 4));
    expect(['warrior-battlefield', 'fast-dramatic']).toContain(pickStyle(scores, 7));
  });
  it('never picks a clearly worse style', () => {
    expect(pickStyle([{ id: 'divine-spiritual', score: 9 }, { id: 'philosophical', score: 6 }], 3, 'divine-spiritual')).toBe('divine-spiritual');
  });
});

describe('script structure validation', () => {
  const base = {
    title: 't', summary: 's', hook: 'क्या आप जानते हैं कि भीष्म ने कौन सा वचन दिया था?',
    narrationText: 'क्या आप जानते हैं कि भीष्म ने कौन सा वचन दिया था? कथा... और इस तरह वचन पूरा हुआ। अब जानिए आगे क्या हुआ।',
    ending: 'और इस तरह वचन पूरा हुआ।', nextEpisodeTeaser: 'अब जानिए आगे क्या हुआ।', characters: [], storyArc: { setup: '', conflict: '', climax: '', resolution: '' },
    storyTimeline: '', sceneDescriptions: [], sourceChunkIds: [], uncertaintyNotes: '', highlightWords: [],
  };
  it('accepts a well-formed script', () => expect(structuralIssues(base as any, true)).toEqual([]));
  it('rejects Latin words, markup, missing hook or teaser', () => {
    expect(structuralIssues({ ...base, narrationText: base.narrationText + ' (pause) Bhishma' } as any, true).length).toBeGreaterThanOrEqual(2);
    expect(structuralIssues({ ...base, nextEpisodeTeaser: '' } as any, true)).toContain('a nextEpisodeTeaser is required because there is a next episode');
    expect(structuralIssues({ ...base, hook: 'कोई और शुरुआत' } as any, true)).toContain('narrationText must begin with the hook verbatim');
  });
});

describe('pricing catalog', () => {
  it('applies effective-date ranges (Gemini price change on 2026-12-01)', () => {
    const q = { provider: 'google', model: 'gemini-4-argon', unit: 'input_1m_tokens' };
    expect(findPrice(DEFAULT_PRICING.entries, { ...q, at: new Date('2026-11-15') }).price).toBe(2);
    expect(findPrice(DEFAULT_PRICING.entries, { ...q, at: new Date('2026-12-05') }).price).toBe(4);
  });
  it('resolves video price per resolution variant and reports unknown models', () => {
    expect(findPrice(DEFAULT_PRICING.entries, { provider: 'google', model: 'gemini-omni-1.1-flash', unit: 'second', variant: '720p' }).price).toBeCloseTo(0.1014);
    expect(findPrice(DEFAULT_PRICING.entries, { provider: 'google', model: 'unknown-model', unit: 'second' }).price).toBeNull();
  });
});

describe('secrets', () => {
  it('round-trips AES-GCM and masks', () => {
    const enc = encryptSecret('AIzaSyExampleKey1234567890');
    expect(enc.data).not.toContain('AIza');
    expect(decryptSecret(enc)).toBe('AIzaSyExampleKey1234567890');
    expect(maskSecret('AIzaSyExampleKey1234567890')).toBe('••••••••7890');
  });
  it('scrubs keys from URLs and messages', () => {
    expect(scrubSecrets('GET https://x/files/a:download?alt=media&key=AIzaSyABCDEFGHIJKLMNOPQRSTUV')).not.toContain('AIza');
    expect(scrubSecrets('xi-api-key: sk_0123456789abcdef0123456789abcdef01')).toContain('[redacted]');
  });
  it('scrubs configured key values of any format and Mongo URI passwords', async () => {
    const { registerSecret } = await import('../../src/config/logger');
    registerSecret('AQ.Ab8ExampleNewFormatKey_123');
    expect(scrubSecrets('failed with key AQ.Ab8ExampleNewFormatKey_123 in request')).not.toContain('AQ.Ab8');
    expect(scrubSecrets('connect mongodb+srv://user:p4ss@cluster.example.net/db')).toBe('connect mongodb+srv://user:[redacted]@cluster.example.net/db');
  });
  it('stable hash ignores key order', () => expect(stableHash({ a: 1, b: [2, 3] })).toBe(stableHash({ b: [2, 3], a: 1 })));
});

describe('model auto-selection from live catalog', () => {
  const models = [
    { id: 'gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    { id: 'gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { id: 'gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { id: 'gemini-4-argon', supportedGenerationMethods: ['generateContent'] },
    { id: 'gemini-3-flash-preview', supportedGenerationMethods: ['generateContent'] },
    { id: 'gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
    { id: 'gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
    { id: 'gemini-omni-1.1-flash', supportedGenerationMethods: ['generateContent'] },
  ].map((m) => ({ ...m, name: `models/${m.id}` }));
  it('prefers newest stable flash for text, strongest for analysis, newest embedding', () => {
    expect(chooseModel(models, 'text')).toBe('gemini-3.8-flash');
    expect(chooseModel(models, 'analysis')).toBe('gemini-4-argon');
    expect(chooseModel(models, 'embedding')).toBe('gemini-embedding-2');
  });
});

describe('OpenAI adapter', () => {
  it('picks the newest live model per role family, skipping snapshots, -pro and retired models', async () => {
    const { chooseModel } = await import('../../src/providers/llm/openai');
    const m = (id: string, created = 1, shutdownDate: string | null = null) => ({ id, created, shutdownDate });
    const models = [
      m('gpt-6-astra'), m('gpt-6.1-sol'), m('gpt-6-sol'), m('gpt-6.1-sol-2026-09-01'), m('gpt-6.1-terra'), m('gpt-5.6-terra'),
      m('gpt-6-luna'), m('gpt-5.5-pro'), m('gpt-5-mini', 1, '2026-12-11'), m('text-embedding-3-small'), m('text-embedding-3-large'),
    ];
    const today = new Date('2026-11-02');
    expect(chooseModel(models, 'analysis', today)).toBe('gpt-6.1-sol');
    expect(chooseModel(models, 'text', today)).toBe('gpt-6.1-terra');
    expect(chooseModel(models, 'light', today)).toBe('gpt-6-luna');
    expect(chooseModel(models, 'embedding', today)).toBe('text-embedding-3-small');
    expect(chooseModel([m('gpt-5-mini', 1, '2026-10-01')], 'light', today)).toBeNull();
  });

  it('converts schemas to strict mode (closed objects, all fields required)', async () => {
    const { toStrictSchema } = await import('../../src/providers/llm/openai');
    const { toJsonSchema } = await import('../../src/lib/schema');
    const { z } = await import('zod');
    const s = toStrictSchema(toJsonSchema(z.object({ a: z.string().min(1), b: z.array(z.object({ c: z.number().int().min(1).max(5) })).min(1) }))) as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['a', 'b']);
    expect(s.properties.a.minLength).toBeUndefined();
    expect(s.properties.b.items.additionalProperties).toBe(false);
    expect(s.properties.b.minItems).toBe(1);
    expect(s.properties.b.items.properties.c.maximum).toBe(5);
  });

  it('redacts OpenAI keys and bearer tokens', () => {
    expect(scrubSecrets('Authorization: Bearer sk-proj-abcDEF1234567890abcDEF1234')).not.toContain('abcDEF');
  });
});

describe('pricing catalog migration', () => {
  it('adds new default entries without touching user-edited ones', async () => {
    const { connectMongo } = await import('../../src/db/connection');
    const mongoose = (await import('mongoose')).default;
    await connectMongo(undefined, 'mas_test_unit');
    const { ProviderConfigurationModel } = await import('../../src/models');
    const { ensureDefaultConfigs, getSettings, DEFAULT_PRICING } = await import('../../src/services/settings');
    await ProviderConfigurationModel.deleteMany({});
    const old = DEFAULT_PRICING.entries.filter((e) => e.provider !== 'openai').map((e) => (e.model === 'eleven_v3' ? { ...e, price: 0.123 } : e));
    await ProviderConfigurationModel.create({ key: 'pricing', settings: { ...DEFAULT_PRICING, entries: old } });
    await ensureDefaultConfigs();
    const p = await getSettings('pricing');
    expect(p.entries.find((e) => e.model === 'eleven_v3')!.price).toBe(0.123);
    expect(p.entries.some((e) => e.model === 'gpt-6-luna' && e.unit === 'output_1m_tokens')).toBe(true);
    await ensureDefaultConfigs();
    expect((await getSettings('pricing')).entries.length).toBe(p.entries.length);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
});
