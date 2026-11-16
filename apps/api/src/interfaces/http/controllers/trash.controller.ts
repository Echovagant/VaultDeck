import { Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';

import { TRASH_RETENTION_DAYS, store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { requireUser } from './auth.controller';

function toTrashDto(file: {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  projectId: string;
  folderId: string;
  trashedAt: string | null;
  expireAt: string | null;
}) {
  return {
    trashId: file.fileId,
    fileId: file.fileId,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes,
    projectId: file.projectId,
    folderId: file.folderId,
    deletedAt: file.trashedAt,
    expireAt: file.expireAt,
    retentionDays: TRASH_RETENTION_DAYS,
  };
}

@Controller('trash')
export class TrashController {
  @Get()
  async list(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    return { items: (await store.listTrash(user)).map(toTrashDto) };
  }

  @Post(':fileId/restore')
  async restore(@Param('fileId') fileId: string, @Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    const file = await store.getFile(fileId);
    if (!file || file.status !== 'trashed' || !(await store.canManageTrashedFile(user, file))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '回收站条目不存在', { status: 404 });
    }
    return store.restoreFile(user, file);
  }

  @Delete(':fileId')
  async purge(@Param('fileId') fileId: string, @Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    const file = await store.getFile(fileId);
    if (!file || file.status !== 'trashed' || !(await store.canManageTrashedFile(user, file))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '回收站条目不存在', { status: 404 });
    }
    await store.purgeFile(user, file);
    return { ok: true };
  }
}
