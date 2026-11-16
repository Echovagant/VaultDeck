import { Body, Controller, Get, Headers, HttpCode, Injectable, Post } from '@nestjs/common';

import type { StoreUser } from '../../../application/ports/store.port';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';

interface LoginBody {
  username: string;
  password: string;
}

const loginSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 256 },
  },
};

export function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function requireUser(header: string | undefined): Promise<StoreUser> {
  const token = readBearerToken(header);
  const user = token ? await store.userByToken(token) : null;
  if (!user) {
    throw new DomainError('AUTH', 'VD-AUTH-401', '未登录或会话已失效', { status: 401 });
  }
  return user;
}

@Injectable()
@Controller('auth')
export class AuthController {
  @Post('login')
  @HttpCode(200)
  async login(@Body(new StrictBodyPipe<LoginBody>(loginSchema)) body: LoginBody) {
    const result = await store.login(body.username, body.password);
    if (!result) {
      throw new DomainError('AUTH', 'VD-AUTH-401', '用户名或口令不正确', { status: 401 });
    }
    await store.recordAudit({
      actor: result.user,
      action: 'auth.login',
      objectType: 'user',
      objectId: result.user.userId,
      result: 'success',
      detail: result.user.username,
    });
    return {
      token: result.token,
      userId: result.user.userId,
      username: result.user.username,
      displayName: result.user.displayName,
      role: result.user.role,
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Headers('authorization') authorization?: string) {
    const token = readBearerToken(authorization);
    if (token) await store.logout(token);
    return { ok: true };
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    return {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
