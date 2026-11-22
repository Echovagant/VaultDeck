/**
 * 向量端口共享类型：VectorRecordInput / AiSemanticHit 定义于此；
 * StoreUser 复用 store.port；VectorStats 与 VectorStorePort 在 vector.port.ts。
 */
import type { VectorStats } from './vector.port';
import type { StoreUser } from './store.port';

export interface VectorRecordInput {
  fileId: string;
  fileName: string;
  chunkIndex: number;
  excerpt: string;
  embedding: number[];
}

export interface AiSemanticHit {
  fileId: string;
  fileName: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
}

export type { StoreUser, VectorStats };
