import { Controller, Get, Headers, Query } from '@nestjs/common';

import { memoryStore } from '../../../infrastructure/memory/memory-store';
import { DomainError } from '../errors/problem-details';
import { requireUser } from './auth.controller';

@Controller('files')
export class FilesController {
  @Get()
  list(
    @Query('projectId') projectId: string | undefined,
    @Query('folderId') folderId: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    requireUser(authorization);
    if (!projectId) {
      throw new DomainError('VAL', 'VD-VAL-001', '缺少 projectId 参数', { status: 400 });
    }

    const items = [...memoryStore.files.values()]
      .filter((file) => file.projectId === projectId)
      .filter((file) => (folderId ? file.folderId === folderId : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return { items, total: items.length };
  }
}
