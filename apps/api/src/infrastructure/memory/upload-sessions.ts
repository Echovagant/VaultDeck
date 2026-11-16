import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { LocalObjectStorage } from '../storage/local-object-storage';

export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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
