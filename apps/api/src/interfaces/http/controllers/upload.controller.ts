import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { memoryStore } from '../../../infrastructure/memory/memory-store';
import {
  MAX_UPLOAD_BYTES,
  createUploadSession,
  findResumableSession,
  objectStorage,
  uploadSessions,
} from '../../../infrastructure/memory/upload-sessions';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

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
    requireUser(authorization);

    if (!memoryStore.projects.has(body.projectId)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }
    if (!memoryStore.folders.has(body.folderId)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件夹不存在', { status: 404 });
    }
    if (body.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new DomainError('VAL', 'VD-VAL-003', '文件超过单文件上限 20 GB', { status: 400 });
    }

    if (body.sha256) {
      const existing = [...memoryStore.files.values()].find(
        (file) => file.sha256 === body.sha256 && file.sizeBytes === body.sizeBytes,
      );
      if (existing) {
        return { kind: 'instant', fileId: existing.fileId, objectId: existing.objectPath };
      }
    }

    const resumable = findResumableSession({
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
  getSession(
    @Param('sessionId') sessionId: string,
    @Headers('authorization') authorization?: string,
  ) {
    requireUser(authorization);
    const session = uploadSessions.get(sessionId);
    if (!session) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '上传会话不存在', { status: 404 });
    }
    return {
      sessionId: session.sessionId,
      status: session.received.size === session.chunkCount ? 'uploading' : 'uploading',
      receivedChunks: [...session.received].sort((left, right) => left - right),
      receivedBytes: session.received.size * session.chunkSize,
      expiresAt: session.expiresAt,
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
    requireUser(authorization);

    const session = uploadSessions.get(sessionId);
    if (!session) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '上传会话不存在', { status: 404 });
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
    @Headers('authorization') authorization?: string,
  ) {
    const user = requireUser(authorization);

    const session = uploadSessions.get(sessionId);
    if (!session) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '上传会话不存在', { status: 404 });
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

    const merged = await objectStorage.mergeChunks(sessionId, session.chunkCount, body.sha256);
    const file = memoryStore.addFile({
      projectId: session.projectId,
      folderId: session.folderId,
      fileName: session.fileName,
      sizeBytes: merged.sizeBytes,
      contentType: 'application/octet-stream',
      uploaderId: user.userId,
      sha256: body.sha256,
      objectPath: merged.objectPath,
    });

    await objectStorage.cleanupSession(sessionId);
    uploadSessions.delete(sessionId);

    return file;
  }
}
