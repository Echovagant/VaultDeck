/**
 * 文件分享（限时外链）控制器。
 *
 * ## 安全模型（用户裁定）
 *
 * - 链接只对局域网来源生效：下载请求来源 IP 非私网一律 403（公网不可用）。
 * - 创建限领队 / 执行领队，且只能分享自己可读的文件。
 * - 令牌库存 hash、限时（1~168 小时）、可撤销、创建与访问全程审计。
 */
import { Body, Controller, Delete, Get, Headers, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ShareView } from '../../../application/ports/share.port';
import { isLanSourceIp } from '../../../infrastructure/share/share-core';
import { sharePort } from '../../../infrastructure/share/share-facade';
import { objectStorage } from '../../../infrastructure/memory/upload-sessions';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

interface ShareCreateBody {
  fileId: string;
  expiresHours: number;
}

const shareCreateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileId', 'expiresHours'],
  properties: {
    fileId: { type: 'string', format: 'uuid' },
    expiresHours: { type: 'integer', minimum: 1, maximum: 168 },
  },
};

function clientIpOf(request: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  // 开发直连时 request.ip 可靠；经 Nginx 反代时取 X-Real-IP（setup 生成的 nginx.conf 会设置）
  const forwarded = request.headers['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();
  return request.ip ?? '';
}

function lanGuard(ip: string): void {
  if (!isLanSourceIp(ip)) {
    throw new DomainError('AUTH', 'VD-SHARE-403', '分享链接仅限局域网访问', { status: 403 });
  }
}

@Controller()
export class ShareController {
  @Post('shares')
  async create(
    @Body(new StrictBodyPipe<ShareCreateBody>(shareCreateSchema)) body: ShareCreateBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role === 'MEMBER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }
    const file = await store.getFile(body.fileId);
    if (!file || !(await store.canReadFile(user, file))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件不存在', { status: 404 });
    }
    if (!file.objectPath) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件内容不存在，无法分享', { status: 404 });
    }

    const { view, secret } = await sharePort.createShare({
      fileId: file.fileId,
      fileName: file.fileName,
      projectId: file.projectId,
      hours: body.expiresHours,
      createdBy: user,
    });
    await store.recordAudit({
      actor: user,
      action: 'share.create',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: JSON.stringify({ fileName: file.fileName, expiresHours: body.expiresHours }),
    });
    // 令牌明文只此一次；完整下载地址拼给创建者（同主机路径）
    return {
      ...view,
      token: secret.token,
      expiresAt: secret.expiresAt,
      url: `/api/v1/share/${secret.token}`,
    };
  }

  @Get('shares')
  async list(@Headers('authorization') authorization?: string): Promise<ShareView[]> {
    const user = await requireUser(authorization);
    return sharePort.listShares(user.role === 'LEADER' ? null : user.userId);
  }

  @Delete('shares/:shareId')
  async revoke(
    @Param('shareId') shareId: string,
    @Headers('authorization') authorization?: string,
  ): Promise<ShareView | null> {
    const user = await requireUser(authorization);
    return sharePort.revokeShare(shareId, user);
  }

  /** 公开下载：凭令牌 + 局域网来源（来源 IP 非私网一律 403）；无需登录 */
  @Get('share/:token')
  async download(
    @Param('token') token: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    lanGuard(clientIpOf(request));
    const download = await sharePort.resolveShareToken(token, clientIpOf(request));
    if (!download) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '分享不存在或已失效', { status: 404 });
    }
    await store.recordAudit({
      actor: {
        userId: 'share-download',
        username: 'share-download',
        displayName: '分享下载',
        role: 'MEMBER',
        status: 'active',
      },
      action: 'share.download',
      objectType: 'file',
      objectId: download.fileId,
      result: 'success',
      detail: JSON.stringify({ fileName: download.fileName, ip: clientIpOf(request) }),
    });
    reply.status(200);
    reply.header('content-type', download.contentType || 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(download.fileName)}"`);
    const size = await objectStorage.plaintextSize(download.objectPath).catch(() => download.sizeBytes);
    reply.header('content-length', String(size));
    return await objectStorage.openRange(download.objectPath, 0, Math.max(0, size - 1));
  }
}
