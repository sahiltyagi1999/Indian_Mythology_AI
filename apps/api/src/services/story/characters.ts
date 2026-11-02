import { z } from 'zod';
import { CharacterModel } from '../../models';
import { generateJson } from '../../providers/llm';
import { toJsonSchema } from '../../lib/schema';
import type { JobContext } from '../../workers/runtime';

export function characterKey(name: string) {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const profileSchema = z.object({
  characters: z.array(
    z.object({
      name: z.string(),
      nameHi: z.string(),
      aliases: z.array(z.string()),
      role: z.string().describe('One line: who they are in the story'),
      description: z.string().describe('2–3 sentences on personality and story significance, from the source notes'),
      variants: z
        .array(
          z.object({
            key: z.string().describe('kebab-case id such as "young", "adult", "elder", "war"'),
            label: z.string().describe('e.g. "Young Arjuna (training years)"'),
            ageRange: z.string(),
            facialFeatures: z.string(),
            hair: z.string(),
            clothing: z.string(),
            armorAndAccessories: z.string(),
            bodyType: z.string(),
            colorPalette: z.array(z.string()).describe('3–5 hex colours'),
            identityPrompt: z
              .string()
              .describe('A single reusable English visual description (60–90 words) that identifies this character consistently in any scene'),
          }),
        )
        .min(1)
        .max(4),
    }),
  ),
});

/**
 * Generates visual identity profiles (with age variants) for the characters found in the source.
 * User-edited characters are never overwritten.
 */
export async function generateCharacterProfiles(
  sourceId: string,
  list: { name: string; nameHi?: string; aliases: string[]; notes: string[] }[],
  ctx: JobContext,
) {
  const existing = await CharacterModel.find({ sourceId }).select('nameKey userEdited').lean();
  const protectedKeys = new Set(existing.filter((c) => c.userEdited).map((c) => c.nameKey));
  const todo = list.filter((c) => !protectedKeys.has(characterKey(c.name)));
  const batches: (typeof todo)[] = [];
  for (let i = 0; i < todo.length; i += 10) batches.push(todo.slice(i, i + 10));
  let next = 0;
  let finished = 0;
  // Batches are independent; run up to 4 at a time.
  const runBatch = async (batch: typeof todo) => {
    await ctx.checkCancelled();
    const { data } = await generateJson({
      role: 'analysis',
      operation: 'characters:profile',
      system: `You are the character designer for a cinematic Mahabharata series. Create consistent visual identities for AI video generation.
- Ground personality and role in the provided source notes; do not invent plot facts.
- Visual design: dignified, culturally authentic ancient Indian attire, jewellery and weapons appropriate to each character's station (kshatriya, brahmin, sage, deity, queen…), respectful and non-caricatured. Where the source describes appearance (e.g. Krishna's dark complexion, Bhima's great size, Karna's kavacha-kundala), follow it.
- Provide age variants only when the character appears at clearly different ages in the story.
- identityPrompt must be self-contained, visual only, and stable across scenes (no actions, no backgrounds).`,
      prompt: `Characters (with notes extracted from the source):\n${batch
        .map((c) => `- ${c.name}${c.nameHi ? ` (${c.nameHi})` : ''}${c.aliases.length ? `; aliases: ${c.aliases.join(', ')}` : ''}${c.notes.length ? `; notes: ${c.notes.join(' / ')}` : ''}`)
        .join('\n')}`,
      jsonSchema: toJsonSchema(profileSchema),
      validator: profileSchema,
      maxOutputTokens: 16384,
      usage: ctx.usage,
    });
    for (const c of data.characters) {
      const key = characterKey(c.name);
      if (!key || protectedKeys.has(key)) continue;
      await CharacterModel.updateOne(
        { sourceId, nameKey: key },
        {
          $set: { name: c.name, nameHi: c.nameHi, role: c.role, description: c.description, variants: c.variants.map((v) => ({ ...v, referenceImages: [] })) },
          $addToSet: { aliases: { $each: c.aliases } },
          $setOnInsert: { sourceId, nameKey: key },
        },
        { upsert: true },
      );
    }
    finished++;
    await ctx.progress(`character profiles ${finished}/${batches.length} batches`, 66 + (finished / Math.max(1, batches.length)) * 4);
  };
  await Promise.all(
    Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (next < batches.length) await runBatch(batches[next++]!);
    }),
  );
}

/** Finds characters by name or alias within a source. */
export async function findCharacters(sourceId: string, names: string[]) {
  const keys = names.map(characterKey);
  return CharacterModel.find({ sourceId, $or: [{ nameKey: { $in: keys } }, { aliases: { $in: names } }] }).lean();
}
