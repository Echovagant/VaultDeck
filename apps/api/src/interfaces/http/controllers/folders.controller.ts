import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type { UpdateFolderInput } from '../../../application/ports/store.port';
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

interface UpdateFolderBody {
  folderName?: string;
  parentId?: string | null;
}

const updateFolderSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
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

  @Patch(':folderId')
  async update(
    @Param('folderId') folderId: string,
    @Body(new StrictBodyPipe<UpdateFolderBody>(updateFolderSchema)) body: UpdateFolderBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const folder = await store.getFolder(folderId);
    if (!folder || !(await store.canAccessProject(user, folder.projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件夹不存在', { status: 404 });
    }

    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === folderId) {
        throw new DomainError('VAL', 'VD-VAL-006', '不能把文件夹移动到自身', { status: 400 });
      }
      const parent = await store.getFolder(body.parentId);
      if (!parent || parent.projectId !== folder.projectId) {
        throw new DomainError('AUTH', 'VD-AUTH-404', '目标文件夹不存在', { status: 404 });
      }
    }

    const targetParent = body.parentId !== undefined ? body.parentId : folder.parentId;
    const targetName = body.folderName ?? folder.folderName;
    const siblings = (await store.listFolders(folder.projectId)).filter(
      (item) => item.folderId !== folderId && item.parentId === targetParent,
    );
    if (siblings.some((item) => item.folderName.toLowerCase() === targetName.toLowerCase())) {
      throw new DomainError('VAL', 'VD-VAL-002', '同级已存在同名文件夹', { status: 409 });
    }

    const input: UpdateFolderInput = { folderId };
    if (body.folderName !== undefined) input.folderName = body.folderName;
    if (body.parentId !== undefined) input.parentId = body.parentId;

    const updated = await store.updateFolder(input);
    await store.recordAudit({
      actor: user,
      action: 'folder.update',
      objectType: 'folder',
      objectId: updated.folderId,
      result: 'success',
      detail: `${updated.folderName} parent=${updated.parentId ?? 'root'}`,
    });
    return updated;
  }

  @Delete(':folderId')
  @HttpCode(200)
  async remove(
    @Param('folderId') folderId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const folder = await store.getFolder(folderId);
    if (!folder || !(await store.canAccessProject(user, folder.projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件夹不存在', { status: 404 });
    }

    const folders = await store.listFolders(folder.projectId);
    const hasChildren = folders.some((item) => item.parentId === folderId);
    const files = await store.listFiles(folder.projectId);
    const hasFiles = files.some((file) => file.folderId === folderId && file.status === 'active');
    if (hasChildren || hasFiles) {
      throw new DomainError('VAL', 'VD-VAL-007', '文件夹非空，请先移走或删除内容', { status: 409 });
    }

    await store.deleteFolder(folderId);
    await store.recordAudit({
      actor: user,
      action: 'folder.delete',
      objectType: 'folder',
      objectId: folderId,
      result: 'success',
      detail: folder.folderName,
    });
    return { ok: true };
  }
}
