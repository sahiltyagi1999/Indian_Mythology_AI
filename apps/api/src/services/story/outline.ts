import { z } from 'zod';
import { DocumentChunkModel, StoryOutlineModel, StorySourceModel } from '../../models';
import { embedTexts, generateJson } from '../../providers/llm';
import { toJsonSchema } from '../../lib/schema';
import { getSettings } from '../settings';
import { generateCharacterProfiles } from './characters';
import type { JobContext } from '../../workers/runtime';

/**
 * Macro-chronology used to put events in story order. The epic is narrated non-linearly (frame stories,
 * flashbacks such as Karna's birth retold in the Udyoga Parva), so text order alone is not chronology.
 * Each event is assigned an era by the model; events are then ordered by (era, position in text).
 */
export const ERAS = [
  { id: 'E00', label: 'Frame narrative (Vaishampayana/Ugrashrava recitation, Janamejaya)' },
  { id: 'E01', label: 'Ancient lineage and origins before Shantanu (creation, Bharata, Yayati, Puru…)' },
  { id: 'E02', label: 'Shantanu, Ganga, birth of Devavrata/Bhishma, Satyavati and Bhishma’s vow' },
  { id: 'E03', label: 'Chitrangada, Vichitravirya, Amba-Ambika-Ambalika, Vyasa, births of Dhritarashtra, Pandu, Vidura' },
  { id: 'E04', label: 'Kunti’s boon and Karna’s birth, Pandu’s marriages and curse, births of Pandavas and Kauravas, Pandu’s death' },
  { id: 'E05', label: 'Childhood in Hastinapura, Bhima–Duryodhana rivalry, Kripa and Drona, Eklavya, training and the tournament' },
  { id: 'E06', label: 'Drupada’s defeat, Lakshagriha, escape, Hidimba, Bakasura, years in disguise' },
  { id: 'E07', label: 'Draupadi’s swayamvara, marriage, return, Khandavaprastha and Indraprastha, Arjuna’s exile and marriages' },
  { id: 'E08', label: 'Khandava forest, Maya sabha, Jarasandha, Rajasuya, Shishupala' },
  { id: 'E09', label: 'The dice game, Draupadi’s humiliation, exile decreed' },
  { id: 'E10', label: 'Twelve years of forest exile (including tales narrated to the Pandavas)' },
  { id: 'E11', label: 'Year incognito at Virata’s court, Kichaka, cattle raid' },
  { id: 'E12', label: 'Peace missions, Krishna’s embassy, Kunti and Karna, war preparations' },
  { id: 'E13', label: 'Bhagavad Gita' },
  { id: 'E14', label: 'Kurukshetra war (days 1–18)' },
  { id: 'E15', label: 'Night raid, Ashwatthama, aftermath, Gandhari’s curse, funeral rites' },
  { id: 'E16', label: 'Bhishma’s teachings (Shanti/Anushasana), coronation of Yudhishthira' },
  { id: 'E17', label: 'Ashvamedha and later years in Hastinapura, Dhritarashtra’s retirement and death' },
  { id: 'E18', label: 'Destruction of the Yadavas, Krishna’s departure' },
  { id: 'E19', label: 'The great journey, ascent to heaven' },
] as const;
const ERA_IDS = ERAS.map((e) => e.id) as [string, ...string[]];
const MAX_EVENTS_PER_SEGMENT = 18;

const mapSchema = z.object({
  events: z.array(
    z.object({
      title: z.string().describe('Short Hindi title of the event'),
      summary: z.string().describe('2–4 sentence factual English summary of what happens, only from the passages'),
      characters: z.array(z.string()).describe('Canonical English names (e.g. "Bhishma", "Arjuna")'),
      chunkIds: z.array(z.string()).describe('Ids of passages that narrate this event'),
      era: z.enum(ERA_IDS),
      importance: z.number().int().min(1).max(5).describe('5 = pivotal turning point, 1 = minor detail'),
      certainty: z.enum(['certain', 'uncertain', 'varies']),
      notes: z.string().describe('Mention retellings, alternative versions or ambiguity in the passages; empty if none'),
      embeddedTale: z.boolean().describe('True if this is a story narrated by a character within the epic (sub-tale)'),
      recap: z
        .boolean()
        .describe('True if the passage only summarises, previews or briefly recounts an event that is narrated in full elsewhere (tables of contents, the Parva-sangraha summary, a character recalling past events)'),
    }),
  ),
  characters: z.array(z.object({ name: z.string(), nameHi: z.string(), aliases: z.array(z.string()), note: z.string() })),
  contradictions: z.array(z.object({ topic: z.string(), description: z.string() })),
});

const planSchema = z.object({
  episodes: z.array(
    z.object({
      title: z.string().describe('Compelling Hindi episode title'),
      synopsis: z.string().describe('English synopsis of exactly what this 55-second episode covers'),
      eventIds: z.array(z.string()),
      characters: z.array(z.string()),
      continuityNote: z.string().describe('How it connects to the previous/next episode'),
    }),
  ),
});

const MAP_SYSTEM = `You are a meticulous scholar of the Mahabharata building a factual event index from a specific edition.
Rules:
- Use ONLY the supplied passages. Never add events, names or details from memory or other versions.
- Cite the passage ids ([[id | pages …]]) that narrate each event.
- If the passages present differing accounts, mark certainty "varies" and explain in notes; do not merge them silently.
- If an event is only alluded to or unclear, mark certainty "uncertain".
- Assign each event to the era in which it HAPPENS in the story (not where it is narrated).
- Granularity: one event = one story beat a viewer would recognise (a birth, a vow, a duel, a curse, a journey, a decision). Merge consecutive small happenings into one event; aim for roughly one event per 2–4 pages of narrative.
- Summaries and previews (e.g. the opening table of contents / Parva-sangraha that outlines the whole epic, or a character briefly recounting earlier events) must be marked recap=true; the full narration elsewhere is the real event.
- Long discourses, sermons, lists of names, genealogies and descriptions of rites count as ONE event each with importance 1–2, unless they are pivotal to the story (e.g. the Bhagavad Gita = 5).
- importance: 5 = turning point of the epic, 4 = major event, 3 = notable story beat, 2 = minor detail, 1 = digression.`;

function eraPrompt() {
  return ERAS.map((e) => `${e.id}: ${e.label}`).join('\n');
}

function nameKey(name: string) {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Builds outline segments from chunk boundaries so each map call stays within segmentChars. */
async function buildSegments(sourceId: string, segmentChars: number) {
  const chunks = await DocumentChunkModel.find({ sourceId }).select('chunkIndex pageStart pageEnd text').sort({ chunkIndex: 1 }).lean();
  const segments: { index: number; chunkStart: number; chunkEnd: number; pageStart: number; pageEnd: number; status: 'pending' }[] = [];
  let start = 0;
  let size = 0;
  chunks.forEach((c, i) => {
    if (size > 0 && size + c.text.length > segmentChars) {
      segments.push({ index: segments.length, chunkStart: chunks[start]!.chunkIndex, chunkEnd: chunks[i - 1]!.chunkIndex, pageStart: chunks[start]!.pageStart, pageEnd: chunks[i - 1]!.pageEnd, status: 'pending' });
      start = i;
      size = 0;
    }
    size += c.text.length;
  });
  if (chunks.length) segments.push({ index: segments.length, chunkStart: chunks[start]!.chunkIndex, chunkEnd: chunks.at(-1)!.chunkIndex, pageStart: chunks[start]!.pageStart, pageEnd: chunks.at(-1)!.pageEnd, status: 'pending' });
  return segments;
}

function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * Outline job. Stages (each checkpointed in the StoryOutline document, so a retry resumes):
 *  1. map: extract events/characters per segment
 *  2. reduce: chronological ordering by era, de-duplicate retellings, collect contradictions
 *  3. characters: build the visual character database
 *  4. plan: group events into ~55-second episodes, window by window
 */
export async function generateOutline(ctx: JobContext) {
  let outline = await StoryOutlineModel.findById(ctx.payload.outlineId);
  if (!outline) throw Object.assign(new Error('Outline not found'), { permanent: true });
  const sourceId = String(outline.sourceId);
  const source = await StorySourceModel.findById(sourceId);
  if (!source) throw Object.assign(new Error('Source not found'), { permanent: true });
  const story = await getSettings('story');
  await StorySourceModel.updateOne({ _id: sourceId }, { $set: { status: 'analyzing' } });

  // ---- 1. map
  if (!outline.segments.length) {
    outline.set('segments', await buildSegments(sourceId, story.segmentChars));
    outline.segmentsTotal = outline.segments.length;
    await outline.save();
  }
  // Segments are independent, so they run in parallel; each result is written atomically to its own
  // slot, so a crash or restart keeps every finished segment.
  const outlineId = outline._id;
  const pendingIdx = outline.segments.filter((sg) => sg.status !== 'done').map((sg) => sg.index!);
  const segByIdx = new Map(outline.segments.map((sg) => [sg.index!, { chunkStart: sg.chunkStart!, chunkEnd: sg.chunkEnd!, pageStart: sg.pageStart!, pageEnd: sg.pageEnd! }]));
  let cursor = 0;
  let stop: Error | null = null;
  const mapOne = async (idx: number) => {
    const seg = segByIdx.get(idx)!;
    const chunks = await DocumentChunkModel.find({ sourceId, chunkIndex: { $gte: seg.chunkStart, $lte: seg.chunkEnd } }).sort({ chunkIndex: 1 }).lean();
    const passages = chunks.map((c) => `[[${c._id} | pages ${c.pageStart}-${c.pageEnd}${c.section ? ` | ${c.section}` : ''}]]\n${c.text}`).join('\n\n');
    const validIds = new Set(chunks.map((c) => String(c._id)));
    const { data, model } = await generateJson({
      role: 'analysis',
      operation: 'outline:map',
      system: MAP_SYSTEM,
      prompt: `Source edition: ${source.title}${source.edition ? ` (${source.edition})` : ''}.\nEras:\n${eraPrompt()}\n\nExtract the story events narrated in these passages (pages ${seg.pageStart}–${seg.pageEnd}), in the order they appear. Aim for roughly one event per 2–4 pages of narrative and at most ${MAX_EVENTS_PER_SEGMENT} events.\n\n${passages}`,
      jsonSchema: toJsonSchema(mapSchema),
      validator: mapSchema,
      maxOutputTokens: 16384,
      usage: ctx.usage,
    });
    const pageOf = new Map(chunks.map((c) => [String(c._id), c]));
    const events = data.events.slice(0, MAX_EVENTS_PER_SEGMENT + 5).map((e, i) => {
      const ids = e.chunkIds.filter((id) => validIds.has(id));
      const cs = (ids.length ? ids : [String(chunks[0]!._id)]).map((id) => pageOf.get(id)!);
      return {
        eventId: `s${idx}e${i}`,
        order: 0,
        title: e.title,
        summary: e.summary,
        characters: e.characters,
        pageStart: Math.min(...cs.map((c) => c.pageStart)),
        pageEnd: Math.max(...cs.map((c) => c.pageEnd)),
        chunkIds: ids,
        certainty: e.certainty,
        notes: e.notes,
        importance: e.importance,
        era: e.era,
        embeddedTale: e.embeddedTale,
        recap: e.recap,
      };
    });
    await StoryOutlineModel.updateOne(
      { _id: outlineId, 'segments.index': idx },
      { $set: { 'segments.$.events': events, 'segments.$.characters': data.characters, 'segments.$.contradictions': data.contradictions, 'segments.$.status': 'done', llmModel: model } },
    );
    const fresh = await StoryOutlineModel.findById(outlineId).select('segments.status segmentsTotal').lean();
    const done = fresh!.segments.filter((x) => x.status === 'done').length;
    await StoryOutlineModel.updateOne(
      { _id: outlineId },
      { $set: { segmentsProcessed: done, progress: { stage: 'mapping', percent: Math.round((done / fresh!.segmentsTotal) * 60), message: `Segment ${done}/${fresh!.segmentsTotal}` } } },
    );
    await ctx.progress(`mapping segments ${done}/${fresh!.segmentsTotal}`, (done / fresh!.segmentsTotal) * 60);
  };
  const lanes = Math.max(1, Math.min(story.outlineConcurrency, pendingIdx.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (!stop && cursor < pendingIdx.length) {
        const idx = pendingIdx[cursor++]!;
        try {
          await ctx.checkCancelled();
          await mapOne(idx);
        } catch (err) {
          stop = stop ?? (err as Error);
        }
      }
    }),
  );
  if (stop) throw stop;
  // Reload: the parallel lanes wrote directly to the database.
  const reloaded = await StoryOutlineModel.findById(outlineId);
  if (!reloaded) throw Object.assign(new Error('Outline disappeared'), { permanent: true });
  outline = reloaded;

  // ---- 2. reduce (deterministic ordering + embedding-based de-duplication)
  if (!outline.events.length) {
    await ctx.progress('ordering events chronologically', 62);
    const all = outline.segments.flatMap((s) => s.events.map((e) => ({ ...(e as any).toObject?.() ?? e })));
    const eraOf = (e: any) => String(e.era || 'E00');
    all.sort((a: any, b: any) => eraOf(a).localeCompare(eraOf(b)) || a.pageStart - b.pageStart);
    const kept: any[] = [];
    const vecs: number[][] = [];
    let embedModel = '';
    for (let i = 0; i < all.length; i += 100) {
      const batch = all.slice(i, i + 100);
      const { vectors, model } = await embedTexts(batch.map((e: any) => e.summary), 'document', { usage: ctx.usage });
      vecs.push(...vectors);
      embedModel = model;
    }
    const keptVecs: number[][] = [];
    // OpenAI text-embedding-3 scores paraphrases lower than Gemini embeddings; calibrate the merge threshold.
    const sameEventThreshold = /^text-embedding-3/.test(embedModel) ? 0.82 : 0.9;
    const recapUniqueBelow = /^text-embedding-3/.test(embedModel) ? 0.6 : 0.75;
    // Full narrations first, recaps last: a recap is only kept when no full narration covers it.
    const orderIdx = all.map((_, i) => i).sort((a, b) => Number(!!all[a].recap) - Number(!!all[b].recap));
    const keptIdx: number[] = [];
    for (const i of orderIdx) {
      const e = all[i];
      let best = -1;
      let bestScore = -1;
      // Compare with every kept event of the same era (retellings can be hundreds of pages apart).
      kept.forEach((k, ki) => {
        if (eraOf(k) !== eraOf(e)) return;
        const sc = cosine(keptVecs[ki]!, vecs[i]!);
        if (sc > bestScore) {
          bestScore = sc;
          best = ki;
        }
      });
      if (e.recap && bestScore >= recapUniqueBelow) continue; // told in full elsewhere
      if (best >= 0 && bestScore > sameEventThreshold) {
        const base = kept[best];
        base.chunkIds = [...new Set([...base.chunkIds, ...e.chunkIds])];
        base.importance = Math.max(base.importance, e.importance);
        base.notes = [base.notes, `also narrated at pp. ${e.pageStart}-${e.pageEnd}`].filter(Boolean).join(' | ');
        if (e.certainty !== 'certain' && base.certainty === 'certain') base.certainty = e.certainty;
        continue;
      }
      kept.push(e);
      keptVecs.push(vecs[i]!);
      keptIdx.push(i);
    }
    // Restore story order (era, then position in the text).
    const order = kept.map((_, k) => k).sort((a, b) => eraOf(kept[a]).localeCompare(eraOf(kept[b])) || kept[a].pageStart - kept[b].pageStart);
    const sortedKept = order.map((k) => kept[k]);
    kept.length = 0;
    kept.push(...sortedKept);
    kept.forEach((e, i) => (e.order = i));
    outline.set('events', kept);
    const contradictions = outline.segments.flatMap((s) =>
      (s.contradictions ?? []).map((c) => ({ topic: c.topic ?? '', description: c.description ?? '', pageRefs: [s.pageStart ?? 0, s.pageEnd ?? 0] })),
    );
    for (const e of kept.filter((e) => e.certainty === 'varies')) {
      contradictions.push({ topic: e.title, description: String(e.notes), pageRefs: [e.pageStart, e.pageEnd] });
    }
    outline.set('contradictions', contradictions);
    outline.progress = { stage: 'reduced', percent: 65, message: `${kept.length} events after merging ${all.length - kept.length} retellings` };
    await outline.save();
  }

  // ---- 3. character database
  if (!outline.charactersDone) {
    await ctx.progress('building character database', 68);
    const mentions = new Map<string, { name: string; nameHi: string; aliases: Set<string>; notes: string[]; count: number; firstOrder: number }>();
    for (const seg of outline.segments) {
      for (const c of seg.characters as any[]) {
        const k = nameKey(c.name);
        if (!k) continue;
        const m = mentions.get(k) ?? { name: c.name, nameHi: c.nameHi, aliases: new Set<string>(), notes: [] as string[], count: 0, firstOrder: Infinity };
        (c.aliases ?? []).forEach((a: string) => m.aliases.add(a));
        if (c.note && m.notes.length < 6) m.notes.push(c.note);
        mentions.set(k, m);
      }
    }
    for (const e of outline.events) {
      for (const name of e.characters ?? []) {
        const m = mentions.get(nameKey(name));
        if (m) {
          m.count++;
          m.firstOrder = Math.min(m.firstOrder, e.order ?? 0);
        }
      }
    }
    // Small sources (few events) keep every named character; large ones require repeated appearances.
    const minMentions = outline.events.length >= 50 ? 2 : 1;
    const major = [...mentions.values()].filter((m) => m.count >= minMentions).sort((a, b) => b.count - a.count).slice(0, 120);
    await generateCharacterProfiles(sourceId, major.map((m) => ({ name: m.name, nameHi: m.nameHi, aliases: [...m.aliases], notes: m.notes })), ctx);
    outline.charactersDone = true;
    await outline.save();
  }

  // ---- 4. episode planning (windowed, checkpointed via planningCursor)
  const events = outline.events;
  const W = story.planningWindowEvents;
  while (outline.planningCursor < events.length) {
    await ctx.checkCancelled();
    const window = events.slice(outline.planningCursor, outline.planningCursor + W);
    const prev = outline.episodes.slice(-3);
    const lines = window.map(
      (e) => `${e.eventId} | era ${e.era} | importance ${e.importance} | ${e.certainty} | ${e.title} — ${e.summary}${e.embeddedTale ? ' (embedded tale)' : ''}${e.notes ? ` [notes: ${e.notes}]` : ''}`,
    );
    const required = window.filter((e) => (e.importance ?? 3) >= 3).map((e) => e.eventId);
    let feedback = '';
    let planned: z.infer<typeof planSchema>['episodes'] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data } = await generateJson({
        role: 'analysis',
        operation: 'outline:plan',
        system: `You are the head writer of a Hindi YouTube Shorts series retelling the complete Mahabharata in chronological order, one ~55-second episode at a time.
Plan episodes from the given ordered events:
- Each episode tells ONE clear, self-contained story beat that can be narrated in ~55 seconds (roughly 130–150 spoken Hindi words).
- Pivotal events (importance 4–5) may be split across 2–3 consecutive episodes; closely linked minor events may share an episode.
- Every event with importance >= 3 MUST be covered by some episode. Events with importance 1–2 may be folded in or skipped.
- Prefer combining 2–3 closely linked consecutive events into one episode when together they still fit ~55 seconds; only pivotal events deserve an episode of their own.
- Keep chronological order. Do not invent events. Use only the given event ids.
- Titles: compelling, natural Hindi, unique, no clickbait that misrepresents the story.`,
        prompt: `${prev.length ? `Previously planned episodes (for continuity):\n${prev.map((p) => `#${p.episodeNumber} ${p.title}: ${p.synopsis}`).join('\n')}\n\n` : ''}Ordered events:\n${lines.join('\n')}${feedback}`,
        jsonSchema: toJsonSchema(planSchema),
        validator: planSchema,
        maxOutputTokens: 16384,
        usage: ctx.usage,
      });
      planned = data.episodes;
      const covered = new Set(planned.flatMap((p) => p.eventIds));
      const missing = required.filter((id) => !covered.has(id));
      if (!missing.length) break;
      feedback = `\n\nYour previous plan skipped required events: ${missing.join(', ')}. Include them.`;
      if (attempt === 1) await ctx.log(`Planner left ${missing.length} important events uncovered in window at ${outline.planningCursor}: ${missing.join(', ')}`, 'warn');
    }
    const byId = new Map(window.map((e) => [e.eventId, e]));
    let n = outline.episodes.length;
    for (const p of planned) {
      const evs = p.eventIds.map((id) => byId.get(id)).filter(Boolean) as typeof window;
      if (!evs.length) continue;
      outline.episodes.push({
        episodeNumber: ++n,
        title: p.title,
        synopsis: p.synopsis,
        eventIds: evs.map((e) => e.eventId),
        characters: p.characters,
        pageStart: Math.min(...evs.map((e) => e.pageStart ?? 0)),
        pageEnd: Math.max(...evs.map((e) => e.pageEnd ?? 0)),
        continuityNote: p.continuityNote,
      });
    }
    outline.planningCursor = Math.min(events.length, outline.planningCursor + W);
    outline.progress = { stage: 'planning', percent: 70 + Math.round((outline.planningCursor / events.length) * 30), message: `${outline.episodes.length} episodes planned` };
    await outline.save();
    await ctx.progress(`planning episodes (${outline.planningCursor}/${events.length} events)`, 70 + (outline.planningCursor / events.length) * 30);
  }

  outline.status = 'draft';
  outline.progress = { stage: 'complete', percent: 100, message: `${outline.episodes.length} episodes planned from ${events.length} events` };
  await outline.save();
  await StorySourceModel.updateOne({ _id: sourceId }, { $set: { status: 'outlined' } });
}
