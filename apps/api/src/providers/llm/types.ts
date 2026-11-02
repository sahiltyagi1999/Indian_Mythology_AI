import type { ZodType } from 'zod';
import type { UsageContext } from '../../services/cost/usage';

/** What a model is used for. `light` = cheap, high-volume work (style scoring, Hinglish). */
export type ModelRole = 'text' | 'analysis' | 'quality' | 'ocr' | 'light' | 'embedding';

export interface GenerateJsonOptions<T> {
  role: ModelRole;
  model?: string;
  system: string;
  prompt: string;
  /** JSON Schema sent to the API. */
  jsonSchema: object;
  /** Zod schema used to validate the response regardless of API-side enforcement. */
  validator: ZodType<T>;
  maxOutputTokens?: number;
  temperature?: number;
  usage?: UsageContext;
  operation: string;
  images?: { mimeType: string; data: Buffer }[];
}
