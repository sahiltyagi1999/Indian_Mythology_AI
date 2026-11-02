import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../../config/env';
import type { VectorFilter, VectorHit, VectorPoint, VectorStore } from './types';

export class QdrantStore implements VectorStore {
  readonly kind = 'qdrant' as const;
  private client = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY, checkCompatibility: false });
  constructor(private collection = env.QDRANT_COLLECTION) {}

  async ensureCollection(dimensions: number) {
    const exists = await this.client.collectionExists(this.collection);
    if (exists.exists) {
      const info = await this.client.getCollection(this.collection);
      const size = (info.config.params.vectors as { size?: number })?.size;
      if (size && size !== dimensions) {
        throw new Error(`Qdrant collection "${this.collection}" has ${size}-dim vectors but the embedding model produces ${dimensions}. Change QDRANT_COLLECTION or embeddingDimensions.`);
      }
      return;
    }
    await this.client.createCollection(this.collection, { vectors: { size: dimensions, distance: 'Cosine' } });
    await this.client.createPayloadIndex(this.collection, { field_name: 'sourceId', field_schema: 'keyword' });
    await this.client.createPayloadIndex(this.collection, { field_name: 'pageStart', field_schema: 'integer' });
    await this.client.createPayloadIndex(this.collection, { field_name: 'pageEnd', field_schema: 'integer' });
  }

  async upsert(points: VectorPoint[]) {
    if (!points.length) return;
    await this.client.upsert(this.collection, { wait: true, points });
  }

  async search(vector: number[], filter: VectorFilter, limit: number): Promise<VectorHit[]> {
    const must: any[] = [{ key: 'sourceId', match: { value: filter.sourceId } }];
    if (filter.pageFrom !== undefined) must.push({ key: 'pageEnd', range: { gte: filter.pageFrom } });
    if (filter.pageTo !== undefined) must.push({ key: 'pageStart', range: { lte: filter.pageTo } });
    const res = await this.client.search(this.collection, { vector, limit, filter: { must }, with_payload: true });
    return res.map((r) => ({ id: String(r.id), score: r.score, payload: r.payload as VectorPoint['payload'] }));
  }

  async deleteBySource(sourceId: string) {
    const exists = await this.client.collectionExists(this.collection);
    if (!exists.exists) return;
    await this.client.delete(this.collection, { wait: true, filter: { must: [{ key: 'sourceId', match: { value: sourceId } }] } });
  }

  async health() {
    try {
      const r = await this.client.getCollections();
      return { ok: true, message: `Qdrant reachable (${r.collections.length} collections)` };
    } catch (err) {
      return { ok: false, message: `Qdrant unreachable at ${env.QDRANT_URL}: ${(err as Error).message}` };
    }
  }
}
