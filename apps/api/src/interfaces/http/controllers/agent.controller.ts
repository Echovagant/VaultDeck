import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';

import type { AgentGrantView } from '../../../application/ports/store.port';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

interface CreateGrantBody {
  name: string;
  role: 'DEPUTY_LEADER' | 'MEMBER';
  scopeAll: boolean;
  projectIds: string[];
  readOnly: boolean;
}

const createGrantSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'role', 'scopeAll', 'readOnly'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 64 },
    role: { type: 'string', enum: ['DEPUTY_LEADER', 'MEMBER'] },
    scopeAll: { type: 'boolean' },
    projectIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 100 },
    readOnly: { type: 'boolean' },
  },
};

interface RevokeGrantBody {
  revoked: boolean;
}

const revokeGrantSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['revoked'],
  properties: {
    revoked: { type: 'boolean', enum: [true] },
  },
};

interface ExchangeTokenBody {
  code: string;
}

const exchangeTokenSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: {
    code: { type: 'string', minLength: 4, maxLength: 80 },
  },
}

@Controller('agent')
export class AgentController {
  @Post('grants')
  async createGrant(
    @Body(new StrictBodyPipe<CreateGrantBody>(createGrantSchema)) body: CreateGrantBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const isLeader = user.role === 'LEADER';

    // 权限上限：非领队创建的授权不得高于本人权限
    //   队员 → 只能建队员档；执行领队 → 本档或队员档
    //   范围 → 只能是自己参与的项目，不允许「全部项目」
    let role = body.role;
    if (!isLeader && role === 'DEPUTY_LEADER' && user.role === 'MEMBER') {
      throw new DomainError('VAL', 'VD-VAL-012', '队员只能创建队员档位的授权', { status: 400 });
    }
    let scopeAll = body.scopeAll;
    let projectIds = scopeAll ? [] : (body.projectIds ?? []);
    if (!isLeader) {
      if (scopeAll) {
        throw new DomainError('VAL', 'VD-VAL-012', '仅领队可创建全部项目范围的授权', { status: 400 });
      }
      const mine = await store.memberProjectIds(user.userId);
      const outside = projectIds.filter((id) => !mine.includes(id));
      if (outside.length > 0) {
        throw new DomainError('VAL', 'VD-VAL-012', '授权范围超出你参与的项目', { status: 400 });
      }
    }
    if (!scopeAll && projectIds.length === 0) {
      throw new DomainError('VAL', 'VD-VAL-001', '指定范围时至少选择一个项目', { status: 400 });
    }
    if (scopeAll) {
      const known = new Set((await store.listProjects()).map((p) => p.projectId));
      // scopeAll 时 projectIds 为空，这里兜底校验防御直传
      projectIds = projectIds.filter((id) => known.has(id));
    }

    const { view, secret } = await store.createAgentGrant({
      name: body.name.trim(),
      role,
      scopeAll,
      projectIds,
      readOnly: body.readOnly,
      createdBy: user.userId,
    });
    await store.recordAudit({
      actor: user,
      action: 'agent.grant.create',
      objectType: 'agent_grant',
      objectId: view.grantId,
      result: 'success',
      // 审计红线：授权码明文不进日志
      detail: JSON.stringify({
        name: view.name,
        role: view.role,
        readOnly: view.readOnly,
        scopeAll: view.scopeAll,
        creatorRole: user.role,
      }),
    });
    // 授权码明文只此一次返回，之后库里只有 hash
    return { ...view, code: secret.code, codeExpiresAt: secret.expiresAt };
  }

  @Get('grants')
  async listGrants(@Headers('authorization') authorization?: string): Promise<AgentGrantView[]> {
    const user = await requireUser(authorization);
    // 领队看全部；其他角色只看自己创建的授权
    return store.listAgentGrants(user.role === 'LEADER' ? undefined : user.userId);
  }

  @Patch('grants/:grantId')
  async revokeGrant(
    @Param('grantId') grantId: string,
    @Body(new StrictBodyPipe<RevokeGrantBody>(revokeGrantSchema)) _body: RevokeGrantBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const isLeader = user.role === 'LEADER';
    // 非领队只能撤销自己创建的授权；不存在于本人清单 = 无权操作
    if (!isLeader) {
      const own = (await store.listAgentGrants(user.userId)).some((g) => g.grantId === grantId);
      if (!own) {
        throw new DomainError('AUTH', 'VD-AUTH-404', '授权不存在或无权操作', { status: 404 });
      }
    }

    const revoked = await store.revokeAgentGrant(grantId);
    if (!revoked) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '授权不存在或已撤销', { status: 404 });
    }
    await store.recordAudit({
      actor: user,
      action: 'agent.grant.revoke',
      objectType: 'agent_grant',
      objectId: revoked.grantId,
      result: 'success',
      detail: revoked.name,
    });
    return revoked;
  }

  /** 持授权码即身份：公开端点（Skill / Agent 平台的安装指令用它换 token） */
  @Post('token')
  @HttpCode(200)
  async exchangeToken(
    @Body(new StrictBodyPipe<ExchangeTokenBody>(exchangeTokenSchema)) body: ExchangeTokenBody,
  ) {
    const issued = await store.exchangeAgentCode(body.code.trim());
    if (!issued) {
      throw new DomainError('VAL', 'VD-VAL-013', '授权码无效、已使用或已过期', { status: 400 });
    }

    const creatorId = await this.grantCreatorId(issued.grantId);
    const creator = creatorId ? await store.getUser(creatorId) : null;
    await store.recordAudit({
      actor: creator ?? {
        userId: 'system',
        username: 'system',
        displayName: '系统',
        role: 'LEADER',
        status: 'active',
      },
      action: 'agent.token.exchange',
      objectType: 'agent_grant',
      objectId: issued.grantId,
      result: 'success',
      // 审计红线：token 明文不进日志
      detail: JSON.stringify({ name: issued.displayName, role: issued.role }),
    });
    // token 明文只此一次返回给 Agent
    return issued;
  }

  /** 兑换时 grant 已消费成 token 记录，creator 从授权列表回查 */
  private async grantCreatorId(grantId: string): Promise<string | null> {
    const grants = await store.listAgentGrants();
    return grants.find((grant) => grant.grantId === grantId)?.createdBy ?? null;
  }
}
