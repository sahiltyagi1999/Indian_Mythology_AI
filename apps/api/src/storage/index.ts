import { env } from '../config/env';
import { LocalStorage } from './LocalStorage';
import type { StorageProvider } from './StorageProvider';

export type { StorageProvider } from './StorageProvider';

let instance: StorageProvider = new LocalStorage(env.STORAGE_DIR);

export function storage(): StorageProvider {
  return instance;
}

/** Test hook. */
export function setStorage(s: StorageProvider) {
  instance = s;
}

const pad = (n: number) => String(n).padStart(4, '0');

/** Canonical storage layout: project (source) → episode → generation. */
export const keys = {
  sourcePdf: (sourceId: string) => `projects/${sourceId}/source/original.pdf`,
  sourcePages: (sourceId: string) => `projects/${sourceId}/source/pages.json`,
  sourcePageImage: (sourceId: string, page: number) => `projects/${sourceId}/source/ocr/page-${pad(page)}.png`,
  narration: (sourceId: string, ep: number, cacheKey: string) => `projects/${sourceId}/episodes/${pad(ep)}/audio/${cacheKey.slice(0, 16)}.mp3`,
  alignment: (sourceId: string, ep: number, cacheKey: string) => `projects/${sourceId}/episodes/${pad(ep)}/audio/${cacheKey.slice(0, 16)}.alignment.json`,
  sceneClip: (sourceId: string, ep: number, cacheKey: string) => `projects/${sourceId}/episodes/${pad(ep)}/scenes/${cacheKey.slice(0, 20)}.mp4`,
  sceneStill: (sourceId: string, ep: number, cacheKey: string) => `projects/${sourceId}/episodes/${pad(ep)}/scenes/${cacheKey.slice(0, 20)}.png`,
  render: (sourceId: string, ep: number, videoId: string, file: string) => `projects/${sourceId}/episodes/${pad(ep)}/renders/${videoId}/${file}`,
  characterImage: (characterId: string, file: string) => `characters/${characterId}/${file}`,
  music: (trackId: string, ext: string) => `library/music/${trackId}${ext}`,
  branding: (file: string) => `library/branding/${file}`,
};
