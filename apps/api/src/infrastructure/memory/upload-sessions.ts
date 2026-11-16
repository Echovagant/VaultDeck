import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { LocalObjectStorage } from '../storage/local-object-storage';

export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
// 会话有效期；VD_SESSION_TTL_MS 仅供测试/演示缩短，生产保持默认
const SESSION_TTL_MS = Number(process.env['VD_SESSION_TTL_MS'] ?? 24 * 60 * 60 * 1000);

export interface UploadSessionRecord {
  sessionId: string;
  projectId: string;
  folderId: string;
  fileName: string;
  sizeBytes: number;
  chunkSize: number;
  chunkCount: number;
  received: Set<number>;
  expiresAt: string;
}

export const uploadSessions = new Map<string, UploadSessionRecord>();

export const dataRoot = path.resolve(process.env['VD_DATA_ROOT'] ?? '_private/storage');
export const objectStorage = new LocalObjectStorage(dataRoot);

export function createUploadSession(input: {
  projectId: string;
  folderId: string;
  fileName: string;
  sizeBytes: number;
}): UploadSessionRecord {
  const chunkCount = Math.ceil(input.sizeBytes / CHUNK_SIZE_BYTES);
  const session: UploadSessionRecord = {
    sessionId: randomUUID(),
    projectId: input.projectId,
    folderId: input.folderId,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    chunkSize: CHUNK_SIZE_BYTES,
    chunkCount,
    received: new Set<number>(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  uploadSessions.set(session.sessionId, session);
  return session;
}

export function findResumableSession(input: {
  projectId: string;
  folderId: string;
  fileName: string;
  sizeBytes: number;
}): UploadSessionRecord | null {
  for (const session of uploadSessions.values()) {
    if (
      session.projectId === input.projectId &&
      session.folderId === input.folderId &&
      session.fileName === input.fileName &&
      session.sizeBytes === input.sizeBytes &&
      session.received.size > 0 &&
      session.received.size < session.chunkCount
    ) {
      return session;
    }
  }
  return null;
}

/** 清理过期上传会话：移除会话登记并删除 staging 分片目录。返回清理数量。 */
export async function sweepExpiredUploadSessions(): Promise<number> {
  const now = Date.now();
  let swept = 0;
  for (const [sessionId, session] of uploadSessions) {
    if (new Date(session.expiresAt).getTime() > now) continue;
    uploadSessions.delete(sessionId);
    await objectStorage.cleanupSession(sessionId).catch(() => {
      // staging 目录已不存在则忽略
    });
    swept += 1;
  }
  return swept;
}
