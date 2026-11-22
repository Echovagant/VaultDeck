/**
 * 分享/外链的纯逻辑：令牌生成、来源 IP 私网判定、过期/撤销判定。
 *
 * ## 纯模块约束（同 parse-natural-search）
 *
 * node --test 靠 Node 24 类型剥离直跑：零运行时 import，全部自包含。
 *
 * ## 用户裁定的安全模型
 *
 * 链接只对**局域网来源**生效：下载请求的来源 IP 必须是私网段
 * （10.x / 172.16-31.x / 192.168.x / 127.x / ::1）——公网来源一律 403。
 * 链接本身仍限时 + 可撤销 + 全程审计；令牌库存 hash 不存明文。
 */
import { createHash, randomBytes } from 'node:crypto';

const SHARE_TOKEN_PREFIX = 'vds-';
export const SHARE_DEFAULT_HOURS = 24;
export const SHARE_MAX_HOURS = 168;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface GeneratedShareToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/** 生成一次性分享令牌（vds- 前缀），expiresAt 由调用方按 hours 计算 */
export function generateShareToken(hours: number): GeneratedShareToken {
  const token = `${SHARE_TOKEN_PREFIX}${randomBytes(18).toString('base64url')}`;
  const clamped = Math.min(SHARE_MAX_HOURS, Math.max(1, hours));
  return {
    token,
    tokenHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + clamped * 3600000),
  };
}

export function isShareToken(token: string): boolean {
  return token.startsWith(SHARE_TOKEN_PREFIX);
}

/**
 * 来源 IP 是否为局域网（私网段）。
 * 接受 IPv4 点分与 IPv6 回环/链路本地； IPv6 私网（fc00::/7）也算局域网。
 */
export function isLanSourceIp(ip: string): boolean {
  const value = (ip ?? '').trim().replace(/^::ffff:/, '');
  if (!value) return false;
  if (value === '::1' || value === '127.0.0.1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true; // IPv6 ULA fc00::/7
  if (value.startsWith('fe80:')) return true; // IPv6 链路本地
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // 链路本地
  return false;
}

export interface ShareValidityInput {
  revoked: boolean;
  expiresAt: string | null;
  now?: Date;
}

/** 分享是否仍有效（未撤销、未过期） */
export function isShareActive(share: ShareValidityInput, now: Date = new Date()): boolean {
  if (share.revoked) return false;
  if (!share.expiresAt) return false;
  return new Date(share.expiresAt).getTime() > now.getTime();
}
