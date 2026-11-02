import { ProviderError } from './errors';
import { scrubSecrets } from '../config/logger';

export interface ProviderResponse {
  status: number;
  headers: Headers;
  body: Buffer;
  json<T = any>(): T;
  text(): string;
}

/**
 * fetch wrapper for provider APIs. Network errors, 408/429/5xx are retryable (BullMQ backs off);
 * other 4xx are permanent. Error messages are scrubbed of credentials before they propagate.
 */
export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<ProviderResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 120_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).name === 'AbortError' ? 'request timed out' : (err as Error).message;
    throw new ProviderError(scrubSecrets(`${provider} network error: ${msg}`), provider, true, undefined, 'NETWORK');
  }
  const body = Buffer.from(await res.arrayBuffer());
  clearTimeout(timer);
  const wrapped: ProviderResponse = {
    status: res.status,
    headers: res.headers,
    body,
    text: () => body.toString('utf8'),
    json: () => JSON.parse(body.toString('utf8')),
  };
  if (!res.ok) {
    let detail = body.toString('utf8').slice(0, 1500);
    try {
      const j = JSON.parse(detail);
      detail = j?.error?.message ?? j?.detail?.message ?? j?.detail ?? j?.message ?? detail;
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch {
      /* not json */
    }
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    const code = res.status === 429 ? 'RATE_LIMITED' : res.status === 401 || res.status === 403 ? 'AUTH' : `HTTP_${res.status}`;
    const retryAfter = res.headers.get('retry-after');
    const err = new ProviderError(
      scrubSecrets(`${provider} HTTP ${res.status}: ${detail}${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`),
      provider,
      retryable,
      res.status,
      code,
    );
    throw err;
  }
  return wrapped;
}
