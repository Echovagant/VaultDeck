import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyReply } from 'fastify';

import type { StoreUser } from '../../../application/ports/store.port';
import { createMfaChallenge, verifyMfaChallenge } from '../../../infrastructure/auth/mfa-challenge';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../../infrastructure/auth/totp';
import {
  atRestKey,
  openBuffer,
  openText,
  sealBuffer,
  sealText,
} from '../../../infrastructure/crypto/at-rest';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';

interface LoginBody {
  username: string;
  password: string;
}

const SESSION_COOKIE = 'vd_session';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
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

interface UpdateProfileBody {
  displayName: string;
}

const updateProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['displayName'],
  properties: {
    displayName: { type: 'string', minLength: 1, maxLength: 64 },
  },
};

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

const changePasswordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['currentPassword', 'newPassword'],
  properties: {
    currentPassword: { type: 'string', minLength: 1 },
    newPassword: { type: 'string', minLength: 8, maxLength: 256 },
  },
};

interface MfaVerifyBody {
  challengeToken: string;
  code: string;
}

const mfaVerifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['challengeToken', 'code'],
  properties: {
    challengeToken: { type: 'string', minLength: 1, maxLength: 4096 },
    code: { type: 'string', pattern: '^\\d{6}$' },
  },
};

interface MfaCodeBody {
  code: string;
}

const mfaCodeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: {
    code: { type: 'string', pattern: '^\\d{6}$' },
  },
};

interface MfaDisableBody {
  password: string;
  code: string;
}

const mfaDisableSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['password', 'code'],
  properties: {
    password: { type: 'string', minLength: 1, maxLength: 256 },
    code: { type: 'string', pattern: '^\\d{6}$' },
  },
};

const AVATAR_ROOT = path.resolve(process.env['VD_AVATAR_ROOT'] ?? '_private/storage/avatars');
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function avatarPath(userId: string): string {
  return path.join(AVATAR_ROOT, `${userId}.bin`);
}

function avatarMimePath(userId: string): string {
  return path.join(AVATAR_ROOT, `${userId}.mime`);
}

function avatarUrl(userId: string): string {
  return `/api/v1/auth/avatar/${userId}`;
}

function detectImageType(data: Buffer): { mime: string } | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return { mime: 'image/png' };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mime: 'image/jpeg' };
  }
  return null;
}

async function hasAvatar(userId: string): Promise<boolean> {
  try {
    const info = await stat(avatarPath(userId));
    return info.size > 0;
  } catch {
    return false;
  }
}

async function toPrincipal(user: StoreUser) {
  const base = {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
  return (await hasAvatar(user.userId)) ? { ...base, avatarUrl: avatarUrl(user.userId) } : base;
}

export function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function requireUser(header: string | undefined): Promise<StoreUser> {
  const token = readBearerToken(header);
  // Agent token（vdak_ 前缀）走授权体系，不进会话表；权限过滤在 store 层按授权范围执行
  if (token?.startsWith('vdak_')) {
    const identity = await store.userByAgentToken(token);
    if (!identity) {
      throw new DomainError('AUTH', 'VD-AUTH-401', 'Agent 令牌无效或已撤销', { status: 401 });
    }
    return identity.user;
  }
  const user = token ? await store.userByToken(token) : null;
  if (!user) {
    throw new DomainError('AUTH', 'VD-AUTH-401', '未登录或会话已失效', { status: 401 });
  }
  return user;
}

async function completeLogin(
  user: StoreUser,
  reply: FastifyReply,
  authMode: string | undefined,
  forwardedProto: string | undefined,
) {
  const token = await store.createSession(user.userId);
  const secure = forwardedProto === 'https' || process.env['VD_COOKIE_SECURE'] === 'true';
  reply.header('set-cookie', sessionCookie(token, SESSION_MAX_AGE_SECONDS, secure));
  const principal = await toPrincipal(user);
  // 浏览器使用 HttpOnly Cookie，不在响应体暴露 token；API 客户端仍可拿 Bearer token
  return authMode === 'cookie' ? principal : { token, ...principal };
}

@Injectable()
@Controller('auth')
export class AuthController {
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new StrictBodyPipe<LoginBody>(loginSchema)) body: LoginBody,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers('x-auth-mode') authMode?: string,
    @Headers('x-forwarded-proto') forwardedProto?: string,
  ) {
    const user = await store.verifyCredentials(body.username, body.password);
    if (!user) {
      throw new DomainError('AUTH', 'VD-AUTH-401', '用户名或口令不正确', { status: 401 });
    }

    const mfa = await store.mfaState(user.userId);
    if (mfa.enabled) {
      let challenge: { token: string; expiresInSeconds: number };
      try {
        challenge = createMfaChallenge(user.userId);
      } catch {
        throw new DomainError('SYS', 'VD-SYS-503', 'MFA 暂不可用：服务端未配置加密密钥', {
          status: 503,
        });
      }
      await store.recordAudit({
        actor: user,
        action: 'auth.mfa_challenge',
        objectType: 'user',
        objectId: user.userId,
        result: 'success',
        detail: user.username,
      });
      return {
        mfaRequired: true,
        challengeToken: challenge.token,
        expiresInSeconds: challenge.expiresInSeconds,
      };
    }

    await store.recordAudit({
      actor: user,
      action: 'auth.login',
      objectType: 'user',
      objectId: user.userId,
      result: 'success',
      detail: user.username,
    });

    return completeLogin(user, reply, authMode, forwardedProto);
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(
    @Body(new StrictBodyPipe<MfaVerifyBody>(mfaVerifySchema)) body: MfaVerifyBody,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers('x-auth-mode') authMode?: string,
    @Headers('x-forwarded-proto') forwardedProto?: string,
  ) {
    let userId: string | null;
    try {
      userId = verifyMfaChallenge(body.challengeToken);
    } catch {
      throw new DomainError('SYS', 'VD-SYS-503', 'MFA 暂不可用：服务端未配置加密密钥', {
        status: 503,
      });
    }
    if (!userId) {
      throw new DomainError('AUTH', 'VD-AUTH-401', 'MFA 挑战已失效，请重新登录', { status: 401 });
    }

    const user = await store.getUser(userId);
    if (!user || user.status !== 'active') {
      throw new DomainError('AUTH', 'VD-AUTH-401', '账号不可用', { status: 401 });
    }
    const state = await store.mfaState(user.userId);
    if (!state.enabled || !state.secret) {
      throw new DomainError('AUTH', 'VD-AUTH-401', 'MFA 未启用', { status: 401 });
    }

    let secret: string;
    try {
      secret = openText(state.secret);
    } catch {
      throw new DomainError('SYS', 'VD-SYS-503', 'MFA 密钥不可用，请联系管理员', { status: 503 });
    }
    if (!verifyTotp(secret, body.code)) {
      await store.recordAudit({
        actor: user,
        action: 'auth.mfa_failed',
        objectType: 'user',
        objectId: user.userId,
        result: 'denied',
        detail: user.username,
      });
      throw new DomainError('AUTH', 'VD-AUTH-401', '动态验证码不正确', { status: 401 });
    }

    await store.recordAudit({
      actor: user,
      action: 'auth.login',
      objectType: 'user',
      objectId: user.userId,
      result: 'success',
      detail: `${user.username} (mfa)`,
    });
    return completeLogin(user, reply, authMode, forwardedProto);
  }

  @Get('mfa')
  async mfaStatus(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    const state = await store.mfaState(user.userId);
    return { enabled: state.enabled };
  }

  @Post('mfa/setup')
  @HttpCode(200)
  async setupMfa(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    if (!atRestKey()) {
      throw new DomainError('SYS', 'VD-SYS-503', '未配置加密密钥，无法启用 MFA', {
        status: 503,
      });
    }
    const state = await store.mfaState(user.userId);
    if (state.enabled) {
      throw new DomainError('VAL', 'VD-VAL-409', 'MFA 已启用', { status: 409 });
    }

    const secret = generateTotpSecret();
    await store.setMfaSecret(user.userId, sealText(secret), false);
    await store.recordAudit({
      actor: user,
      action: 'auth.mfa_setup',
      objectType: 'user',
      objectId: user.userId,
      result: 'success',
      detail: 'secret generated',
    });
    return {
      secret,
      otpauthUrl: otpauthUrl('VaultDeck', user.username, secret),
    };
  }

  @Post('mfa/enable')
  @HttpCode(200)
  async enableMfa(
    @Body(new StrictBodyPipe<MfaCodeBody>(mfaCodeSchema)) body: MfaCodeBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const state = await store.mfaState(user.userId);
    if (state.enabled) {
      throw new DomainError('VAL', 'VD-VAL-409', 'MFA 已启用', { status: 409 });
    }
    if (!state.secret) {
      throw new DomainError('VAL', 'VD-VAL-001', '请先生成 MFA 密钥', { status: 400 });
    }
    let secret: string;
    try {
      secret = openText(state.secret);
    } catch {
      throw new DomainError('SYS', 'VD-SYS-503', 'MFA 密钥不可用，请重新生成', { status: 503 });
    }
    if (!verifyTotp(secret, body.code)) {
      throw new DomainError('AUTH', 'VD-AUTH-401', '动态验证码不正确', { status: 401 });
    }

    await store.setMfaSecret(user.userId, state.secret, true);
    await store.recordAudit({
      actor: user,
      action: 'auth.mfa_enable',
      objectType: 'user',
      objectId: user.userId,
      result: 'success',
      detail: user.username,
    });
    return { enabled: true };
  }

  @Post('mfa/disable')
  @HttpCode(200)
  async disableMfa(
    @Body(new StrictBodyPipe<MfaDisableBody>(mfaDisableSchema)) body: MfaDisableBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const verified = await store.verifyCredentials(user.username, body.password);
    if (!verified) {
      throw new DomainError('AUTH', 'VD-AUTH-401', '口令不正确', { status: 401 });
    }

    const state = await store.mfaState(user.userId);
    if (!state.enabled || !state.secret) {
      throw new DomainError('VAL', 'VD-VAL-409', 'MFA 未启用', { status: 409 });
    }
    let secret: string;
    try {
      secret = openText(state.secret);
    } catch {
      throw new DomainError('SYS', 'VD-SYS-503', 'MFA 密钥不可用，请联系管理员', { status: 503 });
    }
    if (!verifyTotp(secret, body.code)) {
      throw new DomainError('AUTH', 'VD-AUTH-401', '动态验证码不正确', { status: 401 });
    }

    await store.setMfaSecret(user.userId, null, false);
    const token = readBearerToken(authorization);
    if (token) await store.revokeOtherSessions(user.userId, token);
    await store.recordAudit({
      actor: user,
      action: 'auth.mfa_disable',
      objectType: 'user',
      objectId: user.userId,
      result: 'success',
      detail: user.username,
    });
    return { enabled: false };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = readBearerToken(authorization);
    if (token) await store.logout(token);
    reply.header('set-cookie', sessionCookie('', 0, false));
    return { ok: true };
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    return toPrincipal(user);
  }

  @Patch('me')
  async updateProfile(
    @Body(new StrictBodyPipe<UpdateProfileBody>(updateProfileSchema)) body: UpdateProfileBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const displayName = body.displayName.trim();
    if (displayName.length === 0) {
      throw new DomainError('VAL', 'VD-VAL-001', '显示名不能为空', { status: 400 });
    }

    const updated = await store.updateProfile(user.userId, displayName);
    await store.recordAudit({
      actor: user,
      action: 'user.profile_update',
      objectType: 'user',
      objectId: user.userId,
      result: 'success',
      detail: displayName,
    });
    return toPrincipal(updated);
  }

  @Put('password')
  @HttpCode(204)
  async changePassword(
    @Body(new StrictBodyPipe<ChangePasswordBody>(changePasswordSchema))
    body: ChangePasswordBody,
    @Headers('authorization') authorization?: string,
  ) {
    const token = readBearerToken(authorization);
    const user = await requireUser(authorization);
    const ok = await store.changePassword(user.userId, body.currentPassword, body.newPassword);
    if (!ok) {
      throw new DomainError('AUTH', 'VD-AUTH-002', '当前口令不正确', { status: 400 });
    }
    if (token) await store.revokeOtherSessions(user.userId, token);

    await store.recordAudit({
      actor: user,
      action: 'user.password_change',
      objectType: 'user',
      objectId: user.userId,
      result: 'success',
      detail: 'password changed',
    });
    return undefined;
  }

  @Post('avatar')
  @HttpCode(201)
  async uploadAvatar(@Body() body: Buffer, @Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);

    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new DomainError('VAL', 'VD-VAL-001', '头像内容为空', { status: 400 });
    }
    if (body.byteLength > MAX_AVATAR_BYTES) {
      throw new DomainError('VAL', 'VD-VAL-011', '头像不能超过 2 MB', { status: 400 });
    }

    const detected = detectImageType(body);
    if (!detected) {
      throw new DomainError('VAL', 'VD-VAL-012', '仅支持 PNG 或 JPEG 图片', { status: 415 });
    }

    await mkdir(AVATAR_ROOT, { recursive: true });
    const key = atRestKey();
    await writeFile(avatarPath(user.userId), key ? sealBuffer(body, key) : body);
    await writeFile(avatarMimePath(user.userId), detected.mime, 'utf8');

    await store.recordAudit({
      actor: user,
      action: 'user.avatar_update',
      objectType: 'user',
      objectId: user.userId,
      result: 'success',
      detail: detected.mime,
    });

    return { avatarUrl: avatarUrl(user.userId) };
  }

  @Delete('avatar')
  @HttpCode(204)
  async deleteAvatar(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    const existed = await hasAvatar(user.userId);
    await rm(avatarPath(user.userId), { force: true });
    await rm(avatarMimePath(user.userId), { force: true });
    if (existed) {
      await store.recordAudit({
        actor: user,
        action: 'user.avatar_delete',
        objectType: 'user',
        objectId: user.userId,
        result: 'success',
        detail: 'avatar removed',
      });
    }
    return undefined;
  }

  @Get('avatar/:userId')
  async getAvatar(
    @Param('userId') userId: string,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await requireUser(authorization);

    if (!(await hasAvatar(userId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '头像不存在', { status: 404 });
    }

    const mime = (await readFile(avatarMimePath(userId), 'utf8').catch(() => 'image/png')).trim();
    const data = openBuffer(await readFile(avatarPath(userId)));
    reply.header('content-type', mime || 'image/png');
    reply.header('cache-control', 'private, max-age=60');
    reply.header('content-length', String(data.length));
    return data;
  }
}
