import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';

import { store } from '../../../infrastructure/store';
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
  async list(
    @Query('projectId') projectId: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (!projectId) {
      throw new DomainError('VAL', 'VD-VAL-001', '缺少 projectId 参数', { status: 400 });
    }
    if (!(await store.canAccessProject(user, projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }
    return { items: await store.listFolders(projectId) };
  }

  @Post()
  async create(
    @Body(new StrictBodyPipe<CreateFolderBody>(createFolderSchema)) body: CreateFolderBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (!(await store.canAccessProject(user, body.projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }

    const existing = await store.listFolders(body.projectId);
    const duplicated = existing.some(
      (folder) =>
        folder.parentId === (body.parentId ?? null) &&
        folder.folderName.toLowerCase() === body.folderName.toLowerCase(),
    );
    if (duplicated) {
      throw new DomainError('VAL', 'VD-VAL-002', '同级已存在同名文件夹', { status: 409 });
    }

    const folder = await store.createFolder({
      projectId: body.projectId,
      folderName: body.folderName,
      parentId: body.parentId ?? null,
      createdBy: user.userId,
    });
    await store.recordAudit({
      actor: user,
      action: 'folder.create',
      objectType: 'folder',
      objectId: folder.folderId,
      result: 'success',
      detail: folder.folderName,
    });
    return folder;
  }
}
