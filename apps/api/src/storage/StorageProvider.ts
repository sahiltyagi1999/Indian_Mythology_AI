import type { Readable } from 'node:stream';

/**
 * Storage abstraction. Keys are POSIX-style relative paths such as
 * `projects/<sourceId>/episodes/012/renders/<videoId>/final.mp4`.
 * The local implementation maps keys to the filesystem; an S3 implementation maps them to object keys.
 */
export interface StorageProvider {
  readonly kind: 'local' | 's3';
  put(key: string, data: Buffer | string): Promise<void>;
  putStream(key: string, stream: Readable): Promise<void>;
  /** Imports a file produced on local disk (e.g. by FFmpeg) into storage. */
  putFile(key: string, localPath: string, opts?: { move?: boolean }): Promise<void>;
  get(key: string): Promise<Buffer>;
  getStream(key: string, range?: { start: number; end?: number }): Readable;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<{ size: number; modifiedAt: Date } | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  /** Returns a local filesystem path for tools that need one (FFmpeg, pdftotext). S3 would download to a temp file. */
  localPath(key: string): Promise<string>;
  usage(prefix?: string): Promise<{ bytes: number; files: number }>;
  diskSpace(): Promise<{ total: number; free: number } | null>;
}
