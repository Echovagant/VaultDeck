// 异步合并验收：上传单个大文件，complete 使用 Prefer: respond-async，
// 验证 202 立即返回、状态轮询到 completed、文件可查，结束后清理。
// 用法：VD_API_BASE=... VD_TEST_FILE_GB=1 VD_TEST_FILE_DIR=<临时目录> node scripts/spike/m6-async-complete.mjs
import assert from 'node:assert/strict';
import { createHash, randomFillSync } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

import { testCredentials as creds } from '../lib/test-credentials.mjs';

const API = process.env['VD_API_BASE'] ?? 'http://127.0.0.1:3000/api/v1';
const FILE_GB = Number(process.env['VD_TEST_FILE_GB'] ?? 1);
const FILE_DIR = process.env['VD_TEST_FILE_DIR'];
if (!FILE_DIR) throw new Error('需要 VD_TEST_FILE_DIR');
const FILE_BYTES = Math.floor(FILE_GB * 1024 ** 3);
const CHUNK_BYTES = 8 * 1024 * 1024;
const MIB = 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'leader', password: creds.leader }),
  });
  assert.equal(response.status, 200, '登录失败');
  return (await response.json()).token;
}

const token = await login();
const headers = { authorization: `Bearer ${token}` };
const projects = await (await fetch(`${API}/projects`, { headers })).json();
const demo = projects.items.find((item) => item.projectCode === 'DEMO-001') ?? projects.items[0];
const folders = await (await fetch(`${API}/folders?projectId=${demo.projectId}`, { headers })).json();
const folderId = folders.items[0].folderId;

await mkdir(FILE_DIR, { recursive: true });
const fileName = `async-${Date.now()}.bin`;
const filePath = path.join(FILE_DIR, fileName);
const handle = await open(filePath, 'w');
const hash = createHash('sha256');
const buffer = Buffer.alloc(CHUNK_BYTES);
try {
  for (let written = 0; written < FILE_BYTES; written += CHUNK_BYTES) {
    const size = Math.min(CHUNK_BYTES, FILE_BYTES - written);
    const slice = size === CHUNK_BYTES ? buffer : buffer.subarray(0, size);
    randomFillSync(slice);
    hash.update(slice);
    await handle.write(slice, 0, size);
  }
} finally {
  await handle.close();
}
const sha256 = hash.digest('hex');

const precheckResponse = await fetch(`${API}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId: demo.projectId,
    folderId,
    fileName,
    sizeBytes: FILE_BYTES,
    sha256,
    clientFingerprint: 'async-spike',
  }),
});
const session = await precheckResponse.json();
assert.equal(precheckResponse.status, 200, JSON.stringify(session));
assert.equal(session.kind, 'new', `不应命中秒传：${JSON.stringify(session)}`);

const reader = await open(filePath, 'r');
const uploadStarted = Date.now();
const reportEvery = Math.max(1, Math.floor(session.chunkCount / 10));
try {
  for (let index = 0; index < session.chunkCount; index += 1) {
    if (index % reportEvery === 0) {
      process.stdout.write(`uploaded=${index}/${session.chunkCount}\n`);
    }
    const start = index * session.chunkSize;
    const length = Math.min(session.chunkSize, FILE_BYTES - start);
    const chunk = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const result = await reader.read(chunk, read, length - read, start + read);
      if (result.bytesRead === 0) throw new Error(`读取不足：${index}`);
      read += result.bytesRead;
    }
    const digest = createHash('sha256').update(chunk).digest('base64');
    const response = await fetch(
      `${API}/upload-sessions/${session.sessionId}/chunks/${index}`,
      {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/octet-stream', digest: `sha-256=${digest}` },
        body: chunk,
      },
    );
    assert.equal(response.status, 200, `分片上传失败 ${index}`);
  }
} finally {
  await reader.close();
}
const uploadSeconds = (Date.now() - uploadStarted) / 1000;

const completeStarted = Date.now();
const completeResponse = await fetch(
  `${API}/upload-sessions/${session.sessionId}/complete`,
  {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', prefer: 'respond-async' },
    body: JSON.stringify({ sha256 }),
  },
);
const acceptedMs = Date.now() - completeStarted;
const accepted = await completeResponse.json();
assert.equal(completeResponse.status, 202, `应返回 202：${JSON.stringify(accepted)}`);
assert.equal(accepted.status, 'merging');

let file = null;
let polls = 0;
const deadline = Date.now() + 30 * 60 * 1000;
while (Date.now() < deadline) {
  await sleep(1500);
  polls += 1;
  const response = await fetch(`${API}/upload-sessions/${session.sessionId}`, { headers });
  const status = await response.json();
  assert.equal(response.status, 200, JSON.stringify(status));
  if (status.status === 'completed') {
    file = status.file;
    break;
  }
  if (status.status === 'failed') throw new Error(status.error ?? '服务端合并失败');
}
assert.ok(file, '合并超时');
const mergeSeconds = (Date.now() - completeStarted) / 1000;

const listed = await (await fetch(`${API}/files?projectId=${demo.projectId}`, { headers })).json();
assert.ok(listed.items.some((item) => item.fileId === file.fileId), '文件未出现在列表中');

await fetch(`${API}/files/${file.fileId}`, { method: 'DELETE', headers });
await fetch(`${API}/trash/${file.fileId}`, { method: 'DELETE', headers });
await rm(filePath, { force: true });

console.log(
  JSON.stringify(
    {
      fileGB: Number((FILE_BYTES / 1024 ** 3).toFixed(2)),
      chunks: session.chunkCount,
      uploadSeconds: Number(uploadSeconds.toFixed(1)),
      uploadMBps: Number((FILE_BYTES / MIB / uploadSeconds).toFixed(1)),
      acceptedMs,
      mergeSeconds: Number(mergeSeconds.toFixed(1)),
      polls,
      status: 'completed',
    },
    null,
    2,
  ),
);
