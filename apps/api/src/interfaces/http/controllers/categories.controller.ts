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
} from '@nestjs/common';

import type { UpdateCategoryInput } from '../../../application/ports/store.port';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

interface CreateCategoryBody {
  categoryCode: string;
  categoryName: string;
  extensions: string[];
}

const createCategorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryCode', 'categoryName', 'extensions'],
  properties: {
    categoryCode: { type: 'string', minLength: 1, maxLength: 32 },
    categoryName: { type: 'string', minLength: 1, maxLength: 64 },
    extensions: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', pattern: '^\\.[a-z0-9]+$' },
    },
  },
};

interface UpdateCategoryBody {
  categoryName?: string;
  extensions?: string[];
}

const updateCategorySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    categoryName: { type: 'string', minLength: 1, maxLength: 64 },
    extensions: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', pattern: '^\\.[a-z0-9]+$' },
    },
  },
};

function systemReadonly(): DomainError {
  return new DomainError('VAL', 'VD-VAL-008', '内置分类不可修改或删除', { status: 409 });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

interface AssignFileBody {
  fileId: string;
  categoryId: string;
}

const assignFileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileId', 'categoryId'],
  properties: {
    fileId: { type: 'string', format: 'uuid' },
    categoryId: { type: 'string', format: 'uuid' },
  },
};

@Controller('categories')
export class CategoriesController {
  /** AI 分类建议「应用」动作的落库：把文件归入一个分类 */
  @Post('assign')
  @HttpCode(200)
  async assignFile(
    @Body(new StrictBodyPipe<AssignFileBody>(assignFileSchema)) body: AssignFileBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER' && user.role !== 'DEPUTY_LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }
    const file = await store.getFile(body.fileId);
    if (!file || !(await store.canReadFile(user, file))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件不存在', { status: 404 });
    }
    const category = (await store.listCategories()).find((c) => c.categoryId === body.categoryId);
    if (!category) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '分类不存在', { status: 404 });
    }
    await store.assignFileCategory(file.fileId, category.categoryId);
    await store.recordAudit({
      actor: user,
      action: 'category.assign',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: JSON.stringify({ fileName: file.fileName, categoryName: category.categoryName }),
    });
    return { ok: true, fileId: file.fileId, categoryId: category.categoryId };
  }

  @Get()
  async list(@Headers('authorization') authorization?: string) {
    await requireUser(authorization);
    return store.listCategories();
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new StrictBodyPipe<CreateCategoryBody>(createCategorySchema))
    body: CreateCategoryBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    try {
      const category = await store.createCategory(body);
      await store.recordAudit({
        actor: user,
        action: 'category.create',
        objectType: 'category',
        objectId: category.categoryId,
        result: 'success',
        detail: category.categoryName,
      });
      return category;
    } catch (error) {
      if (error instanceof Error && error.message === 'CATEGORY_CODE_TAKEN') {
        throw new DomainError('VAL', 'VD-VAL-002', '分类编码已存在', { status: 409 });
      }
      if (isUniqueViolation(error)) {
        throw new DomainError('VAL', 'VD-VAL-002', '分类编码已存在', { status: 409 });
      }
      throw error;
    }
  }

  @Patch(':categoryId')
  async update(
    @Param('categoryId') categoryId: string,
    @Body(new StrictBodyPipe<UpdateCategoryBody>(updateCategorySchema))
    body: UpdateCategoryBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    const input: UpdateCategoryInput = { categoryId };
    if (body.categoryName !== undefined) input.categoryName = body.categoryName;
    if (body.extensions !== undefined) input.extensions = body.extensions;

    try {
      const updated = await store.updateCategory(input);
      await store.recordAudit({
        actor: user,
        action: 'category.update',
        objectType: 'category',
        objectId: updated.categoryId,
        result: 'success',
        detail: updated.categoryName,
      });
      return updated;
    } catch (error) {
      if (error instanceof Error && error.message === 'CATEGORY_SYSTEM_READONLY') {
        throw systemReadonly();
      }
      if (error instanceof Error && error.message === 'CATEGORY_NOT_FOUND') {
        throw new DomainError('AUTH', 'VD-AUTH-404', '分类不存在', { status: 404 });
      }
      throw error;
    }
  }

  @Delete(':categoryId')
  @HttpCode(204)
  async remove(
    @Param('categoryId') categoryId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    try {
      await store.deleteCategory(categoryId);
      await store.recordAudit({
        actor: user,
        action: 'category.delete',
        objectType: 'category',
        objectId: categoryId,
        result: 'success',
        detail: '',
      });
      return undefined;
    } catch (error) {
      if (error instanceof Error && error.message === 'CATEGORY_SYSTEM_READONLY') {
        throw systemReadonly();
      }
      if (error instanceof Error && error.message === 'CATEGORY_NOT_FOUND') {
        throw new DomainError('AUTH', 'VD-AUTH-404', '分类不存在', { status: 404 });
      }
      throw error;
    }
  }
}
