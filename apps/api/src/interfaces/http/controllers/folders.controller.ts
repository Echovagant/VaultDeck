import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';

import { memoryStore } from '../../../infrastructure/memory/memory-store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

interface CreateFolderBody {
  projectId: string;
  folderName: string;
  parentId?: string | null;
}

const createFolderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['projectId', 'folderName'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    folderName: { type: 'string', minLength: 1, maxLength: 200 },
    parentId: { type: ['string', 'null'], format: 'uuid' },
  },
};

@Controller('folders')
export class FoldersController {
  @Get()
  list(
    @Query('projectId') projectId: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    requireUser(authorization);
    if (!projectId) {
      throw new DomainError('VAL', 'VD-VAL-001', '缺少 projectId 参数', { status: 400 });
    }
    const items = [...memoryStore.folders.values()]
      .filter((folder) => folder.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return { items };
  }

  @Post()
  create(
    @Body(new StrictBodyPipe<CreateFolderBody>(createFolderSchema)) body: CreateFolderBody,
    @Headers('authorization') authorization?: string,
  ) {
    requireUser(authorization);
    if (!memoryStore.projects.has(body.projectId)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }
    const duplicated = [...memoryStore.folders.values()].some(
      (folder) =>
        folder.projectId === body.projectId &&
        folder.parentId === (body.parentId ?? null) &&
        folder.folderName.toLowerCase() === body.folderName.toLowerCase(),
    );
    if (duplicated) {
      throw new DomainError('VAL', 'VD-VAL-002', '同级已存在同名文件夹', { status: 409 });
    }
    return memoryStore.createFolder({
      projectId: body.projectId,
      folderName: body.folderName,
      parentId: body.parentId ?? null,
    });
  }
}
