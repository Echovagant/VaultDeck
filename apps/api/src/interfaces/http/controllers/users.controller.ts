import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';

import type { RoleCode, UpdateUserInput } from '../../../application/ports/store.port';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser, readBearerToken } from './auth.controller';

interface CreateUserBody {
  username: string;
  displayName: string;
  role: RoleCode;
  password: string;
}

const createUserSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'displayName', 'role', 'password'],
  properties: {
    username: { type: 'string', minLength: 3, maxLength: 64 },
    displayName: { type: 'string', minLength: 1, maxLength: 64 },
    role: { type: 'string', enum: ['LEADER', 'DEPUTY_LEADER', 'MEMBER'] },
    password: { type: 'string', minLength: 8, maxLength: 256 },
  },
};

interface UpdateUserBody {
  displayName?: string;
  role?: RoleCode;
  status?: 'active' | 'disabled';
  password?: string;
}

const updateUserSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    displayName: { type: 'string', minLength: 1, maxLength: 64 },
    role: { type: 'string', enum: ['LEADER', 'DEPUTY_LEADER', 'MEMBER'] },
    status: { type: 'string', enum: ['active', 'disabled'] },
    password: { type: 'string', minLength: 8, maxLength: 256 },
  },
};

function conflict(message: string): DomainError {
  return new DomainError('VAL', 'VD-VAL-002', message, { status: 409 });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

@Controller('users')
export class UsersController {
  @Get()
  async list(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }
    return { items: await store.listUsers() };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new StrictBodyPipe<CreateUserBody>(createUserSchema)) body: CreateUserBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    try {
      const created = await store.createUser(body);
      await store.recordAudit({
        actor: user,
        action: 'user.create',
        objectType: 'user',
        objectId: created.userId,
        result: 'success',
        detail: created.username,
      });
      return created;
    } catch (error) {
      if (error instanceof Error && error.message === 'USERNAME_TAKEN') {
        throw conflict('用户名已存在');
      }
      if (isUniqueViolation(error)) throw conflict('用户名已存在');
      throw error;
    }
  }

  @Patch(':userId')
  async update(
    @Param('userId') userId: string,
    @Body(new StrictBodyPipe<UpdateUserBody>(updateUserSchema)) body: UpdateUserBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }
    if (!(await store.getUser(userId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '用户不存在', { status: 404 });
    }

    const input: UpdateUserInput = { userId };
    if (body.displayName !== undefined) input.displayName = body.displayName;
    if (body.role !== undefined) input.role = body.role;
    if (body.status !== undefined) input.status = body.status;
    if (body.password !== undefined) input.password = body.password;

    const updated = await store.updateUser(input);
    if (body.password !== undefined) {
      if (userId === user.userId) {
        const token = readBearerToken(authorization);
        if (token) await store.revokeOtherSessions(userId, token);
      } else {
        await store.revokeAllSessions(userId);
      }
    }
    await store.recordAudit({
      actor: user,
      action: body.password !== undefined ? 'user.password_reset' : 'user.update',
      objectType: 'user',
      objectId: updated.userId,
      result: 'success',
      detail:
        body.password !== undefined
          ? `${updated.username} password reset`
          : `${updated.username} status=${updated.status} role=${updated.role}`,
    });
    return updated;
  }
}
