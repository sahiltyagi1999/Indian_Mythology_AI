/**
 * Workflow A (acceptance): upload → extract/OCR → chunk → embed (Qdrant) → outline → approve → scripts
 * → persisted in MongoDB → re-running does not duplicate → approved scripts are protected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import os from 'node:os';
import { startHarness, waitFor, type Harness } from '../helpers/harness';
import { state } from '../helpers/stubProviders';
import { makeEnglishPdf, makeHindiPdf } from '../fixtures/make-pdf';
import { CharacterModel, EpisodeModel, GenerationJobModel, ScriptVersionModel, StoryOutlineModel, StorySourceModel } from '../../src/models';

let h: Harness;
const brokenPdf = path.join(os.tmpdir(), `mas-wfa-${process.pid}.pdf`);
const cleanPdf = path.join(__dirname, '../fixtures/hindi-clean.pdf');

// The whole workflow runs once per text provider; video always uses its own provider.
describe.each(['openai', 'google'] as const)('Workflow A — story generation (%s text provider)', (provider) => {
  let sourceId = '';
  let outlineId = '';
  const callKey = provider === 'openai' ? 'openai:responses' : 'map';
  let callsAtStart = 0;

  beforeAll(async () => {
    makeHindiPdf(brokenPdf);
    h = await startHarness();
    await request(h.app).put('/api/settings/llm').send({ provider }).expect(200);
    callsAtStart = state.calls[callKey] ?? 0;
  });
  afterAll(async () => h?.stop());

  it('routes all text work to the selected provider', async () => {
    const res = await request(h.app).get('/api/settings');
    expect(res.body.settings.llm.provider).toBe(provider);
    expect(res.body.secrets.openai.apiKey.configured).toBe(true);
  });

  it('uploads a PDF and rejects a duplicate upload', async () => {
    const res = await request(h.app).post('/api/sources').field('title', 'महाभारत (परीक्षण)').field('edition', 'Test edition').attach('file', cleanPdf);
    expect(res.status).toBe(201);
    expect(res.body.totalPages).toBe(3);
    sourceId = res.body._id;
    const dup = await request(h.app).post('/api/sources').attach('file', cleanPdf);
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.sourceId).toBe(sourceId);
    const notPdf = await request(h.app).post('/api/sources').attach('file', Buffer.from('hello'), 'fake.pdf');
    expect(notPdf.status).toBe(422);
  });

  it('extracts, chunks and indexes the source', async () => {
    await request(h.app).put('/api/settings/story').send({ chunkChars: 800, chunkOverlapChars: 150 }).expect(200);
    const res = await request(h.app).post(`/api/sources/${sourceId}/process`).send({});
    expect(res.status).toBe(202);
    const again = await request(h.app).post(`/api/sources/${sourceId}/process`).send({});
    expect(again.body.created).toBe(false); // idempotent while queued/running
    const src = await waitFor(async () => {
      const s = await StorySourceModel.findById(sourceId).lean();
      return s?.status === 'indexed' ? s : null;
    }, { label: 'source indexed' });
    expect(src.stats!.chunks).toBeGreaterThan(1);
    expect(src.stats!.embeddedChunks).toBe(src.stats!.chunks);
    const pages = await request(h.app).get(`/api/sources/${sourceId}/pages?from=1&to=3`);
    expect(pages.body.pages[0].text).toContain('आदि पर्व');
    const search = await request(h.app).get(`/api/sources/${sourceId}/search`).query({ q: 'भीष्म प्रतिज्ञा' });
    expect(search.status).toBe(200);
    expect(search.body.results.length).toBeGreaterThan(0);
    expect(search.body.results[0].pageStart).toBeGreaterThanOrEqual(1);
  });

  it('OCRs pages whose text layer is unusable', async () => {
    const res = await request(h.app).post('/api/sources').field('title', 'Broken text layer').attach('file', brokenPdf);
    expect(res.status).toBe(201);
    await request(h.app).post(`/api/sources/${res.body._id}/process`).send({});
    const src = await waitFor(async () => {
      const s = await StorySourceModel.findById(res.body._id).lean();
      return s?.status === 'indexed' ? s : null;
    }, { label: 'broken source indexed' });
    expect(src.stats!.ocrPages).toBe(4); // 3 pages with missing glyphs + 1 image-only page
    expect(state.calls.ocr).toBeGreaterThanOrEqual(4);
  });

  it('detects an English edition uploaded as Hindi and does not OCR it', async () => {
    const enPdf = path.join(os.tmpdir(), `mas-en-${process.pid}.pdf`);
    makeEnglishPdf(enPdf);
    const ocrBefore = state.calls.ocr ?? 0;
    const res = await request(h.app).post('/api/sources').field('title', 'Ganguli excerpt').field('language', 'hi').attach('file', enPdf);
    expect(res.status).toBe(201);
    await request(h.app).post(`/api/sources/${res.body._id}/process`).send({});
    const src = await waitFor(async () => {
      const s = await StorySourceModel.findById(res.body._id).lean();
      return s?.status === 'indexed' ? s : null;
    }, { label: 'english source indexed' });
    expect(src.language).toBe('en');
    expect(src.stats!.ocrPages).toBe(0);
    expect(state.calls.ocr ?? 0).toBe(ocrBefore);
  });

  it('generates a chronological master outline and character database', async () => {
    const res = await request(h.app).post(`/api/sources/${sourceId}/outlines`).send({});
    expect(res.status).toBe(202);
    outlineId = res.body.outline._id;
    const outline = await waitFor(async () => {
      const o = await StoryOutlineModel.findById(outlineId).lean();
      return o?.status === 'draft' ? o : null;
    }, { label: 'outline draft' });
    expect(outline.events.length).toBeGreaterThan(0);
    expect(outline.episodes.length).toBe(outline.events.length);
    expect(outline.episodes.map((e) => e.episodeNumber)).toEqual(outline.episodes.map((_, i) => i + 1));
    const chars = await CharacterModel.find({ sourceId }).lean();
    expect(chars.map((c) => c.name).sort()).toEqual(['Bhishma', 'Shantanu']);
    expect(chars[0]!.variants[0]!.identityPrompt.length).toBeGreaterThan(20);
  });

  it('refuses to generate scripts before the outline is approved', async () => {
    const res = await request(h.app).post(`/api/outlines/${outlineId}/generate-scripts`).send({});
    expect(res.status).toBe(409);
  });

  it('generates, quality-checks and persists every episode script', async () => {
    await request(h.app).post(`/api/outlines/${outlineId}/approve`).expect(200);
    const res = await request(h.app).post(`/api/outlines/${outlineId}/generate-scripts`).send({});
    expect(res.status).toBe(202);
    const total = res.body.total as number;
    expect(res.body.created).toBe(total);
    await waitFor(async () => (await EpisodeModel.countDocuments({ sourceId, status: 'draft' })) === total, { label: 'all scripts drafted', timeout: 90_000 });

    // "Refresh the browser": data comes back from MongoDB through the API.
    const list = await request(h.app).get('/api/episodes').query({ sourceId, pageSize: 100 });
    expect(list.body.total).toBe(total);
    const eps = list.body.items;
    expect(eps.map((e: any) => e.episodeNumber)).toEqual(eps.map((_: unknown, i: number) => i + 1));
    const detail = await request(h.app).get(`/api/episodes/${eps[1]._id}`);
    const ep = detail.body.episode;
    expect(ep.narrationText.startsWith(ep.hook)).toBe(true);
    expect(ep.sourceReferences.length).toBeGreaterThan(0);
    expect(ep.sceneDescriptions.length).toBeGreaterThanOrEqual(7);
    expect(ep.quality.passed).toBe(true);
    expect(Math.abs(ep.estimatedDuration - 55)).toBeLessThanOrEqual(5);
    expect(detail.body.previous.episodeNumber).toBe(1);
    expect(detail.body.next?.episodeNumber ?? null).toBe(total > 2 ? 3 : null);
    expect(await ScriptVersionModel.countDocuments()).toBe(total);
    // Hinglish reading copy saved alongside the Hindi script, one sentence per Hindi sentence.
    const full = await EpisodeModel.findById(ep._id).lean();
    expect(full!.narrationHinglish).toMatch(/^Kya aap jaante hain/);
    expect(full!.narrationHinglish).not.toMatch(/[\u0900-\u097F]/);
    expect(full!.hinglishVersion).toBe(full!.currentVersion);
    expect(full!.titleHinglish).toBe('Bhishma ki katha');
    // The selected provider did the work.
    expect((state.calls[callKey] ?? 0) - callsAtStart).toBeGreaterThan(0);
    const models = await ScriptVersionModel.find().select('embeddingModel').lean();
    expect(models.every((m) => m.embeddingModel === (provider === 'openai' ? 'text-embedding-3-small' : 'gemini-embedding-2'))).toBe(true);
    if (provider === 'openai') {
      // Role-based model choice from the live list: dated snapshots skipped, families matched.
      const { UsageRecordModel } = await import('../../src/models');
      const used = await UsageRecordModel.distinct('model', { provider: 'openai' });
      expect(used.sort()).toEqual(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.1-terra', 'text-embedding-3-small']);
      const priced = await UsageRecordModel.countDocuments({ provider: 'openai', cost: { $gt: 0 } });
      expect(priced).toBeGreaterThan(0);
    }
  });

  it('does not create duplicates when the same operation runs again', async () => {
    const before = { eps: await EpisodeModel.countDocuments(), jobs: await GenerationJobModel.countDocuments(), scripts: state.calls.script };
    const res = await request(h.app).post(`/api/outlines/${outlineId}/generate-scripts`).send({});
    expect(res.body.created).toBe(0);
    expect(res.body.queued).toBe(0);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await EpisodeModel.countDocuments()).toBe(before.eps);
    expect(await GenerationJobModel.countDocuments()).toBe(before.jobs);
    expect(state.calls.script).toBe(before.scripts);
  });

  it('protects approved scripts and versions user edits', async () => {
    const [ep1, ep2] = await EpisodeModel.find({ sourceId }).sort({ episodeNumber: 1 }).limit(2).lean();
    await request(h.app).post(`/api/episodes/${ep1!._id}/approve`).expect(200);
    const regen = await request(h.app).post(`/api/episodes/${ep1!._id}/regenerate`).send({});
    expect(regen.status).toBe(409);
    expect(regen.body.error.code).toBe('CONFIRM_REQUIRED');
    await request(h.app).post(`/api/episodes/${ep1!._id}/lock`).expect(200);
    expect((await request(h.app).patch(`/api/episodes/${ep1!._id}`).send({ narrationText: 'बदलाव' })).status).toBe(409);

    const edited = await request(h.app).patch(`/api/episodes/${ep2!._id}`).send({ narrationText: `${ep2!.narrationText} यह संपादित पंक्ति है।`, changeNote: 'test edit' });
    expect(edited.status).toBe(200);
    expect(edited.body.currentVersion).toBe(2);
    const versions = await ScriptVersionModel.find({ episodeId: ep2!._id }).sort({ version: 1 }).lean();
    expect(versions.map((v) => v.createdBy)).toEqual(['ai', 'user']);
    // Editing the Hindi narration refreshes the Hinglish copy for the new version.
    await waitFor(async () => (await EpisodeModel.findById(ep2!._id).lean())?.hinglishVersion === 2, { label: 'hinglish refreshed' });
    expect((await ScriptVersionModel.findOne({ episodeId: ep2!._id, version: 2 }).lean())!.narrationHinglish).toContain('Kya aap');

    const bulk = await request(h.app).post('/api/episodes/bulk').send({ ids: [String(ep1!._id), String(ep2!._id)], action: 'approve' });
    expect(bulk.body.succeeded).toBe(1); // ep1 is locked, ep2 approves
    const csv = await request(h.app).post('/api/episodes/export').send({ ids: [String(ep2!._id)], format: 'csv' });
    expect(csv.text).toContain('narrationText');
  });

  it('regenerates only on explicit request and keeps history', async () => {
    const ep = await EpisodeModel.findOne({ sourceId, status: 'draft' }).lean();
    if (!ep) return;
    const res = await request(h.app).post(`/api/episodes/${ep._id}/regenerate`).send({ instructions: 'अधिक नाटकीय बनाइए' });
    expect(res.status).toBe(202);
    await waitFor(async () => {
      const e = await EpisodeModel.findById(ep._id).lean();
      return e && e.currentVersion === ep.currentVersion + 1 && e.status === 'draft';
    }, { label: 'regenerated' });
  });
});
