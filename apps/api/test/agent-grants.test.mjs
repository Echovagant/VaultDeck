import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AGENT_CODE_TTL_MS,
  AGENT_TOKEN_PREFIX,
  agentCanAccessProject,
  agentCanReadFile,
  agentGrantIdFromUser,
  agentProjectScope,
  agentUserId,
  generateAgentCode,
  generateAgentToken,
  isAgentToken,
  isAgentUserId,
  sha256Hex,
  syntheticAgentUser,
} from '../src/infrastructure/auth/agent-grant.ts';

const ACTIVE_GRANT = {
  grantId: '11111111-1111-1111-1111-111111111111',
  name: '测试助手',
  role: 'DEPUTY_LEADER',
  scopeAll: false,
  projectIds: ['22222222-2222-2222-2222-222222222222'],
  readOnly: true,
  codeUsed: true,
  codeExpiresAt: null,
  hasToken: true,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-11-21T00:00:00.000Z',
  createdBy: '33333333-3333-3333-3333-333333333333',
};

describe('授权码与 token 生成', () => {
  it('授权码带 vda- 前缀，hash 一致，窗口 15 分钟', () => {
    const { code, codeHash, expiresAt } = generateAgentCode();
    assert.ok(code.startsWith('vda-'));
    assert.equal(codeHash, sha256Hex(code));
    assert.ok(expiresAt.getTime() - Date.now() > AGENT_CODE_TTL_MS - 5000);
  });

  it('token 带 vdak_ 前缀，hash 一致，isAgentToken 认得出', () => {
    const { token, tokenHash } = generateAgentToken();
    assert.ok(token.startsWith(AGENT_TOKEN_PREFIX));
    assert.equal(tokenHash, sha256Hex(token));
    assert.ok(isAgentToken(token));
    assert.equal(isAgentToken('session-token'), false);
  });
});

describe('合成用户', () => {
  it('userId 带 agent: 前缀且可还原 grantId', () => {
    const user = syntheticAgentUser(ACTIVE_GRANT);
    assert.ok(isAgentUserId(user.userId));
    assert.equal(agentGrantIdFromUser(user.userId), ACTIVE_GRANT.grantId);
    assert.equal(user.role, 'DEPUTY_LEADER');
    assert.equal(user.status, 'active');
  });
});

describe('范围判定', () => {
  it('scopeAll → null（全部）；指定范围 → 固定清单', () => {
    assert.equal(agentProjectScope({ scopeAll: true, projectIds: [] }), null);
    assert.deepEqual(
      agentProjectScope({ scopeAll: false, projectIds: ['p1'] }),
      ['p1'],
    );
  });

  it('canAccessProject：范围内通过，范围外拒绝，已撤销全拒', () => {
    assert.equal(agentCanAccessProject(ACTIVE_GRANT, '22222222-2222-2222-2222-222222222222'), true);
    assert.equal(agentCanAccessProject(ACTIVE_GRANT, '99999999-9999-9999-9999-999999999999'), false);
    assert.equal(
      agentCanAccessProject({ ...ACTIVE_GRANT, revokedAt: '2026-11-21T00:00:00.000Z' }, '22222222-2222-2222-2222-222222222222'),
      false,
    );
    assert.equal(
      agentCanAccessProject({ ...ACTIVE_GRANT, scopeAll: true }, '99999999-9999-9999-9999-999999999999'),
      true,
    );
  });
});

describe('文件读取判定', () => {
  const FILE = {
    projectId: '22222222-2222-2222-2222-222222222222',
    uploaderId: '44444444-4444-4444-4444-444444444444',
    status: 'active',
  };

  it('执行领队档：范围内全部可读，范围外不可读', () => {
    assert.equal(agentCanReadFile(ACTIVE_GRANT, FILE), true);
    assert.equal(
      agentCanReadFile(ACTIVE_GRANT, { ...FILE, projectId: '99999999-9999-9999-9999-999999999999' }),
      false,
    );
  });

  it('队员档：只能读自己（Agent）上传的文件', () => {
    const memberGrant = { ...ACTIVE_GRANT, role: 'MEMBER' };
    assert.equal(agentCanReadFile(memberGrant, FILE), false);
    assert.equal(
      agentCanReadFile(memberGrant, { ...FILE, uploaderId: agentUserId(ACTIVE_GRANT.grantId) }),
      true,
    );
  });

  it('非 active 文件一律不可读', () => {
    assert.equal(agentCanReadFile(ACTIVE_GRANT, { ...FILE, status: 'trashed' }), false);
  });
});
