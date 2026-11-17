import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';

import type { FastifyReply } from 'fastify';

import { dataRoot, objectStorage } from '../../../infrastructure/memory/upload-sessions';
import {
  buildBundle,
  bundles,
  purgeOldBundles,
} from '../../../infrastructure/storage/bundle-store';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

interface CreateBundleBody {
  fileIds: string[];
  folderIds?: string[];
}

const createBundleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileIds'],
  properties: {
    fileIds: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: { type: 'string', format: 'uuid' },
    },
    folderIds: {
      type: 'array',
      maxItems: 50,
      items: { type: 'string', format: 'uuid' },
    },
  },
};

@Controller('bundles')
export class BundlesController {
  @Post()
  @HttpCode(201)
  async create(
    @Body(new StrictBodyPipe<CreateBundleBody>(createBundleSchema)) body: CreateBundleBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);

    const files = [];
    for (const fileId of body.fileIds) {
      const file = await store.getFile(fileId);
      if (!file || !(await store.canReadFile(user, file))) {
        throw new DomainError('AUTH', 'VD-AUTH-404', '文件不存在', { status: 404 });
      }
      if (!file.objectPath) {
        throw new DomainError('DWN', 'VD-DWN-003', '文件内容不存在', { status: 409 });
      }
      files.push(file);
    }

    await purgeOldBundles();
    const bundle = await buildBundle({ ownerId: user.userId, files, root: dataRoot });

    await store.recordAudit({
      actor: user,
      action: 'bundle.create',
      objectType: 'bundle',
      objectId: bundle.bundleId,
      result: 'success',
      detail: `${files.length} files`,
    });

    return {
      bundleId: bundle.bundleId,
      totalBytes: bundle.totalBytes,
      chunkedRanges: false,
      statusUrl: `/api/v1/bundles/${bundle.bundleId}`,
    };
  }

  @Get(':bundleId')
  async get(@Param('bundleId') bundleId: string, @Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    const bundle = bundles.get(bundleId);
    if (!bundle || bundle.ownerId !== user.userId) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '打包任务不存在', { status: 404 });
    }
    return {
      bundleId: bundle.bundleId,
      status: 'ready',
      totalBytes: bundle.totalBytes,
      chunkedRanges: false,
    };
  }

  @Get(':bundleId/content')
  async content(
    @Param('bundleId') bundleId: string,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await requireUser(authorization);
    const bundle = bundles.get(bundleId);
    if (!bundle || bundle.ownerId !== user.userId) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '打包任务不存在', { status: 404 });
    }

    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="vaultdeck-${bundleId}.zip"`);
    reply.header('content-length', String(bundle.totalBytes));
    return await objectStorage.openRange(bundle.zipPath, 0, bundle.totalBytes - 1);
  }
}
