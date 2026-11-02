import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.string().default('info'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017'),
  MONGODB_DB: z.string().default('mahabharat_ai_studio'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  QUEUE_PREFIX: z.string().default('mas'),
  VECTOR_STORE: z.enum(['qdrant', 'atlas']).default('qdrant'),
  QDRANT_URL: z.string().default('http://127.0.0.1:6333'),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('mas_document_chunks'),
  STORAGE_DIR: z.string().default(path.join(REPO_ROOT, 'storage')),
  MAX_UPLOAD_MB: z.coerce.number().default(1024),
  SECRETS_MASTER_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  GEMINI_BASE_URL: z.string().default('https://generativelanguage.googleapis.com/v1beta'),
  ELEVENLABS_BASE_URL: z.string().default('https://api.elevenlabs.io'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  PDFTOTEXT_PATH: z.string().default('pdftotext'),
  PDFTOPPM_PATH: z.string().default('pdftoppm'),
  PDFINFO_PATH: z.string().default('pdfinfo'),
  TESSERACT_PATH: z.string().default('tesseract'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;

/**
 * 32-byte key used to encrypt API keys stored in MongoDB. Prefer SECRETS_MASTER_KEY (base64 or hex).
 * In development a key is generated once and kept in .data/secrets.key (0600) so the app works out of the box.
 */
function resolveMasterKey(): Buffer {
  const raw = env.SECRETS_MASTER_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('SECRETS_MASTER_KEY must decode to 32 bytes (64 hex chars or 44 base64 chars)');
    return buf;
  }
  if (env.NODE_ENV === 'production') throw new Error('SECRETS_MASTER_KEY is required in production');
  const file = path.join(REPO_ROOT, '.data', 'secrets.key');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

export const masterKey = resolveMasterKey();
