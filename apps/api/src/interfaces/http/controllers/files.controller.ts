import { Controller, Delete, Get, Headers, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { store } from '../../../infrastructure/store';
import { objectStorage } from '../../../infrastructure/memory/upload-sessions';
import { DomainError } from '../errors/problem-details';
import { toPublicFile } from '../presenters/file.presenter';
import { requireUser } from './auth.controller';

@Controller('files')
export class FilesController {
  @Get()
  async list(
    @Query('projectId') projectId: string | undefined,
    @Query('folderId') folderId: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (!projectId) {
      throw new DomainError('VAL', 'VD-VAL-001', '缺少 projectId 参数', { status: 400 });
    }
    if (!(await store.canAccessProject(user, projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }

    const files = await store.listFiles(projectId);
    const items = [];
    for (const file of files) {
      if (folderId && file.folderId !== folderId) continue;
      if (!(await store.canReadFile(user, file))) continue;
      items.push(toPublicFile(file));
    }
    items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return { items, total: items.length };
  }

  @Delete(':fileId')
  async remove(@Param('fileId') fileId: string, @Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    const file = await store.getFile(fileId);
    if (!file || !(await store.canDeleteFile(user, file))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件不存在', { status: 404 });
    }
    await store.trashFile(user, file);
    return { ok: true };
  }

  @Get(':fileId/content')
  async content(
    @Param('fileId') fileId: string,
    @Headers('range') rangeHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await requireUser(authorization);

    const file = await store.getFile(fileId);
    if (!file || !(await store.canReadFile(user, file))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件不存在', { status: 404 });
    }
    if (!file.objectPath) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件内容不存在', { status: 404 });
    }

    await store.recordAudit({
      actor: user,
      action: 'file.download',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });

    const size = file.sizeBytes;
    let start = 0;
    let end = size - 1;
    let status = 200;

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match) {
        throw new DomainError('DWN', 'VD-DWN-001', 'Range 格式不正确', { status: 416 });
      }
      const startRaw = match[1];
      const endRaw = match[2];

      if (startRaw) {
        start = Number(startRaw);
        if (endRaw) end = Number(endRaw);
      } else if (endRaw) {
        start = Math.max(0, size - Number(endRaw));
        end = size - 1;
      } else {
        throw new DomainError('DWN', 'VD-DWN-001', 'Range 格式不正确', { status: 416 });
      }

      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
        throw new DomainError('DWN', 'VD-DWN-002', 'Range 不可满足', { status: 416 });
      }
      status = 206;
      reply.header('content-range', `bytes ${start}-${end}/${size}`);
    }

    reply.status(status);
    reply.header('accept-ranges', 'bytes');
    reply.header('content-type', file.contentType || 'application/octet-stream');
    reply.header('content-length', String(end - start + 1));

    return objectStorage.openRange(file.objectPath, start, end);
  }
}
