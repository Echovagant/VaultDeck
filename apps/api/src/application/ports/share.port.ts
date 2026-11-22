/**
 * 文件分享（限时外链）端口。
 *
 * ## 用户裁定的安全模型
 *
 * 链接只对局域网来源生效（来源 IP 私网校验，公网来源 403）；令牌库存 hash、
 * 限时、可撤销；创建与访问全程审计。分享的是「文件当前内容」，撤销后立即失效。
 */
import type { StoreUser } from './store.port';

export interface ShareView {
  shareId: string;
  fileId: string;
  fileName: string;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  downloadCount: number;
}

export interface CreateShareInput {
  fileId: string;
  fileName: string;
  projectId: string;
  hours: number;
  createdBy: StoreUser;
}

export interface ShareSecret {
  shareId: string;
  token: string;
  expiresAt: string;
}

export interface ShareDownload {
  fileId: string;
  fileName: string;
  contentType: string;
  objectPath: string;
  sizeBytes: number;
  downloadedByIp: string;
}

export interface SharePort {
  createShare(input: CreateShareInput): Promise<{ view: ShareView; secret: ShareSecret }>;
  listShares(createdBy: string | null): Promise<ShareView[]>;
  revokeShare(shareId: string, user: StoreUser): Promise<ShareView | null>;
  /** 用令牌取可下载文件；无效/过期/已撤销返回 null。命中记 downloadCount 与 lastUsedAt */
  resolveShareToken(token: string, clientIp: string): Promise<ShareDownload | null>;
}
