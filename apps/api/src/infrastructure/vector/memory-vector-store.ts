/**
 * 内存向量存储：纯存储，不含权限（权限过滤在 facade 组合层完成，见 ../index.ts）。
 * dev/demo 全可用；向量与摘录都在内存，重启即清。
 * 余弦检索顺序扫描——万级块以下够用。
 */
import { cosineSimilarity } from '../../application/use-cases/chunk-text';
import type {
  AiSemanticHit,
  VectorRecordInput,
  VectorStats,
} from '../../application/ports/vector.port.types';

export interface StoredVector {
  projectId: string;
  fileId: string;
  fileName: string;
  chunkIndex: number;
  excerpt: string;
  embeddingModel: string;
  embedding: number[];
}

export class MemoryVectorStore {
  private readonly vectors: StoredVector[] = [];
  private model: string | null = null;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async replaceProjectVectors(
    projectId: string,
    embeddingModel: string,
    records: VectorRecordInput[],
  ): Promise<number> {
    this.model = embeddingModel;
    for (let i = this.vectors.length - 1; i >= 0; i -= 1) {
      if (this.vectors[i]!.projectId === projectId) this.vectors.splice(i, 1);
    }
    for (const record of records) {
      this.vectors.push({
        ...record,
        projectId,
        embeddingModel,
        embedding: [...record.embedding],
      });
    }
    return records.length;
  }

  /** 无权限概念的原始检索（model 匹配 + 项目过滤 + 余弦排序），权限由 facade 完成 */
  async searchRaw(
    queryEmbedding: readonly number[],
    embeddingModel: string,
    projectId: string | null,
    limit: number,
  ): Promise<AiSemanticHit[]> {
    if (this.model !== embeddingModel) return [];
    const hits: AiSemanticHit[] = [];
    for (const vector of this.vectors) {
      if (projectId && vector.projectId !== projectId) continue;
      hits.push({
        fileId: vector.fileId,
        fileName: vector.fileName,
        chunkIndex: vector.chunkIndex,
        excerpt: vector.excerpt,
        score: cosineSimilarity(queryEmbedding, vector.embedding),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit).filter((hit) => hit.score > 0.05);
  }

  async installVector(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: '内存实现无需安装，语义搜索始终可用' };
  }

  async uninstallVector(): Promise<{ ok: boolean; detail: string }> {
    this.vectors.length = 0;
    this.model = null;
    return { ok: true, detail: '内存向量已清空' };
  }

  async clearProjectVectors(projectId: string): Promise<void> {
    for (let i = this.vectors.length - 1; i >= 0; i -= 1) {
      if (this.vectors[i]!.projectId === projectId) this.vectors.splice(i, 1);
    }
  }

  async vectorStats(): Promise<VectorStats> {
    const fileIds = new Set(this.vectors.map((v) => v.fileId));
    return {
      available: true,
      indexedFiles: fileIds.size,
      chunks: this.vectors.length,
      model: this.model,
    };
  }
}

export const memoryVectorStore = new MemoryVectorStore();
