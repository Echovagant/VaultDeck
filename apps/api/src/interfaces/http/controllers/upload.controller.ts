import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';

import type { StoreUser } from '../../../application/ports/store.port';
import { store } from '../../../infrastructure/store';
import {
  createUploadSession,
  findResumableSession,
  MERGE_RESULT_TTL_MS,
  objectStorage,
  SESSION_TTL_MS,
  uploadSessions,
  type UploadSessionRecord,
} from '../../../infrastructure/memory/upload-sessions';
import { readDiskUsage, shouldBlockWrites } from '../../../infrastructure/ops/alert-state';
import { DomainError } from '../errors/problem-details';
import { previewAdapter } from '../../../infrastructure/preview';
import { toPublicFile, type PublicFile } from '../presenters/file.presenter';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

/** B5：数据卷可用空间低于 5% 时拒绝新写入 */
function assertDiskWritable(): void {
  if (shouldBlockWrites(readDiskUsage())) {
    throw new DomainError('SYS', 'VD-STO-507', '磁盘空间不足，已暂停上传', {
      status: 507,
      title: 'Insufficient Storage',
    });
  }
}

interface PrecheckBody {
  projectId: string;
  folderId: string;
  fileName: string;
  sizeBytes: number;
  sha256?: string;
  clientFingerprint: string;
}

const precheckSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['projectId', 'folderId', 'fileName', 'sizeBytes', 'clientFingerprint'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    folderId: { type: 'string', format: 'uuid' },
    fileName: { type: 'string', minLength: 1, maxLength: 200 },
    sizeBytes: { type: 'integer', minimum: 1 },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    clientFingerprint: { type: 'string', maxLength: 128 },
  },
};

interface CompleteBody {
  sha256: string;
}

const completeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sha256'],
  properties: {
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
};

@Controller('upload-sessions')
export class UploadController {
  @Post('precheck')
  @HttpCode(200)
  async precheck(
    @Body(new StrictBodyPipe<PrecheckBody>(precheckSchema)) body: PrecheckBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    assertDiskWritable();

    if (!(await store.canAccessProject(user, body.projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }

    const folders = await store.listFolders(body.projectId);
    if (!folders.some((folder) => folder.folderId === body.folderId)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件夹不存在', { status: 404 });
    }

    const settings = await store.getSettings();
    if (body.sizeBytes > settings.maxUploadBytes) {
      const limitGb = (settings.maxUploadBytes / (1024 * 1024 * 1024)).toFixed(1);
      throw new DomainError('VAL', 'VD-VAL-003', `文件超过单文件上限 ${limitGb} GB`, {
        status: 400,
      });
    }

    if (body.sha256 && settings.instantUploadEnabled) {
      const projectFiles = await store.listFiles(body.projectId);
      for (const file of projectFiles) {
        if (file.status !== 'active' || file.objectPath.length === 0) continue;
        if (file.sha256 !== body.sha256 || file.sizeBytes !== body.sizeBytes) continue;
        if (!(await store.canReadFile(user, file))) continue;
        return { kind: 'instant', fileId: file.fileId, objectId: file.objectPath };
      }
    }

    const resumable = findResumableSession({
      userId: user.userId,
      projectId: body.projectId,
      folderId: body.folderId,
      fileName: body.fileName,
      sizeBytes: body.sizeBytes,
    });
    if (resumable) {
      return {
        kind: 'resume',
        sessionId: resumable.sessionId,
        receivedChunks: [...resumable.received].sort((left, right) => left - right),
      };
    }

    const session = createUploadSession({
      userId: user.userId,
      projectId: body.projectId,
      folderId: body.folderId,
      fileName: body.fileName,
      sizeBytes: body.sizeBytes,
    });

    return {
      kind: 'new',
      sessionId: session.sessionId,
      chunkSize: session.chunkSize,
      chunkCount: session.chunkCount,
      expiresAt: session.expiresAt,
    };
  }

  @Get(':sessionId')
  async getSession(
    @Param('sessionId') sessionId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const session = uploadSessions.get(sessionId);
    if (!session || session.userId !== user.userId) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '上传会话不存在', { status: 404 });
    }
    return {
      sessionId: session.sessionId,
      status: session.status,
      receivedChunks: [...session.received].sort((left, right) => left - right),
      receivedBytes: session.received.size * session.chunkSize,
      expiresAt: session.expiresAt,
      ...(session.status === 'completed' && session.file ? { file: session.file } : {}),
      ...(session.status === 'failed' && session.error ? { error: session.error } : {}),
    };
  }

  @Put(':sessionId/chunks/:index')
  async putChunk(
    @Param('sessionId') sessionId: string,
    @Param('index') indexRaw: string,
    @Body() body: Buffer,
    @Headers('digest') digest?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    assertDiskWritable();

    const session = uploadSessions.get(sessionId);
    if (!session || session.userId !== user.userId) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '上传会话不存在', { status: 404 });
    }
    if (session.status !== 'uploading') {
      throw new DomainError('UPL', 'VD-UPL-006', '会话已进入合并或完成阶段', { status: 409 });
    }

    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) {
      throw new DomainError('VAL', 'VD-VAL-004', '分片索引越界', { status: 400 });
    }
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new DomainError('VAL', 'VD-VAL-005', '分片内容为空', { status: 400 });
    }

    const expected = (digest ?? '').replace(/^sha-256=/i, '');
    if (expected) {
      const actual = createHash('sha256').update(body).digest('base64');
      if (actual !== expected) {
        throw new DomainError('UPL', 'VD-UPL-002', '分片校验值不一致', { status: 409 });
      }
    }

    await objectStorage.saveChunk(sessionId, index, body);
    session.received.add(index);

    return { chunkIndex: index, receivedBytes: body.byteLength };
  }

  @Post(':sessionId/complete')
  @HttpCode(200)
  async complete(
    @Param('sessionId') sessionId: string,
    @Body(new StrictBodyPipe<CompleteBody>(completeSchema)) body: CompleteBody,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers('authorization') authorization?: string,
    @Headers('prefer') prefer?: string,
  ) {
    const user = await requireUser(authorization);

    const session = uploadSessions.get(sessionId);
    if (!session || session.userId !== user.userId) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '上传会话不存在', { status: 404 });
    }

    if (session.status === 'completed') {
      return session.file as PublicFile;
    }
    if (session.status === 'merging') {
      reply.status(202);
      return {
        status: 'merging',
        statusUrl: `/api/v1/upload-sessions/${session.sessionId}`,
      };
    }
    if (session.status === 'failed') {
      throw new DomainError('UPL', 'VD-UPL-007', session.error ?? '合并失败，请重新上传', {
        status: 409,
      });
    }

    const missing: number[] = [];
    for (let index = 0; index < session.chunkCount; index += 1) {
      if (!session.received.has(index)) missing.push(index);
    }
    if (missing.length > 0) {
      throw new DomainError('UPL', 'VD-UPL-004', '分片缺失', {
        status: 409,
        errors: missing.slice(0, 20).map((index) => ({
          field: `chunks[${index}]`,
          message: '尚未上传',
        })),
      });
    }

    session.status = 'merging';
    session.mergeStartedAt = new Date().toISOString();
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    // Prefer: respond-async -> 立即返回 202，客户端轮询会话状态；否则保持原有同步语义
    if ((prefer ?? '').toLowerCase().includes('respond-async')) {
      void this.runMerge(session, user, body.sha256).catch(() => {
        // 失败状态已记录在 session 上，由状态接口返回
      });
      reply.status(202);
      return {
        status: 'merging',
        statusUrl: `/api/v1/upload-sessions/${session.sessionId}`,
      };
    }

    await this.runMerge(session, user, body.sha256);
    const result = session.file as PublicFile;
    uploadSessions.delete(sessionId);
    return result;
  }

  private async runMerge(
    session: UploadSessionRecord,
    user: StoreUser,
    sha256: string,
  ): Promise<void> {
    try {
      const merged = await objectStorage.mergeChunks(
        session.sessionId,
        session.chunkCount,
        sha256,
      );
      const file = await store.addFile({
        projectId: session.projectId,
        folderId: session.folderId,
        fileName: session.fileName,
        sizeBytes: merged.sizeBytes,
        contentType: 'application/octet-stream',
        uploaderId: session.userId,
        sha256,
        objectPath: merged.objectPath,
      });

      await store.recordAudit({
        actor: user,
        action: 'file.upload',
        objectType: 'file',
        objectId: file.fileId,
        result: 'success',
        detail: file.fileName,
      });

      if (previewAdapter.supports(file.fileName) && file.objectPath) {
        void previewAdapter
          .convertToPdf({
            fileId: file.fileId,
            objectPath: objectStorage.resolve(file.objectPath),
          })
          .catch(() => {
            // 预转换失败不影响上传结果，预览时会再次尝试
          });
      }

      await objectStorage.cleanupSession(session.sessionId);
      session.file = toPublicFile(file);
      session.status = 'completed';
      session.mergeFinishedAt = new Date().toISOString();
      session.expiresAt = new Date(Date.now() + MERGE_RESULT_TTL_MS).toISOString();
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : '合并失败';
      session.mergeFinishedAt = new Date().toISOString();
      session.expiresAt = new Date(Date.now() + MERGE_RESULT_TTL_MS).toISOString();
      throw error;
    }
  }
}
