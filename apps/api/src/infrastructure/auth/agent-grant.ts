/**
 * Agent 授权的纯逻辑：授权码 / token 生成与校验、合成用户、范围判定。
 *
 * ## 纯模块约束
 *
 * node --test 直跑本文件做单元测试：运行时只依赖 node:crypto，其余全部是类型 import。
 * 持久化（内存 / PG）由 store 实现各自接线，这里不碰 store。
 *
 * ## 密钥红线
 *
 * 授权码（vda-）与访问 token（vdak_）明文只在生成时返回一次给调用方，
 * 库里永远只存 sha256；本模块不落盘、不打日志。
 */
import { createHash, randomBytes } from 'node:crypto';

import type { AgentGrantRole, AgentGrantView, StoreUser } from '../../application/ports/store.port';

/** 授权码可兑换窗口：领队创建后 15 分钟内有效 */
export const AGENT_CODE_TTL_MS = 15 * 60 * 1000;

/** Agent token 前缀：requireUser 据此分流到授权体系而不是会话表 */
export const AGENT_TOKEN_PREFIX = 'vdak_';

/** 授权码前缀 */
export const AGENT_CODE_PREFIX = 'vda-';

/** 合成用户 id 前缀：store 的权限方法据此走授权范围分支 */
export const AGENT_USER_PREFIX = 'agent:';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface GeneratedAgentCode {
  code: string;
  codeHash: string;
  expiresAt: Date;
}

/** 生成一次性授权码：明文只此一份，库存 hash，15 分钟兑换窗口 */
export function generateAgentCode(): GeneratedAgentCode {
  const code = `${AGENT_CODE_PREFIX}${randomBytes(12).toString('base64url')}`;
  return { code, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + AGENT_CODE_TTL_MS) };
}

export interface GeneratedAgentToken {
  token: string;
  tokenHash: string;
}

/** 生成访问 token：明文只此一份（兑换响应），库存 hash */
export function generateAgentToken(): GeneratedAgentToken {
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: sha256Hex(token) };
}

export function isAgentToken(token: string): boolean {
  return token.startsWith(AGENT_TOKEN_PREFIX);
}

/** Agent 合成用户 id：agent:<grantId> */
export function agentUserId(grantId: string): string {
  return `${AGENT_USER_PREFIX}${grantId}`;
}

export function isAgentUserId(userId: string): boolean {
  return userId.startsWith(AGENT_USER_PREFIX);
}

export function agentGrantIdFromUser(userId: string): string | null {
  return isAgentUserId(userId) ? userId.slice(AGENT_USER_PREFIX.length) : null;
}

/** Agent 请求出现在审计日志里的身份（不与真实账号混淆） */
export function syntheticAgentUser(grant: {
  grantId: string;
  name: string;
  role: AgentGrantRole;
}): StoreUser {
  return {
    userId: agentUserId(grant.grantId),
    username: `agent:${grant.name}`,
    displayName: grant.name,
    role: grant.role,
    status: 'active',
  };
}

/** Agent 可见项目范围：scopeAll → null（全部），否则固定清单 */
export function agentProjectScope(grant: {
  scopeAll: boolean;
  projectIds: string[];
}): string[] | null {
  return grant.scopeAll ? null : [...grant.projectIds];
}

export function agentCanAccessProject(grant: AgentGrantView, projectId: string): boolean {
  if (grant.revokedAt) return false;
  return grant.scopeAll || grant.projectIds.includes(projectId);
}

/**
 * Agent 读文件判定：范围内；DEPUTY_LEADER 档读全部，MEMBER 档只读自己上传的
 * （角色语义与产品内一致，不给 Agent 特权）。
 */
export function agentCanReadFile(
  grant: AgentGrantView,
  file: { projectId: string; uploaderId: string; status: string },
): boolean {
  if (file.status !== 'active') return false;
  if (!agentCanAccessProject(grant, file.projectId)) return false;
  if (grant.role === 'DEPUTY_LEADER') return true;
  return file.uploaderId === agentUserId(grant.grantId);
}
