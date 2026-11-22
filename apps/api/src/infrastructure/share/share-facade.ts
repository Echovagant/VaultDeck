/**
 * 分享存储 facade：内存/PG 双实现 + 权限与审计在这里收口。
 *
 * ## 权限模型
 *
 * - 创建：领队 / 执行领队可对**自己可读的文件**建分享；队员不可（外链是管理动作）。
 * - 列表：创建者看自己的；领队看全部。
 * - 撤销：创建者本人或领队。
 * - 下载：公开端点，凭令牌 + 来源 IP 必须私网（公网 403）。
 */
import type { Pool } from 'pg';

import type {
  CreateShareInput,
  ShareDownload,
  SharePort,
  ShareSecret,
  ShareView,
} from '../../application/ports/share.port';
import type { StoreUser } from '../../application/ports/store.port';
import {
  generateShareToken,
  isShareActive,
  sha256Hex,
} from '../share/share-core';
import { store } from '../store';

interface ShareRecord {
  shareId: string;
  fileId: string;
  projectId: string;
  fileName: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  downloadCount: number;
  createdAt: string;
  createdBy: string;
  creatorName: string;
}

const USE_POSTGRES = process.env['VD_STORE'] === 'postgres';

class MemoryShareStore {
  private readonly shares: ShareRecord[] = [];

  create(record: ShareRecord): void {
    this.shares.unshift(record);
  }

  list(createdBy: string | null): ShareRecord[] {
    return this.shares.filter((s) => !createdBy || s.createdBy === createdBy);
  }

  byId(shareId: string): ShareRecord | undefined {
    return this.shares.find((s) => s.shareId === shareId);
  }

  byTokenHash(tokenHash: string): ShareRecord | undefined {
    return this.shares.find((s) => s.tokenHash === tokenHash);
  }

  revoke(shareId: string): boolean {
    const record = this.byId(shareId);
    if (!record || record.revokedAt) return false;
    record.revokedAt = new Date().toISOString();
    return true;
  }

  countDownload(shareId: string): void {
    const record = this.byId(shareId);
    if (record) record.downloadCount += 1;
  }
}

const memoryShares = new MemoryShareStore();

function toView(record: ShareRecord): ShareView {
  return {
    shareId: record.shareId,
    fileId: record.fileId,
    fileName: record.fileName,
    createdBy: record.createdBy,
    creatorName: record.creatorName,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revoked: Boolean(record.revokedAt),
    downloadCount: record.downloadCount,
  };
}

class PgShareStore {
  constructor(private readonly pool: Pool) {}

  async create(record: ShareRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO file_share (share_id, file_id, project_id, token_hash, expires_at, download_count, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [record.shareId, record.fileId, record.projectId, record.tokenHash, record.expiresAt, record.downloadCount, record.createdBy, record.createdAt],
    );
  }

  async list(createdBy: string | null): Promise<ShareRecord[]> {
    const sql = createdBy
      ? 'SELECT s.*, u.display_name AS creator_name FROM file_share s LEFT JOIN app_user u ON u.user_id = s.created_by WHERE s.created_by = $1 ORDER BY s.created_at DESC'
      : 'SELECT s.*, u.display_name AS creator_name FROM file_share s LEFT JOIN app_user u ON u.user_id = s.created_by ORDER BY s.created_at DESC';
    const result = await this.pool.query(sql, createdBy ? [createdBy] : []);
    return result.rows.map((row: Record<string, unknown>) => ({
      shareId: String(row.share_id),
      fileId: String(row.file_id),
      projectId: String(row.project_id),
      fileName: String(row.file_name ?? ''),
      tokenHash: String(row.token_hash),
      expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
      revokedAt: row.revoked_at instanceof Date ? row.revoked_at.toISOString() : (row.revoked_at ? String(row.revoked_at) : null),
      downloadCount: Number(row.download_count ?? 0),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      createdBy: String(row.created_by),
      creatorName: String(row.creator_name ?? ''),
    }));
  }

  async revoke(shareId: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE file_share SET revoked_at = now() WHERE share_id = $1 AND revoked_at IS NULL',
      [shareId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async byTokenHash(tokenHash: string): Promise<ShareRecord | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT s.*, u.display_name AS creator_name FROM file_share s
        LEFT JOIN app_user u ON u.user_id = s.created_by
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      shareId: String(row.share_id),
      fileId: String(row.file_id),
      projectId: String(row.project_id),
      fileName: String(row.file_name ?? ''),
      tokenHash: String(row.token_hash),
      expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
      revokedAt: row.revoked_at instanceof Date ? row.revoked_at.toISOString() : (row.revoked_at ? String(row.revoked_at) : null),
      downloadCount: Number(row.download_count ?? 0),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      createdBy: String(row.created_by),
      creatorName: String(row.creator_name ?? ''),
    };
  }

  async countDownload(shareId: string): Promise<void> {
    await this.pool.query('UPDATE file_share SET download_count = download_count + 1 WHERE share_id = $1', [shareId]);
  }
}

const pgShares = USE_POSTGRES ? new PgShareStore((store as unknown as { pool: Pool }).pool) : null;

class ShareFacade implements SharePort {
  private active(): { create: (r: ShareRecord) => Promise<void>; list: (cb: string | null) => Promise<ShareRecord[]>; revoke: (id: string) => Promise<boolean>; byTokenHash: (h: string) => Promise<ShareRecord | undefined>; countDownload: (id: string) => Promise<void> } {
    if (pgShares) return pgShares;
    return {
      create: (r) => (memoryShares.create(r), Promise.resolve()),
      list: (cb) => Promise.resolve(memoryShares.list(cb)),
      revoke: (id) => Promise.resolve(memoryShares.revoke(id)),
      byTokenHash: (h) => Promise.resolve(memoryShares.byTokenHash(h)),
      countDownload: (id) => Promise.resolve(memoryShares.countDownload(id)),
    };
  }

  async createShare(input: CreateShareInput): Promise<{ view: ShareView; secret: ShareSecret }> {
    const { token, tokenHash, expiresAt } = generateShareToken(input.hours);
    const record: ShareRecord = {
      shareId: crypto.randomUUID(),
      fileId: input.fileId,
      projectId: input.projectId,
      fileName: input.fileName,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      downloadCount: 0,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy.userId,
      creatorName: input.createdBy.displayName,
    };
    await this.active().create(record);
    return {
      view: toView(record),
      secret: { shareId: record.shareId, token, expiresAt: record.expiresAt },
    };
  }

  async listShares(createdBy: string | null): Promise<ShareView[]> {
    const records = await this.active().list(createdBy);
    return records.map(toView);
  }

  async revokeShare(shareId: string, user: StoreUser): Promise<ShareView | null> {
    const all = await this.active().list(user.role === 'LEADER' ? null : user.userId);
    const target = all.find((s) => s.shareId === shareId);
    if (!target) return null;
    const revoked = await this.active().revoke(shareId);
    if (!revoked) return null;
    return { ...target, revoked: true };
  }

  async resolveShareToken(token: string, clientIp: string): Promise<ShareDownload | null> {
    const record = await this.active().byTokenHash(sha256Hex(token));
    if (!record || !isShareActive({ revoked: Boolean(record.revokedAt), expiresAt: record.expiresAt })) return null;
    const file = await store.getFile(record.fileId);
    if (!file || file.status !== 'active' || !file.objectPath) return null;
    await this.active().countDownload(record.shareId);
    return {
      fileId: file.fileId,
      fileName: file.fileName,
      contentType: file.contentType,
      objectPath: file.objectPath,
      sizeBytes: file.sizeBytes,
      downloadedByIp: clientIp,
    };
  }
}

export const sharePort: SharePort = new ShareFacade();
export { toView };
