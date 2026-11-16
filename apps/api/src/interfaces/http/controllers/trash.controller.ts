import { Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';

import { memoryStore, TRASH_RETENTION_DAYS } from '../../../infrastructure/memory/memory-store';
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
  list(@Headers('authorization') authorization?: string) {
    const user = requireUser(authorization);
    return { items: memoryStore.listTrash(user).map(toTrashDto) };
  }

  @Post(':fileId/restore')
  restore(@Param('fileId') fileId: string, @Headers('authorization') authorization?: string) {
    const user = requireUser(authorization);
    const file = memoryStore.files.get(fileId);
    if (!file || file.status !== 'trashed' || !memoryStore.canManageTrashedFile(user, file)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '回收站条目不存在', { status: 404 });
    }
    return memoryStore.restoreFile(user, file);
  }

  @Delete(':fileId')
  purge(@Param('fileId') fileId: string, @Headers('authorization') authorization?: string) {
    const user = requireUser(authorization);
    const file = memoryStore.files.get(fileId);
    if (!file || file.status !== 'trashed' || !memoryStore.canManageTrashedFile(user, file)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '回收站条目不存在', { status: 404 });
    }
    memoryStore.purgeFile(user, file);
    return { ok: true };
  }
}
