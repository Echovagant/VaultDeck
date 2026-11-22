/**
 * 向量存储 facade：按存储模式选择实现，并在这里统一完成权限过滤。
 *
 * ## 权限设计
 *
 * searchVectors 的可见性在 facade 完成：先取调用者的可见项目集合
 * （领队 = 全部；其余 = 参与的项目），PG 实现返回超采样候选后按集合过滤，
 * 内存实现返回全量候选后同样过滤——越权数据不会离开服务端。
 */
import type { Pool } from 'pg';

import type { AiSemanticHit } from '../../application/ports/vector.port.types';
import type { VectorStorePort } from '../../application/ports/vector.port';
import { store } from '../store';
import { memoryVectorStore } from './memory-vector-store';
import { PgVectorStore } from './pg-vector-store';

const USE_POSTGRES = process.env['VD_STORE'] === 'postgres';
const pgVectorStore = USE_POSTGRES
  ? new PgVectorStore((store as unknown as { pool: Pool }).pool)
  : null;

const active = USE_POSTGRES ? pgVectorStore! : memoryVectorStore;
const oversample = (limit: number) => Math.min(300, limit * 3);

export const vectorStore: VectorStorePort = {
  async isAvailable() {
    return active.isAvailable();
  },

  async replaceProjectVectors(projectId, embeddingModel, records) {
    return active.replaceProjectVectors(projectId, embeddingModel, records);
  },

  async clearProjectVectors(projectId) {
    return active.clearProjectVectors(projectId);
  },

  async vectorStats() {
    return active.vectorStats();
  },

  async searchVectors(user, queryEmbedding, embeddingModel, projectId, limit) {
    const visible = await store.visibleProjectIds(user);
    // 领队可见全部；projectId 限定时直接交给底层
    if (projectId) {
      if (visible !== null && !visible.includes(projectId)) return [];
      const hits = await active.searchRaw(queryEmbedding, embeddingModel, projectId, limit);
      return hits;
    }
    if (visible === null) {
      return active.searchRaw(queryEmbedding, embeddingModel, null, limit);
    }
    // 可见项目逐一检索后合并（候选超采样保证排序正确）
    const merged: Array<AiSemanticHit & { projectId: string }> = [];
    for (const pid of visible) {
      const hits = await active.searchRaw(queryEmbedding, embeddingModel, pid, oversample(limit));
      for (const hit of hits) merged.push({ ...hit, projectId: pid });
    }
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, limit).filter((hit) => hit.score > 0.05);
  },
};
