/**
 * 向量存储端口：语义检索的向量与摘录存取。
 *
 * ## 双实现
 *
 * - 内存（infrastructure/vector/memory-vector-store.ts）：dev/demo 全可用。
 * - PostgreSQL（infrastructure/vector/pg-vector-store.ts）：依赖 pgvector 扩展；
 *   扩展缺失时 isAvailable() 返回 false，语义功能整体降级禁用，不影响其它功能。
 *
 * ## 密钥红线
 *
 * 向量与摘录是文件内容的衍生品，权限过滤在检索方法内完成（调用方传 user）。
 */
import type {
  AiSemanticHit,
  StoreUser,
  VectorRecordInput,
} from './vector.port.types';

export interface VectorStats {
  available: boolean;
  indexedFiles: number;
  chunks: number;
  model: string | null;
}

export interface VectorStorePort {
  /** 当前实现是否可用（内存 true；PG 需 pgvector 扩展） */
  isAvailable(): Promise<boolean>;
  /** 原子替换一个项目的全部向量（按 fileId+chunkIndex 覆盖，先删后插） */
  replaceProjectVectors(
    projectId: string,
    embeddingModel: string,
    records: VectorRecordInput[],
  ): Promise<number>;
  /**
   * 语义检索：在 model 匹配的向量里做余弦检索，只返回 user 可读文件的命中。
   * projectId 为 null 时在全部可见项目内检索。
   */
  searchVectors(
    user: StoreUser,
    queryEmbedding: readonly number[],
    embeddingModel: string,
    projectId: string | null,
    limit: number,
  ): Promise<AiSemanticHit[]>;
  /** 清除一个项目的向量（项目删除级联时调用） */
  clearProjectVectors(projectId: string): Promise<void>;
  /** 安装 pgvector 扩展（PG 实现）；内存实现恒返回已启用 */
  installVector(): Promise<{ ok: boolean; detail: string }>;
  /** 卸载 pgvector 扩展并清空向量数据 */
  uninstallVector(): Promise<{ ok: boolean; detail: string }>;
  vectorStats(): Promise<VectorStats>;
}

export type { AiSemanticHit, StoreUser, VectorRecordInput };
