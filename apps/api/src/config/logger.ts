import pino from 'pino';
import { env } from './env';

/** Field paths whose values must never reach logs. */
const REDACT = [
  'apiKey',
  '*.apiKey',
  '*.*.apiKey',
  'key',
  'headers["x-goog-api-key"]',
  'headers["xi-api-key"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'secret',
  '*.secret',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT, censor: '[redacted]' },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined,
});

const knownSecrets = new Set<string>();

/** Registers a credential value so it is redacted wherever it appears, regardless of its format. */
export function registerSecret(value: string | undefined | null) {
  if (value && value.length >= 8) knownSecrets.add(value);
}
registerSecret(env.GEMINI_API_KEY);
registerSecret(env.ELEVENLABS_API_KEY);
registerSecret(env.OPENAI_API_KEY);
registerSecret(env.QDRANT_API_KEY);
registerSecret(env.SECRETS_MASTER_KEY);

/** Removes API keys from URLs and messages before they are logged or persisted. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const s of knownSecrets) out = out.split(s).join('[redacted]');
  return out
    .replace(/(mongodb(?:\+srv)?:\/\/[^:/@\s]+:)[^@\s]+@/gi, '$1[redacted]@')
    .replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/(x-goog-api-key|xi-api-key)["':\s]+[^\s"',}]+/gi, '$1: [redacted]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/sk_[0-9a-f]{32,}/gi, '[redacted]')
    .replace(/sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(/(authorization["':\s]+bearer\s+)[^\s"',}]+/gi, '$1[redacted]');
}
