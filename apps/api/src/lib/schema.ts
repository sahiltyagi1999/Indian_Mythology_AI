import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Converts a zod schema into the JSON Schema subset accepted by Gemini structured output. */
export function toJsonSchema(schema: ZodType): object {
  const js = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === '$schema' || k === 'additionalProperties' || k === 'default') continue;
        out[k] = strip(v);
      }
      return out;
    }
    return node;
  };
  return strip(js) as object;
}
