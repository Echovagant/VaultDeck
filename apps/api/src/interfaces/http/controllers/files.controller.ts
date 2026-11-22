import { Controller, Delete, Get, Headers, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { store } from '../../../infrastructure/store';
import { objectStorage } from '../../../infrastructure/memory/upload-sessions';
import { previewAdapter } from '../../../infrastructure/preview';
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

  @Get(':fileId')
  async detail(@Param('fileId') fileId: string, @Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    const file = await store.getFile(fileId);
    if (!file || !(await store.canReadFile(user, file))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件不存在', { status: 404 });
    }
    return toPublicFile(file);
  }

  @Get(':fileId/content')
  async content(
    @Param('fileId') fileId: string,
    @Query('purpose') purposeRaw: string | undefined,
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

    // 预览弹层与真实下载走同一内容端点：purpose 参数区分审计动作，避免预览被记成下载
    const action = purposeRaw === 'preview' ? 'file.preview' : 'file.download';
    await store.recordAudit({
      actor: user,
      action,
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

    return await objectStorage.openRange(file.objectPath, start, end);
  }

  @Get(':fileId/preview')
  async preview(
    @Param('fileId') fileId: string,
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
    if (!previewAdapter.supports(file.fileName)) {
      throw new DomainError('SYS', 'VD-SYS-501', '该格式不支持服务端预览', { status: 415 });
    }

    const materialized = await objectStorage.materializePlaintext(file.objectPath, file.fileName);
    let pdfPath: string;
    try {
      pdfPath = await previewAdapter.convertToPdf({
        fileId: file.fileId,
        objectPath: materialized.path,
      });
    } catch {
      throw new DomainError('SYS', 'VD-SYS-502', 'Office 预览暂不可用，请下载后查看', {
        status: 503,
      });
    } finally {
      await objectStorage.cleanupMaterialized(materialized);
    }

    const pdfSize = await objectStorage.plaintextSize(pdfPath);
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', 'inline');
    reply.header('content-length', String(pdfSize));
    return await objectStorage.openRange(pdfPath, 0, pdfSize - 1);
  }
}
