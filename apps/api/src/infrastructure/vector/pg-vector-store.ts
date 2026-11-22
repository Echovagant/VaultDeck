/**
 * pgvector 向量存储：PostgreSQL + vector 扩展。
 *
 * ## 可用性
 *
 * CREATE EXTENSION IF NOT EXISTS vector 由本模块惰性尝试；扩展缺失（离线包默认
 * 不带 pgvector）时 isAvailable() = false，语义功能整体降级禁用——不影响其它功能。
 *
 * ## 设计取舍
 *
 * embedding 列不带维度（pgvector 允许），不同嵌入模型的维度都能存；
 * 不建 HNSW 索引（索引要求维度锁死），检索为精确余弦顺序扫描——
 * 单项目万级块以内够用；维度与索引在数据量成为瓶颈时再升级。
 */
import type { Pool } from 'pg';
import type { AiSemanticHit, VectorRecordInput, VectorStats } from '../../application/ports/vector.port.types';

export class PgVectorStore {
  private available: boolean | null = null;
  private schemaReady = false;

  constructor(private readonly pool: Pool) {}

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  private async ensureSchema(): Promise<boolean> {
    if (!(await this.isAvailable())) return false;
    if (this.schemaReady) return true;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS vector_chunk (
        project_id uuid NOT NULL,
        file_id uuid NOT NULL,
        file_name text NOT NULL,
        chunk_index integer NOT NULL,
        excerpt text NOT NULL,
        model text NOT NULL,
        embedding vector NOT NULL
      )
    `);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_vector_chunk_project ON vector_chunk (project_id)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_vector_chunk_model ON vector_chunk (model)');
    this.schemaReady = true;
    return true;
  }

  async replaceProjectVectors(
    projectId: string,
    embeddingModel: string,
    records: VectorRecordInput[],
  ): Promise<number> {
    if (!(await this.ensureSchema())) return 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM vector_chunk WHERE project_id = $1', [projectId]);
      for (const record of records) {
        await client.query(
          `INSERT INTO vector_chunk (project_id, file_id, file_name, chunk_index, excerpt, model, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
          [
            projectId,
            record.fileId,
            record.fileName,
            record.chunkIndex,
            record.excerpt,
            embeddingModel,
            `[${record.embedding.join(',')}]`,
          ],
        );
      }
      await client.query('COMMIT');
      return records.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 原始检索（含项目过滤 + 模型匹配），按距离排序；权限过滤在 facade 完成 */
  async searchRaw(
    queryEmbedding: readonly number[],
    embeddingModel: string,
    projectId: string | null,
    limit: number,
  ): Promise<AiSemanticHit[]> {
    if (!(await this.ensureSchema())) return [];
    const vectorLiteral = `[${queryEmbedding.join(',')}]::vector`;
    const result = projectId
      ? await this.pool.query(
          `SELECT file_id, file_name, chunk_index, excerpt,
                  1 - (embedding <=> $1::vector) AS score
             FROM vector_chunk
            WHERE project_id = $2 AND model = $3
            ORDER BY embedding <=> $1::vector
            LIMIT $4`,
          [vectorLiteral, projectId, embeddingModel, limit],
        )
      : await this.pool.query(
          `SELECT file_id, file_name, chunk_index, excerpt,
                  1 - (embedding <=> $1::vector) AS score
             FROM vector_chunk
            WHERE model = $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          [vectorLiteral, embeddingModel, limit],
        );
    return result.rows.map((row: { file_id: string; file_name: string; chunk_index: number; excerpt: string; score: string }) => ({
      fileId: row.file_id,
      fileName: row.file_name,
      chunkIndex: row.chunk_index,
      excerpt: row.excerpt,
      score: Number(row.score),
    }));
  }

  async clearProjectVectors(projectId: string): Promise<void> {
    if (!(await this.ensureSchema())) return;
    await this.pool.query('DELETE FROM vector_chunk WHERE project_id = $1', [projectId]);
  }

  async vectorStats(): Promise<VectorStats> {
    if (!(await this.ensureSchema())) {
      return { available: false, indexedFiles: 0, chunks: 0, model: null };
    }
    const result = await this.pool.query<{ files: string; chunks: string; model: string | null }>(
      'SELECT count(DISTINCT file_id)::text AS files, count(*)::text AS chunks, min(model) AS model FROM vector_chunk',
    );
    const row = result.rows[0];
    return {
      available: true,
      indexedFiles: Number(row?.files ?? 0),
      chunks: Number(row?.chunks ?? 0),
      model: row?.model ?? null,
    };
  }
}
