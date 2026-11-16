import { createSHA256 } from 'hash-wasm';

import { getToken } from '@/api/client';

const BASE = '/api/v1';
const FALLBACK_CHUNK_SIZE = 8 * 1024 * 1024;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

async function sha256Hex(file: File): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const step = 4 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += step) {
    const slice = file.slice(offset, Math.min(file.size, offset + step));
    hasher.update(new Uint8Array(await slice.arrayBuffer()));
  }
  return hasher.digest('hex');
}

async function sha256Base64(data: Uint8Array): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  hasher.update(data);
  const binary = hasher.digest('binary');
  return btoa(String.fromCharCode(...binary));
}

export interface UploadOutcome {
  fileId: string;
  instant: boolean;
}

export interface UploadProgress {
  percent: number;
  phase: string;
}

export async function uploadFile(
  file: File,
  projectId: string,
  folderId: string,
  onProgress: (progress: UploadProgress) => void,
): Promise<UploadOutcome> {
  onProgress({ percent: 0, phase: '计算校验值' });
  const sha256 = await sha256Hex(file);

  const precheckResponse = await fetch(`${BASE}/upload-sessions/precheck`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      projectId,
      folderId,
      fileName: file.name,
      sizeBytes: file.size,
      sha256,
      clientFingerprint: 'web',
    }),
  });
  const precheck = await precheckResponse.json();
  if (!precheckResponse.ok) {
    throw new Error(precheck.detail ?? '预检失败');
  }
  if (precheck.kind === 'instant') {
    onProgress({ percent: 100, phase: '秒传完成' });
    return { fileId: precheck.fileId, instant: true };
  }

  const chunkSize =
    typeof precheck.chunkSize === 'number' ? precheck.chunkSize : FALLBACK_CHUNK_SIZE;
  const received: number[] = Array.isArray(precheck.receivedChunks) ? precheck.receivedChunks : [];
  let uploadedBytes = received.length * chunkSize;

  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const index = Math.floor(offset / chunkSize);
    if (received.includes(index)) continue;

    const blob = file.slice(offset, Math.min(file.size, offset + chunkSize));
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const digest = await sha256Base64(buffer);

    const chunkResponse = await fetch(
      `${BASE}/upload-sessions/${precheck.sessionId}/chunks/${index}`,
      {
        method: 'PUT',
        headers: authHeaders({
          'content-type': 'application/octet-stream',
          digest: `sha-256=${digest}`,
        }),
        body: buffer,
      },
    );
    if (!chunkResponse.ok) {
      const problem = await chunkResponse.json().catch(() => null);
      throw new Error(problem?.detail ?? `分片 ${index} 上传失败`);
    }

    uploadedBytes += buffer.byteLength;
    onProgress({
      percent: Math.min(99, Math.round((uploadedBytes / file.size) * 100)),
      phase: '上传中',
    });
  }

  onProgress({ percent: 99, phase: '合并与校验' });
  const completeResponse = await fetch(`${BASE}/upload-sessions/${precheck.sessionId}/complete`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ sha256 }),
  });
  const fileRecord = await completeResponse.json();
  if (!completeResponse.ok) {
    throw new Error(fileRecord.detail ?? '合并失败');
  }

  onProgress({ percent: 100, phase: '完成' });
  return { fileId: fileRecord.fileId, instant: false };
}
