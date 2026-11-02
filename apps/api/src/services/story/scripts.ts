import { z } from 'zod';
import mongoose from 'mongoose';
import {
  NARRATION_STYLES,
  PROTECTED_EPISODE_STATUSES,
  countWords,
  estimateSpokenSeconds,
  slugify,
  type EpisodeStatus,
} from '@mas/shared';
import { EpisodeModel, NarrationAssetModel, ScriptVersionModel, StoryOutlineModel, StorySourceModel, VideoAssetModel } from '../../models';
import { embedTexts, generateJson } from '../../providers/llm';
import { toJsonSchema } from '../../lib/schema';
import { sha256 } from '../../lib/crypto';
import { AppError, conflict, notFound } from '../../lib/errors';
import { getSettings } from '../settings';
import { enqueueJob } from '../jobs';
import { chunksByIds, formatPassages, semanticSearch, type RetrievedChunk } from './retrieval';
import { findCharacters } from './characters';
import type { JobContext } from '../../workers/runtime';

// ------------------------------------------------------------------ episode materialisation

/** Creates Episode records from an approved outline (idempotent) and queues script generation for pending ones. */
export async function materializeEpisodes(outlineId: string, opts: { from?: number; to?: number; limit?: number } = {}) {
  const outline = await StoryOutlineModel.findById(outlineId);
  if (!outline) throw notFound('Outline');
  if (outline.status !== 'approved') throw conflict('Approve the outline before generating scripts');
  const plan = outline.episodes.filter((e) => (!opts.from || e.episodeNumber! >= opts.from) && (!opts.to || e.episodeNumber! <= opts.to));
  const selected = opts.limit ? plan.slice(0, opts.limit) : plan;
  let created = 0;
  for (const p of selected) {
    const res = await EpisodeModel.updateOne(
      { sourceId: outline.sourceId, episodeNumber: p.episodeNumber },
      {
        $setOnInsert: {
          sourceId: outline.sourceId,
          outlineId: outline._id,
          episodeNumber: p.episodeNumber,
          title: p.title,
          slug: `${String(p.episodeNumber).padStart(3, '0')}-${slugify(p.title ?? '')}`,
          summary: p.synopsis,
          characters: p.characters,
          status: 'pending',
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount) created++;
    else {
      // Pending episodes follow the latest approved outline; anything already written is left untouched.
      await EpisodeModel.updateOne(
        { sourceId: outline.sourceId, episodeNumber: p.episodeNumber, status: 'pending' },
        { $set: { outlineId: outline._id, title: p.title, summary: p.synopsis, characters: p.characters } },
      );
    }
  }
  await relinkEpisodes(String(outline.sourceId));
  const pending = await EpisodeModel.find({
    sourceId: outline.sourceId,
    episodeNumber: { $in: selected.map((p) => p.episodeNumber) },
    status: 'pending',
  })
    .sort({ episodeNumber: 1 })
    .lean();
  for (const ep of pending) await enqueueScriptJob(ep._id, ep.episodeNumber, ep.sourceId);
  return { created, queued: pending.length, total: selected.length };
}

export async function relinkEpisodes(sourceId: string) {
  const eps = await EpisodeModel.find({ sourceId }).select('_id episodeNumber').sort({ episodeNumber: 1 }).lean();
  const ops = eps.map((e, i) => ({
    updateOne: { filter: { _id: e._id }, update: { $set: { previousEpisodeId: eps[i - 1]?._id ?? null, nextEpisodeId: eps[i + 1]?._id ?? null } } },
  }));
  if (ops.length) await EpisodeModel.bulkWrite(ops);
}

async function enqueueScriptJob(episodeId: unknown, episodeNumber: number, sourceId: unknown, generation = 0) {
  return enqueueJob({
    queue: 'script',
    type: 'generate-script',
    idempotencyKey: `script:${episodeId}:gen${generation}`,
    episodeId: episodeId as mongoose.Types.ObjectId,
    episodeNumber,
    sourceId: sourceId as mongoose.Types.ObjectId,
    maxAttempts: 4,
  });
}

/** Explicit, user-requested regeneration. Approved/locked scripts require `confirmProtected`. */
export async function requestRegeneration(episodeId: string, opts: { confirmProtected?: boolean; instructions?: string }) {
  const ep = await EpisodeModel.findById(episodeId);
  if (!ep) throw notFound('Episode');
  if (ep.status === 'locked') throw conflict('Episode is locked. Unlock it before regenerating.');
  if (ep.status === 'approved' && !opts.confirmProtected) throw new AppError('Episode is approved; confirm to regenerate', 409, 'CONFIRM_REQUIRED');
  if (ep.status === 'generating') throw conflict('Generation already in progress');
  const generation = (await ScriptVersionModel.countDocuments({ episodeId: ep._id, createdBy: 'ai' })) + 1;
  ep.regenerationRequestedAt = new Date();
  await ep.save();
  return enqueueJob({
    queue: 'script',
    type: 'generate-script',
    idempotencyKey: `script:${ep._id}:gen${generation}`,
    episodeId: ep._id,
    episodeNumber: ep.episodeNumber,
    sourceId: ep.sourceId,
    payload: { instructions: opts.instructions ?? '' },
    maxAttempts: 4,
  });
}

// ------------------------------------------------------------------ style selection

const styleScoreSchema = z.object({
  scores: z.array(z.object({ id: z.string(), score: z.number().min(0).max(10), reason: z.string() })),
});

/** Deterministic tie-break among equally suitable styles: avoids repeating the previous episode's style. */
export function pickStyle(scores: { id: string; score: number }[], episodeNumber: number, previousStyle?: string): string {
  const valid = scores.filter((s) => NARRATION_STYLES.some((n) => n.id === s.id)).sort((a, b) => b.score - a.score);
  if (!valid.length) return NARRATION_STYLES[0]!.id;
  const top = valid[0]!.score;
  let candidates = valid.filter((s) => top - s.score <= 0.75);
  if (candidates.length > 1 && previousStyle) {
    const filtered = candidates.filter((c) => c.id !== previousStyle);
    if (filtered.length) candidates = filtered;
  }
  return candidates[episodeNumber % candidates.length]!.id;
}

async function selectStyle(ctx: JobContext, synopsis: string, title: string, episodeNumber: number, previousStyle?: string) {
  const { data } = await generateJson({
    role: 'light',
    operation: 'script:style',
    system: 'You match story beats to narration styles for a Hindi Mahabharata audio series. Score how well each style fits the actual emotional content of the beat.',
    prompt: `Episode ${episodeNumber}: ${title}\n${synopsis}\n\nStyles:\n${NARRATION_STYLES.map((s) => `${s.id}: ${s.description} Best for: ${s.recommendedFor.join(', ')}`).join('\n')}\n\nScore every style 0–10.`,
    jsonSchema: toJsonSchema(styleScoreSchema),
    validator: styleScoreSchema,
    maxOutputTokens: 2048,
    usage: ctx.usage,
  });
  const id = pickStyle(data.scores, episodeNumber, previousStyle);
  return { id, reason: data.scores.find((s) => s.id === id)?.reason ?? '' };
}

// ------------------------------------------------------------------ generation

const scriptSchema = z.object({
  title: z.string(),
  summary: z.string().describe('1–2 sentence Hindi summary'),
  hook: z.string().describe('The opening line(s), spoken in the first 2–3 seconds; must appear verbatim at the start of narrationText'),
  narrationText: z.string().describe('The complete spoken Hindi narration from hook to teaser'),
  ending: z.string().describe('The sentence(s) that close this episode’s event; must appear verbatim in narrationText'),
  nextEpisodeTeaser: z.string().describe('Final line pointing to the next episode; must be the end of narrationText; empty for the final episode'),
  characters: z.array(z.string()).describe('Canonical English names of characters in this episode'),
  storyArc: z.object({ setup: z.string(), conflict: z.string(), climax: z.string(), resolution: z.string() }),
  storyTimeline: z.string().describe('Where this sits in the story timeline, e.g. "After the dice game, start of exile"'),
  sceneDescriptions: z
    .array(
      z.object({
        sceneNumber: z.number().int(),
        narrationExcerpt: z.string().describe('The exact narration sentence(s) this scene illustrates'),
        visual: z.string().describe('Concrete English visual description of what is on screen'),
        characters: z.array(z.string()),
        environment: z.string(),
        emotion: z.string(),
      }),
    )
    .min(6)
    .max(10),
  sourceChunkIds: z.array(z.string()).describe('Ids of the passages actually used'),
  uncertaintyNotes: z.string().describe('Where the source is ambiguous or traditions differ and how the script handles it; empty if none'),
  highlightWords: z.array(z.string()).describe('3–8 key Hindi words from the narration worth emphasising in subtitles'),
});
type GeneratedScript = z.infer<typeof scriptSchema>;

const qualitySchema = z.object({
  storyAccuracy: z.number().min(1).max(10),
  sourceConsistency: z.number().min(1).max(10),
  chronologicalContinuity: z.number().min(1).max(10),
  hookQuality: z.number().min(1).max(10),
  narrationNaturalness: z.number().min(1).max(10),
  endingQuality: z.number().min(1).max(10),
  nonRepetition: z.number().min(1).max(10),
  characterConsistency: z.number().min(1).max(10),
  criticalIssues: z.array(z.string()).describe('Invented events, factual errors versus the passages, misattributed actions, fake cliffhangers'),
  issues: z.array(z.string()).describe('Other concrete, actionable improvements'),
});

const WRITER_SYSTEM = `You are an award-winning Hindi storyteller writing narration for YouTube Shorts / Instagram Reels that retell the Mahabharata episode by episode, in chronological order.

Non-negotiable rules:
0. SOURCE LANGUAGE: The passages may be in English (e.g. a translated edition) or Hindi/Sanskrit. Always write the narration in Hindi, retelling the facts faithfully — never copy English sentences, and use the traditional Hindi forms of names and places (भीष्म, अर्जुन, हस्तिनापुर), not English spellings.
1. FACTS: Use only what the provided source passages say. Do not invent events, dialogue, motives or names. If passages are ambiguous or traditions differ, narrate the version in the passages and note the uncertainty in uncertaintyNotes (and, if important, say "कहा जाता है" in narration).
2. LANGUAGE: Natural, spoken, majestic Hindi (Devanagari). Simple vocabulary that a modern Hindi speaker understands instantly; avoid heavy Sanskrit except names and essential terms. Write numbers as words. No English words, no emojis, no stage directions, no brackets.
3. TTS-FRIENDLY: Short and medium sentences. Use commas, "—" and "..." for natural pauses and "।" to end sentences. Avoid long compound words and tongue-twisters.
4. STRUCTURE: A gripping hook in the first 2–3 seconds (a question, a startling fact, or a stake — never a generic "आज हम जानेंगे"). Then a complete arc (setup → conflict → climax → resolution) for THIS episode's event. Then a natural ending that completes the event. Then, if there is a next episode, one teaser line that leads to its actual event. Only use a cliffhanger if the source supports it; never fake one.
5. LENGTH: The whole narrationText must be speakable in about the target duration.
6. VISUALS: Scene descriptions must depict the specific narrated events (who, where, what action), never generic filler.`;

function normalizeSpace(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

export function structuralIssues(s: GeneratedScript, hasNext: boolean): string[] {
  const issues: string[] = [];
  const n = normalizeSpace(s.narrationText);
  if (!n.startsWith(normalizeSpace(s.hook).slice(0, Math.min(25, s.hook.length)))) issues.push('narrationText must begin with the hook verbatim');
  if (!n.includes(normalizeSpace(s.ending).slice(0, 30))) issues.push('the ending sentence must appear verbatim in narrationText');
  if (hasNext && !s.nextEpisodeTeaser.trim()) issues.push('a nextEpisodeTeaser is required because there is a next episode');
  if (s.nextEpisodeTeaser && !n.endsWith(normalizeSpace(s.nextEpisodeTeaser).slice(-20))) issues.push('narrationText must end with the nextEpisodeTeaser');
  if (/[A-Za-z]{3,}/.test(s.narrationText)) issues.push('narrationText contains Latin-script words; write everything in Devanagari');
  if (/[\[\]()*#]/.test(s.narrationText)) issues.push('narrationText contains brackets or markup; it must be pure spoken text');
  return issues;
}

function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i]! * b[i]!;
  return s;
}

export async function generateScript(ctx: JobContext) {
  const episode = await EpisodeModel.findById(ctx.job.episodeId);
  if (!episode) throw Object.assign(new Error('Episode not found'), { permanent: true });
  const explicit = !!episode.regenerationRequestedAt;
  if (PROTECTED_EPISODE_STATUSES.includes(episode.status as EpisodeStatus) && !explicit) {
    await ctx.log(`Episode is ${episode.status}; automatic regeneration is disabled. Skipping.`, 'warn');
    return;
  }
  if (episode.currentVersion > 0 && !explicit) {
    await ctx.log('Script already exists for this episode; skipping (use Regenerate to create a new version).');
    return;
  }

  const [outline, source, story, render] = await Promise.all([
    StoryOutlineModel.findById(episode.outlineId).lean(),
    StorySourceModel.findById(episode.sourceId).lean(),
    getSettings('story'),
    getSettings('render'),
  ]);
  if (!outline || !source) throw Object.assign(new Error('Outline or source missing'), { permanent: true });
  const priorStatus = episode.status;
  await EpisodeModel.updateOne({ _id: episode._id }, { $set: { status: 'generating' } });

  try {
    const plan = outline.episodes.find((e) => e.episodeNumber === episode.episodeNumber);
    const nextPlan = outline.episodes.find((e) => e.episodeNumber === episode.episodeNumber + 1);
    const events = outline.events.filter((e) => plan?.eventIds?.includes(e.eventId));
    const prevEp = await EpisodeModel.findOne({ sourceId: episode.sourceId, episodeNumber: episode.episodeNumber - 1 }).lean();
    const prevPrevEp = await EpisodeModel.findOne({ sourceId: episode.sourceId, episodeNumber: episode.episodeNumber - 2 }).select('title narrationText').lean();

    // ---- retrieval: passages cited by the outline events + semantic neighbours in the same page window
    await ctx.progress('retrieving source passages', 5);
    const cited = await chunksByIds([...new Set(events.flatMap((e) => e.chunkIds ?? []))]);
    let similar: RetrievedChunk[] = [];
    try {
      // Query in the source's language: outline synopses/summaries are English, titles are Hindi.
      const query =
        source.language === 'en'
          ? [plan?.synopsis ?? episode.summary, ...events.map((e) => e.summary)].filter(Boolean).join(' ')
          : `${episode.title}. ${plan?.synopsis ?? episode.summary}`;
      similar = await semanticSearch(String(episode.sourceId), query, {
        limit: 6,
        pageFrom: Math.max(1, (plan?.pageStart ?? 1) - 10),
        pageTo: (plan?.pageEnd ?? 1) + 10,
        usage: ctx.usage,
      });
    } catch (err) {
      await ctx.log(`Semantic retrieval unavailable, using cited passages only: ${(err as Error).message}`, 'warn');
    }
    const passages = [...cited, ...similar.filter((s) => !cited.some((c) => c.id === s.id))];
    if (!passages.length) throw Object.assign(new Error('No source passages found for this episode'), { permanent: true });
    const passageText = formatPassages(passages, 26_000);
    const validIds = new Set(passages.map((p) => p.id));

    const chars = await findCharacters(String(episode.sourceId), plan?.characters ?? episode.characters);

    // ---- style
    await ctx.progress('selecting narration style', 12);
    let styleId = episode.styleOverride;
    let styleReason = 'User override';
    if (!styleId) {
      const sel = await selectStyle(ctx, plan?.synopsis ?? episode.summary, episode.title, episode.episodeNumber, prevEp?.narrationStyle);
      styleId = sel.id;
      styleReason = sel.reason;
    }
    const style = NARRATION_STYLES.find((s) => s.id === styleId) ?? NARRATION_STYLES[0]!;

    const target = render.targetDuration;
    const tol = render.durationTolerance;
    const sps = story.syllablesPerSecond;
    // Word budget derived from the same model as estimateSpokenSeconds (~2.2 aksharas per Hindi word plus
    // punctuation pauses), so a draft written to the budget also passes the duration check. The budget sits
    // in the lower half of the window because drafts tend to overshoot the requested length.
    const secondsPerWord = 2.2 / sps + 0.05;
    const wordsLow = Math.round((target - tol) / secondsPerWord);
    const wordsHigh = Math.round(target / secondsPerWord);

    const otherEps = await EpisodeModel.find({ sourceId: episode.sourceId, _id: { $ne: episode._id }, currentVersion: { $gt: 0 } }).select('_id currentVersion').lean();
    const otherVectors = await ScriptVersionModel.find({ $or: otherEps.map((e) => ({ episodeId: e._id, version: e.currentVersion })) })
      .select('+embedding episodeId embeddingModel')
      .lean()
      .then((rows) => rows.filter((r: any) => r.embedding?.length))
      .catch(() => [] as any[]);

    let feedback = (ctx.payload.instructions as string) ? `\n\nEditor instructions for this regeneration: ${ctx.payload.instructions}` : '';
    let embeddingModel: string | undefined;
    let best: { script: GeneratedScript; quality: any; overall: number; duration: number; embedding?: number[]; passed: boolean } | null = null;

    for (let attempt = 1; attempt <= story.maxScriptAttempts; attempt++) {
      await ctx.checkCancelled();
      await ctx.progress(`writing script (attempt ${attempt})`, 15 + (attempt - 1) * 25);
      const { data: script, model } = await generateJson({
        role: 'text',
        operation: 'script:write',
        system: WRITER_SYSTEM,
        prompt: `SOURCE EDITION: ${source.title}${source.edition ? ` (${source.edition})` : ''}
SOURCE LANGUAGE: ${({ en: 'English', hi: 'Hindi', sa: 'Sanskrit' } as Record<string, string>)[source.language] ?? source.language} — narration must be in Hindi.

EPISODE ${episode.episodeNumber}: ${episode.title}
Plan: ${plan?.synopsis ?? episode.summary}
Timeline context: ${events.map((e) => `${e.title} (pp. ${e.pageStart}-${e.pageEnd}, ${e.certainty}${e.notes ? `; ${e.notes}` : ''})`).join(' · ')}

PREVIOUS EPISODE: ${prevEp ? `#${prevEp.episodeNumber} ${prevEp.title} — ${prevEp.summary}${prevEp.nextEpisodeTeaser ? `\nIts teaser promised: "${prevEp.nextEpisodeTeaser}"` : ''}` : 'None — this is the opening episode.'}
NEXT EPISODE: ${nextPlan ? `#${nextPlan.episodeNumber} ${nextPlan.title} — ${nextPlan.synopsis}` : 'None — this is the final planned episode.'}

NARRATION STYLE: ${style.name} — ${style.description}
Voice: ${style.voice}. Pacing: ${style.pacing}. Intensity ${style.intensity}/5.
Guidance: ${style.writingGuidance}

CHARACTER NAMES (use these Hindi forms): ${chars.map((c) => `${c.name} = ${c.nameHi ?? c.name}`).join(', ') || 'use standard Hindi names'}

TARGET: about ${target} seconds of spoken Hindi — roughly ${wordsLow}–${wordsHigh} words in narrationText, hard maximum ${wordsHigh}; count them before answering. 7–9 scene descriptions.

SOURCE PASSAGES (cite ids in sourceChunkIds):
${passageText}${feedback}`,
        jsonSchema: toJsonSchema(scriptSchema),
        validator: scriptSchema,
        temperature: 0.8,
        maxOutputTokens: 8192,
        usage: ctx.usage,
      });

      const duration = estimateSpokenSeconds(script.narrationText, sps);
      const durationOk = Math.abs(duration - target) <= tol;
      const structural = structuralIssues(script, !!nextPlan);
      script.sourceChunkIds = script.sourceChunkIds.filter((id) => validIds.has(id));
      if (!script.sourceChunkIds.length) script.sourceChunkIds = cited.slice(0, 3).map((c) => c.id);

      // Length is checked locally: a draft outside the window is rewritten before paying for evaluation.
      // The last attempt is always evaluated so there is a scored draft to save.
      if (!durationOk && attempt < story.maxScriptAttempts) {
        const delta = duration - target;
        await ctx.log(`Attempt ${attempt}: est. ${duration}s outside ${target}±${tol}s; rewriting before evaluation [${model}]`);
        feedback = `\n\nREVISION REQUIRED. Length: the draft has ${countWords(script.narrationText)} words, about ${Math.abs(Math.round(delta))} seconds too ${delta > 0 ? 'long — cut' : 'short — add'} roughly ${Math.abs(Math.round(delta / secondsPerWord))} words (aim for ${Math.round(target / secondsPerWord)}). Keep the facts, hook and ending.\nPrevious draft narration:\n${script.narrationText}`;
        continue;
      }

      // ---- duplicate detection
      let embedding: number[] | undefined;
      let duplicateOf: number | null = null;
      try {
        const emb = await embedTexts([script.narrationText], 'document', { usage: ctx.usage });
        embedding = emb.vectors[0];
        embeddingModel = emb.model;
        // Vectors from different embedding models are not comparable.
        for (const o of (otherVectors as any[]).filter((v) => !v.embeddingModel || v.embeddingModel === emb.model)) {
          if (embedding && cosine(embedding, o.embedding) >= story.duplicateSimilarity) {
            const dupEp = await EpisodeModel.findById(o.episodeId).select('episodeNumber').lean();
            duplicateOf = dupEp?.episodeNumber ?? -1;
            break;
          }
        }
      } catch (err) {
        await ctx.log(`Duplicate check skipped: ${(err as Error).message}`, 'warn');
      }

      // ---- separate quality evaluation
      await ctx.progress(`evaluating quality (attempt ${attempt})`, 25 + (attempt - 1) * 25);
      const { data: q } = await generateJson({
        role: 'quality',
        operation: 'script:evaluate',
        system:
          'You are a strict editor and Mahabharata fact-checker. Evaluate a Hindi short-video narration against the source passages (which may be in English) and series context. Faithful translation of the source is correct; judge facts, not wording. Score 1–10 (10 = excellent). Be specific; list any invented or contradicted facts as criticalIssues.',
        prompt: `SOURCE PASSAGES:\n${formatPassages(passages, 18_000)}\n\nPREVIOUS EPISODE NARRATION:\n${prevEp?.narrationText || '(none)'}\n${prevPrevEp?.narrationText ? `\nEPISODE BEFORE THAT:\n${prevPrevEp.narrationText}\n` : ''}\nNEXT EPISODE PLAN: ${nextPlan ? `${nextPlan.title} — ${nextPlan.synopsis}` : '(none)'}\n\nCANDIDATE SCRIPT (episode ${episode.episodeNumber}: ${script.title}):\nHook: ${script.hook}\nNarration: ${script.narrationText}\nEnding: ${script.ending}\nTeaser: ${script.nextEpisodeTeaser}\nCharacters: ${script.characters.join(', ')}\n\nEvaluate: storyAccuracy, sourceConsistency (only facts present in passages), chronologicalContinuity (follows the previous episode, no time jumps), hookQuality (grabs within 2–3 seconds), narrationNaturalness (natural spoken Hindi, easy for TTS), endingQuality (completes the event, honest teaser), nonRepetition (does not repeat the previous episodes), characterConsistency.`,
        jsonSchema: toJsonSchema(qualitySchema),
        validator: qualitySchema,
        maxOutputTokens: 4096,
        usage: ctx.usage,
      });
      const durationScore = durationOk ? 10 : Math.max(1, 10 - Math.abs(duration - target) / 2);
      const scores = { ...q, durationSuitability: Math.round(durationScore * 10) / 10 } as Record<string, any>;
      delete scores.criticalIssues;
      delete scores.issues;
      const values = Object.values(scores) as number[];
      const overall = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
      const allIssues = [
        ...q.criticalIssues.map((i) => `CRITICAL: ${i}`),
        ...structural,
        ...(durationOk ? [] : [`Estimated duration ${duration}s is outside ${target}±${tol}s`]),
        ...(duplicateOf !== null ? [`Too similar to episode ${duplicateOf} (possible duplicate)`] : []),
        ...q.issues,
      ];
      const passed =
        overall >= story.qualityThreshold &&
        q.storyAccuracy >= story.qualityThreshold &&
        q.sourceConsistency >= story.qualityThreshold &&
        q.criticalIssues.length === 0 &&
        structural.length === 0 &&
        durationOk &&
        duplicateOf === null;
      await ctx.log(`Attempt ${attempt}: overall ${overall}, est. ${duration}s, ${passed ? 'PASSED' : `failed (${allIssues.slice(0, 3).join('; ')})`} [${model}]`);

      const quality = { scores, overall, passed, issues: allIssues, evaluatedAt: new Date(), attempts: attempt };
      if (!best || (passed && !best.passed) || (passed === best.passed && overall > best.overall)) {
        best = { script, quality, overall, duration, embedding, passed };
      }
      if (passed) break;

      const delta = duration - target;
      feedback = `\n\nREVISION REQUIRED. The previous draft had these problems:\n- ${allIssues.join('\n- ')}${
        !durationOk ? `\nLength: the draft was about ${Math.abs(Math.round(delta))} seconds too ${delta > 0 ? 'long — cut' : 'short — add'} roughly ${Math.abs(Math.round(delta / secondsPerWord))} words.` : ''
      }\nPrevious draft narration (for reference, do not copy blindly):\n${script.narrationText}`;
    }

    // ---- persist (never discards work: a script that fails the bar is saved for human review)
    const chosen = best!;
    const s = chosen.script;
    const version = episode.currentVersion + 1;
    const refs = passages
      .filter((p) => s.sourceChunkIds.includes(p.id))
      .map((p) => ({ chunkId: p.id, pageStart: p.pageStart, pageEnd: p.pageEnd, section: p.section, excerpt: p.text.slice(0, 400) }));
    await ScriptVersionModel.create({
      episodeId: episode._id,
      version,
      title: s.title,
      summary: s.summary,
      hook: s.hook,
      narrationText: s.narrationText,
      ending: s.ending,
      nextEpisodeTeaser: s.nextEpisodeTeaser,
      narrationStyle: style.id,
      characters: s.characters,
      sceneDescriptions: s.sceneDescriptions,
      sourceReferences: refs,
      storyArc: s.storyArc,
      estimatedDuration: chosen.duration,
      quality: chosen.quality,
      contentHash: sha256(s.narrationText),
      createdBy: 'ai',
      changeNote: explicit ? 'Regenerated on request' : 'Initial generation',
      embedding: chosen.embedding,
      embeddingModel,
    });
    const status: EpisodeStatus = chosen.passed ? 'draft' : 'review_required';
    await EpisodeModel.updateOne(
      { _id: episode._id },
      {
        $set: {
          title: s.title,
          summary: s.summary,
          hook: s.hook,
          narrationText: s.narrationText,
          ending: s.ending,
          nextEpisodeTeaser: s.nextEpisodeTeaser,
          narrationStyle: style.id,
          styleReason,
          characters: s.characters,
          storyArc: s.storyArc,
          storyTimeline: s.storyTimeline,
          sourceReferences: refs,
          sceneDescriptions: s.sceneDescriptions,
          estimatedDuration: chosen.duration,
          estimatedWordCount: countWords(s.narrationText),
          uncertaintyNotes: s.uncertaintyNotes,
          highlightWords: s.highlightWords,
          quality: chosen.quality,
          status,
          currentVersion: version,
          approvedAt: null,
        },
        $unset: { regenerationRequestedAt: 1, actualAudioDuration: 1 },
      },
    );
    if (version > 1) await invalidateDownstream(String(episode._id), version);
    await ctx.progress('writing Hinglish reading copy', 95);
    try {
      await saveHinglish(String(episode._id), ctx.usage);
    } catch (err) {
      // The Hindi script is already saved; the Hinglish copy is retried as its own job.
      await ctx.log(`Hinglish copy failed (${(err as Error).message}); queued for retry`, 'warn');
      await enqueueHinglishJob(String(episode._id), version);
    }
    await ctx.progress(status === 'draft' ? 'script ready for review' : 'script needs human review', 100);
  } catch (err) {
    // Restore the previous state so a failed attempt never leaves an episode stuck in "generating".
    await EpisodeModel.updateOne({ _id: episode._id, status: 'generating' }, { $set: { status: priorStatus === 'generating' ? 'pending' : priorStatus } });
    throw err;
  }
}

// ------------------------------------------------------------------ editing / approval

/** Marks narration audio and in-flight videos built from older script versions as stale. Nothing is deleted. */
export async function invalidateDownstream(episodeId: string, newVersion: number) {
  await NarrationAssetModel.updateMany({ episodeId, scriptVersion: { $lt: newVersion }, status: 'active' }, { $set: { status: 'stale' } });
  await VideoAssetModel.updateMany(
    { episodeId, scriptVersion: { $lt: newVersion }, status: 'completed' },
    { $addToSet: { warnings: `Script was edited after this render (now v${newVersion})` } },
  );
  await EpisodeModel.updateOne({ _id: episodeId }, { $set: { videoStatus: 'none' }, $unset: { actualAudioDuration: 1 } });
}

export interface ScriptEdit {
  title?: string;
  summary?: string;
  hook?: string;
  narrationText?: string;
  ending?: string;
  nextEpisodeTeaser?: string;
  sceneDescriptions?: GeneratedScript['sceneDescriptions'];
  styleOverride?: string | null;
  characters?: string[];
  changeNote?: string;
}

export async function editScript(episodeId: string, edit: ScriptEdit) {
  const ep = await EpisodeModel.findById(episodeId);
  if (!ep) throw notFound('Episode');
  if (ep.status === 'locked') throw conflict('Episode is locked. Unlock it to edit.');
  if (ep.status === 'generating') throw conflict('Episode is being generated');
  if (edit.styleOverride !== undefined) {
    if (edit.styleOverride && !NARRATION_STYLES.some((s) => s.id === edit.styleOverride)) throw new AppError('Unknown narration style', 422, 'VALIDATION_ERROR');
    ep.styleOverride = edit.styleOverride ?? undefined;
    if (edit.styleOverride) ep.narrationStyle = edit.styleOverride;
  }
  const contentFields = ['title', 'summary', 'hook', 'narrationText', 'ending', 'nextEpisodeTeaser', 'sceneDescriptions', 'characters'] as const;
  const changed = contentFields.some((f) => edit[f] !== undefined && JSON.stringify(edit[f]) !== JSON.stringify((ep as any)[f]));
  if (changed) {
    for (const f of contentFields) if (edit[f] !== undefined) (ep as any)[f] = edit[f];
    if (edit.title) ep.slug = `${String(ep.episodeNumber).padStart(3, '0')}-${slugify(edit.title)}`;
    const story = await getSettings('story');
    ep.estimatedDuration = estimateSpokenSeconds(ep.narrationText, story.syllablesPerSecond);
    ep.estimatedWordCount = countWords(ep.narrationText);
    ep.currentVersion += 1;
    // Edits to an approved script send it back to review: the user re-approves the new text.
    if (ep.status === 'approved') ep.status = 'draft';
    ep.approvedAt = undefined;
    await ScriptVersionModel.create({
      episodeId: ep._id,
      version: ep.currentVersion,
      title: ep.title,
      summary: ep.summary,
      hook: ep.hook,
      narrationText: ep.narrationText,
      ending: ep.ending,
      nextEpisodeTeaser: ep.nextEpisodeTeaser,
      narrationStyle: ep.narrationStyle,
      characters: ep.characters,
      sceneDescriptions: ep.sceneDescriptions,
      sourceReferences: ep.sourceReferences,
      storyArc: ep.storyArc,
      estimatedDuration: ep.estimatedDuration,
      quality: ep.quality,
      contentHash: sha256(ep.narrationText),
      createdBy: 'user',
      changeNote: edit.changeNote ?? 'Edited in Script Studio',
    });
  }
  await ep.save();
  if (changed) {
    await invalidateDownstream(String(ep._id), ep.currentVersion);
    if (edit.narrationText !== undefined || edit.title !== undefined) await enqueueHinglishJob(String(ep._id), ep.currentVersion);
    else await ScriptVersionModel.updateOne({ episodeId: ep._id, version: ep.currentVersion }, { $set: { titleHinglish: ep.titleHinglish, narrationHinglish: ep.narrationHinglish } });
  }
  return ep;
}

export async function setEpisodeStatus(episodeId: string, action: 'approve' | 'lock' | 'unlock' | 'unapprove') {
  const ep = await EpisodeModel.findById(episodeId);
  if (!ep) throw notFound('Episode');
  const now = new Date();
  switch (action) {
    case 'approve':
      if (!['draft', 'review_required', 'approved'].includes(ep.status)) throw conflict(`Cannot approve an episode that is ${ep.status}`);
      if (!ep.narrationText.trim()) throw conflict('Episode has no narration');
      ep.status = 'approved';
      ep.approvedAt = now;
      break;
    case 'lock':
      if (ep.status !== 'approved') throw conflict('Only approved episodes can be locked');
      ep.status = 'locked';
      ep.lockedAt = now;
      break;
    case 'unlock':
      if (ep.status !== 'locked') throw conflict('Episode is not locked');
      ep.status = 'approved';
      ep.lockedAt = undefined;
      break;
    case 'unapprove':
      if (ep.status !== 'approved') throw conflict('Episode is not approved');
      ep.status = 'draft';
      ep.approvedAt = undefined;
      break;
  }
  await ep.save();
  return ep;
}

// ------------------------------------------------------------------ Hinglish reading copy

/** Splits Hindi narration into sentences (keeps terminal punctuation). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[।॥?!.…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const HINGLISH_SYSTEM = `You convert Hindi written in Devanagari into Hinglish: the same Hindi written in everyday Roman letters, the way Indians type on YouTube and WhatsApp.
Rules:
- TRANSLITERATE, never translate. Every Hindi word stays a Hindi word (e.g. "प्रतिज्ञा" → "pratigya", not "vow").
- Natural common spellings without diacritics: hai, hain, kya, nahi, aur, unhone, ki, ke, mein, tha, thi, diya, kaha, jaante.
- Familiar spellings for names and places: Bhishma, Arjun, Krishna, Karna, Draupadi, Yudhishthir, Duryodhan, Hastinapur, Kurukshetra, Ganga, Shantanu.
- Keep punctuation and pauses: "।" becomes ".", keep ",", "?", "!", "...", "—".
- Capitalise the first word of each sentence and proper names.
- Return exactly one output sentence for each numbered input sentence, in the same order.`;

export async function transliterateToHinglish(title: string, narration: string, usage?: Parameters<typeof generateJson>[0]['usage']) {
  const sentences = splitSentences(narration);
  const noDevanagari = (s: string) => !/[\u0900-\u097F]/.test(s);
  const schema = z.object({
    title: z.string().min(1).refine(noDevanagari, 'title must be in Roman letters only'),
    sentences: z.array(z.string().min(1).refine(noDevanagari, 'sentences must be in Roman letters only')).length(sentences.length, `return exactly ${sentences.length} sentences`),
  });
  const { data } = await generateJson({
    role: 'light',
    operation: 'script:hinglish',
    system: HINGLISH_SYSTEM,
    prompt: `Title: ${title}\n\nSentences:\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    jsonSchema: toJsonSchema(schema),
    validator: schema,
    temperature: 0.2,
    maxOutputTokens: 4096,
    usage,
  });
  return { title: data.title.trim(), narration: data.sentences.map((s) => s.trim()).join(' ') };
}

/** Writes the Hinglish copy for the episode's current script version (no-op if already up to date). */
export async function saveHinglish(episodeId: string, usage?: Parameters<typeof generateJson>[0]['usage']) {
  const ep = await EpisodeModel.findById(episodeId).select('title narrationText currentVersion hinglishVersion').lean();
  if (!ep || !ep.narrationText.trim()) return;
  if (ep.hinglishVersion === ep.currentVersion) return;
  const h = await transliterateToHinglish(ep.title, ep.narrationText, usage);
  // Only apply if the script was not edited meanwhile.
  const res = await EpisodeModel.updateOne(
    { _id: ep._id, currentVersion: ep.currentVersion },
    { $set: { titleHinglish: h.title, narrationHinglish: h.narration, hinglishVersion: ep.currentVersion } },
  );
  if (res.modifiedCount) {
    await ScriptVersionModel.updateOne({ episodeId: ep._id, version: ep.currentVersion }, { $set: { titleHinglish: h.title, narrationHinglish: h.narration } });
  }
}

export async function enqueueHinglishJob(episodeId: string, version: number, force = false) {
  const ep = await EpisodeModel.findById(episodeId).select('episodeNumber sourceId').lean();
  return enqueueJob({
    queue: 'script',
    type: 'hinglish',
    idempotencyKey: `hinglish:${episodeId}:v${version}`,
    episodeId,
    episodeNumber: ep?.episodeNumber,
    sourceId: ep?.sourceId,
    maxAttempts: 4,
    force,
  });
}

export async function generateHinglishJob(ctx: JobContext) {
  await saveHinglish(String(ctx.job.episodeId), ctx.usage);
}
