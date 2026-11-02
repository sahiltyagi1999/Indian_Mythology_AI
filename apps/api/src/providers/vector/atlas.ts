import mongoose from 'mongoose';
import type { VectorFilter, VectorHit, VectorPoint, VectorStore } from './types';

/**
 * MongoDB Atlas Vector Search adapter. Vectors live in the `chunk_vectors` collection.
 * Requires an Atlas Search vector index named `chunk_vector_index` (see README → Atlas Vector Search).
 */
export class AtlasVectorStore implements VectorStore {
  readonly kind = 'atlas' as const;
  private get coll() {
    return mongoose.connection.collection('chunk_vectors');
  }

  async ensureCollection() {
    await this.coll.createIndex({ sourceId: 1 }).catch(() => undefined);
  }

  async upsert(points: VectorPoint[]) {
    if (!points.length) return;
    await this.coll.bulkWrite(
      points.map((p) => ({
        replaceOne: { filter: { _id: p.id as any }, replacement: { embedding: p.vector, ...p.payload }, upsert: true },
      })),
    );
  }

  async search(vector: number[], filter: VectorFilter, limit: number): Promise<VectorHit[]> {
    const pre: Record<string, unknown> = { sourceId: filter.sourceId };
    if (filter.pageFrom !== undefined) pre.pageEnd = { $gte: filter.pageFrom };
    if (filter.pageTo !== undefined) pre.pageStart = { $lte: filter.pageTo };
    const docs = await this.coll
      .aggregate([
        { $vectorSearch: { index: 'chunk_vector_index', path: 'embedding', queryVector: vector, numCandidates: limit * 20, limit, filter: pre } },
        { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray();
    return docs.map((d: any) => ({
      id: String(d._id),
      score: d.score,
      payload: { sourceId: d.sourceId, chunkId: d.chunkId, chunkIndex: d.chunkIndex, pageStart: d.pageStart, pageEnd: d.pageEnd, section: d.section },
    }));
  }

  async deleteBySource(sourceId: string) {
    await this.coll.deleteMany({ sourceId });
  }

  async health() {
    return { ok: mongoose.connection.readyState === 1, message: 'Atlas Vector Search uses the MongoDB connection (requires an Atlas cluster with chunk_vector_index).' };
  }
}
