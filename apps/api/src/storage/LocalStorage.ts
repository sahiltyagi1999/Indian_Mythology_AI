import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { StorageProvider } from './StorageProvider';

export class LocalStorage implements StorageProvider {
  readonly kind = 'local' as const;
  constructor(public readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  /** Resolves a key inside root, rejecting traversal outside it. */
  resolve(key: string): string {
    const clean = key.replace(/\\/g, '/').replace(/^\/+/, '');
    const full = path.resolve(this.root, clean);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  private async ensureDir(key: string) {
    await fsp.mkdir(path.dirname(this.resolve(key)), { recursive: true });
  }

  /** Writes atomically: temp file then rename, so readers never see partial files. */
  async put(key: string, data: Buffer | string) {
    await this.ensureDir(key);
    const target = this.resolve(key);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, target);
  }

  async putStream(key: string, stream: Readable) {
    await this.ensureDir(key);
    const target = this.resolve(key);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await pipeline(stream, fs.createWriteStream(tmp));
    await fsp.rename(tmp, target);
  }

  async putFile(key: string, localPath: string, opts: { move?: boolean } = {}) {
    await this.ensureDir(key);
    const target = this.resolve(key);
    if (path.resolve(localPath) === target) return;
    if (opts.move) {
      try {
        await fsp.rename(localPath, target);
        return;
      } catch {
        /* cross-device: fall through to copy */
      }
    }
    await fsp.copyFile(localPath, target);
    if (opts.move) await fsp.rm(localPath, { force: true });
  }

  get(key: string) {
    return fsp.readFile(this.resolve(key));
  }

  getStream(key: string, range?: { start: number; end?: number }) {
    return fs.createReadStream(this.resolve(key), range ? { start: range.start, end: range.end } : undefined);
  }

  async exists(key: string) {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string) {
    try {
      const s = await fsp.stat(this.resolve(key));
      return { size: s.size, modifiedAt: s.mtime };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await fsp.rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string) {
    if (!prefix.replace(/\/+$/, '')) throw new Error('Refusing to delete storage root');
    await fsp.rm(this.resolve(prefix), { recursive: true, force: true });
  }

  async localPath(key: string) {
    return this.resolve(key);
  }

  async usage(prefix = '') {
    let bytes = 0;
    let files = 0;
    const walk = async (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) {
          bytes += (await fsp.stat(p)).size;
          files++;
        }
      }
    };
    await walk(this.resolve(prefix));
    return { bytes, files };
  }

  async diskSpace() {
    try {
      const s = await fsp.statfs(this.root);
      return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch {
      return null;
    }
  }
}
