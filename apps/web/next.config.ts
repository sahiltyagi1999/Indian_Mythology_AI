import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/** Reads only API_URL from the repo-root .env; provider keys stay out of the web process entirely. */
function rootEnv(name: string): string | undefined {
  try {
    const text = fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
    return text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const API_URL = process.env.API_URL ?? rootEnv('API_URL') ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mas/shared'],
  experimental: {
    // The /api proxy buffers request bodies; PDFs can be hundreds of MB (API limit: MAX_UPLOAD_MB, default 1 GB).
    middlewareClientMaxBodySize: '1100mb',
    // Large uploads and long API calls must not be cut off by the proxy's default 30 s timeout.
    proxyTimeout: 10 * 60_000,
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
