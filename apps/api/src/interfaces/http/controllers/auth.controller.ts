import { Body, Controller, Get, Headers, Injectable, Post } from '@nestjs/common';

import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { memoryStore, type MemoryUser } from '../../../infrastructure/memory/memory-store';

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

export function requireUser(header: string | undefined): MemoryUser {
  const token = readBearerToken(header);
  const user = token ? memoryStore.userByToken(token) : null;
  if (!user) {
    throw new DomainError('AUTH', 'VD-AUTH-401', '未登录或会话已失效', { status: 401 });
  }
  return user;
}

@Injectable()
@Controller('auth')
export class AuthController {
  @Post('login')
  login(@Body(new StrictBodyPipe<LoginBody>(loginSchema)) body: LoginBody) {
    const result = memoryStore.login(body.username, body.password);
    if (!result) {
      throw new DomainError('AUTH', 'VD-AUTH-401', '用户名或口令不正确', { status: 401 });
    }
    return {
      token: result.token,
      userId: result.user.userId,
      username: result.user.username,
      displayName: result.user.displayName,
      role: result.user.role,
    };
  }

  @Post('logout')
  logout(@Headers('authorization') authorization?: string) {
    const token = readBearerToken(authorization);
    if (token) memoryStore.logout(token);
    return { ok: true };
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    const user = requireUser(authorization);
    return {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
