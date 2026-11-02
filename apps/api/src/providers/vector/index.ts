import { env } from '../../config/env';
import { AtlasVectorStore } from './atlas';
import { QdrantStore } from './qdrant';
import type { VectorStore } from './types';

export type { VectorStore, VectorPoint, VectorHit } from './types';

let store: VectorStore | null = null;

export function vectorStore(): VectorStore {
  if (!store) store = env.VECTOR_STORE === 'atlas' ? new AtlasVectorStore() : new QdrantStore();
  return store;
}

export function setVectorStore(s: VectorStore) {
  store = s;
}
