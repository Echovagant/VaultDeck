import { createSHA256 } from 'hash-wasm';

const BASE = '/api/v1';
const FALLBACK_CHUNK_SIZE = 8 * 1024 * 1024;

/** 分块计算文件 SHA-256，避免把大文件一次性读入内存。 */
async function sha256Hex(
  file: File,
  onProgress?: (hashedBytes: number) => void,
): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const step = 4 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += step) {
    const slice = file.slice(offset, Math.min(file.size, offset + step));
    hasher.update(new Uint8Array(await slice.arrayBuffer()));
    onProgress?.(Math.min(file.size, offset + step));
  }
  return hasher.digest('hex');
}

/** 计算分片 SHA-256 的 base64，用于 digest 请求头。 */
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
  bytesPerSecond?: number;
  etaSeconds?: number;
  transferredBytes?: number;
  totalBytes?: number;
  instant?: boolean;
  elapsedMs?: number;
}

const HASH_PERCENT_END = 5;
const UPLOAD_PERCENT_END = 98;
const MERGE_POLL_INTERVAL_MS = 1500;
const MERGE_TIMEOUT_MS = 30 * 60 * 1000;

interface MergeStatusResponse {
  status: 'uploading' | 'merging' | 'completed' | 'failed';
  file?: { fileId: string };
  error?: string;
  detail?: string;
}

/** 对速率做指数平滑，避免进度数字剧烈跳动。 */
function smooth(previous: number, current: number): number {
  return previous > 0 ? previous * 0.7 + current * 0.3 : current;
}

/** 轮询服务端合并状态，直到完成、失败或超时。 */
async function waitForMerge(
  sessionId: string,
  totalBytes: number,
  onProgress: (progress: UploadProgress) => void,
): Promise<{ fileId: string }> {
  const deadline = Date.now() + MERGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, MERGE_POLL_INTERVAL_MS));
    const response = await fetch(`${BASE}/upload-sessions/${sessionId}`);
    const payload = (await response.json()) as MergeStatusResponse;
    if (!response.ok) {
      throw new Error(payload.detail ?? '查询合并状态失败');
    }
    if (payload.status === 'completed' && payload.file) {
      return payload.file;
    }
    if (payload.status === 'failed') {
      throw new Error(payload.error ?? '服务端合并失败');
    }
    onProgress({
      percent: UPLOAD_PERCENT_END + 1,
      phase: '服务端合并中',
      transferredBytes: totalBytes,
      totalBytes,
    });
  }
  throw new Error('服务端合并超时，请稍后在文件中确认');
}

/** 执行秒传预检、分片上传与服务端合并，并持续回报进度。 */
export async function uploadFile(
  file: File,
  projectId: string,
  folderId: string,
  onProgress: (progress: UploadProgress) => void,
): Promise<UploadOutcome> {
  const startedAt = performance.now();
  let hashSpeed = 0;
  let hashSampleAt = startedAt;
  let hashSampleBytes = 0;
  let lastHashEmit = 0;
  onProgress({ percent: 0, phase: '计算校验值', transferredBytes: 0, totalBytes: file.size });

  const sha256 = await sha256Hex(file, (hashedBytes) => {
    const now = performance.now();
    const elapsed = (now - hashSampleAt) / 1000;
    if (elapsed >= 0.25) {
      hashSpeed = smooth(hashSpeed, (hashedBytes - hashSampleBytes) / elapsed);
      hashSampleAt = now;
      hashSampleBytes = hashedBytes;
    }
    if (now - lastHashEmit < 150 && hashedBytes < file.size) return;
    lastHashEmit = now;
    onProgress({
      percent: Math.min(
        HASH_PERCENT_END,
        Math.round((hashedBytes / Math.max(1, file.size)) * HASH_PERCENT_END),
      ),
      phase: '计算校验值',
      bytesPerSecond: hashSpeed || undefined,
      transferredBytes: hashedBytes,
      totalBytes: file.size,
    });
  });

  const precheckResponse = await fetch(`${BASE}/upload-sessions/precheck`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
    onProgress({
      percent: 100,
      phase: '秒传完成',
      instant: true,
      elapsedMs: Math.round(performance.now() - startedAt),
      transferredBytes: 0,
      totalBytes: file.size,
    });
    return { fileId: precheck.fileId, instant: true };
  }

  const chunkSize =
    typeof precheck.chunkSize === 'number' ? precheck.chunkSize : FALLBACK_CHUNK_SIZE;
  const received: number[] = Array.isArray(precheck.receivedChunks) ? precheck.receivedChunks : [];
  const receivedBytes = received.reduce((sum, index) => {
    const start = index * chunkSize;
    return sum + Math.max(0, Math.min(chunkSize, file.size - start));
  }, 0);
  let uploadedBytes = receivedBytes;
  let uploadSpeed = 0;
  let uploadSampleAt = performance.now();
  let uploadSampleBytes = uploadedBytes;
  onProgress({
    percent: HASH_PERCENT_END,
    phase: '上传中',
    transferredBytes: uploadedBytes,
    totalBytes: file.size,
  });

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
        headers: {
          'content-type': 'application/octet-stream',
          digest: `sha-256=${digest}`,
        },
        body: buffer,
      },
    );
    if (!chunkResponse.ok) {
      const problem = await chunkResponse.json().catch(() => null);
      throw new Error(problem?.detail ?? `分片 ${index} 上传失败`);
    }

    uploadedBytes += buffer.byteLength;
    const now = performance.now();
    const elapsed = (now - uploadSampleAt) / 1000;
    if (elapsed >= 0.25) {
      uploadSpeed = smooth(uploadSpeed, (uploadedBytes - uploadSampleBytes) / elapsed);
      uploadSampleAt = now;
      uploadSampleBytes = uploadedBytes;
    }
    const percent =
      HASH_PERCENT_END +
      Math.round((uploadedBytes / Math.max(1, file.size)) * (UPLOAD_PERCENT_END - HASH_PERCENT_END));
    onProgress({
      percent: Math.min(UPLOAD_PERCENT_END, percent),
      phase: '上传中',
      bytesPerSecond: uploadSpeed || undefined,
      etaSeconds: uploadSpeed > 0 ? (file.size - uploadedBytes) / uploadSpeed : undefined,
      transferredBytes: uploadedBytes,
      totalBytes: file.size,
    });
  }

  onProgress({
    percent: UPLOAD_PERCENT_END,
    phase: '上传中',
    bytesPerSecond: uploadSpeed || undefined,
    transferredBytes: file.size,
    totalBytes: file.size,
  });
  onProgress({
    percent: 99,
    phase: '服务端合并中',
    transferredBytes: file.size,
    totalBytes: file.size,
  });
  const completeResponse = await fetch(`${BASE}/upload-sessions/${precheck.sessionId}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      prefer: 'respond-async',
    },
    body: JSON.stringify({ sha256 }),
  });

  let fileRecord: { fileId: string };
  if (completeResponse.status === 202) {
    fileRecord = await waitForMerge(precheck.sessionId, file.size, onProgress);
  } else {
    fileRecord = (await completeResponse.json()) as { fileId: string };
    if (!completeResponse.ok) {
      throw new Error((fileRecord as { detail?: string }).detail ?? '合并失败');
    }
  }

  onProgress({ percent: 100, phase: '完成', transferredBytes: file.size, totalBytes: file.size });
  return { fileId: fileRecord.fileId, instant: false };
}
