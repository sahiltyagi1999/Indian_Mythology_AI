export interface VectorPoint {
  id: string;
  vector: number[];
  payload: { sourceId: string; chunkId: string; chunkIndex: number; pageStart: number; pageEnd: number; section?: string };
}

export interface VectorHit {
  id: string;
  score: number;
  payload: VectorPoint['payload'];
}

export interface VectorFilter {
  sourceId: string;
  pageFrom?: number;
  pageTo?: number;
}

export interface VectorStore {
  readonly kind: 'qdrant' | 'atlas';
  ensureCollection(dimensions: number): Promise<void>;
  upsert(points: VectorPoint[]): Promise<void>;
  search(vector: number[], filter: VectorFilter, limit: number): Promise<VectorHit[]>;
  deleteBySource(sourceId: string): Promise<void>;
  health(): Promise<{ ok: boolean; message: string }>;
}
