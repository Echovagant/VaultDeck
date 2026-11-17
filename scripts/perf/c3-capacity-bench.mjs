// C3 大容量基准：生成 N GB 随机数据 → 并发上传 → 并发下载 → restic 备份 → 清理。
// 所有路径由环境变量提供，脚本本身不写死盘符。
// 空间规划：默认备份 BENCH_DIR（源数据、服务端对象、restic 仓库三份共存，峰值约 3N）。
// 真实 200 GB 演练可设 VD_BENCH_BACKUP_PATH=<服务端对象根> 且 VD_BENCH_DROP_SOURCE=1：
// 上传/下载完成后先删源数据，再备份服务端对象，峰值降到约 2N（源 1N + 对象 1N → 对象 1N + 仓库 1N）。
import assert from 'node:assert/strict';
import { createHash, randomFillSync } from 'node:crypto';
import { mkdir, open, rm, statfs, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const API = process.env['VD_API_BASE'] ?? 'http://127.0.0.1:3000/api/v1';
const BENCH_DIR = process.env['VD_BENCH_DIR'];
const REPO = process.env['VD_BENCH_REPO'];
const PASSWORD_FILE = process.env['VD_BENCH_PASSWORD_FILE'];
const RESTIC = process.env['VD_RESTIC_PATH'];
const BACKUP_PATH = process.env['VD_BENCH_BACKUP_PATH'] ?? BENCH_DIR;
const DROP_SOURCE = process.env['VD_BENCH_DROP_SOURCE'] === '1';
const MIN_FREE_GB = Number(process.env['VD_BENCH_MIN_FREE_GB'] ?? 6);
const TOTAL_GB = Number(process.env['VD_BENCH_GB'] ?? 20);
const FILE_COUNT = Number(process.env['VD_BENCH_FILES'] ?? 20);
const CONCURRENCY = Number(process.env['VD_BENCH_CONCURRENCY'] ?? 10);
if (!BENCH_DIR || !REPO || !PASSWORD_FILE || !RESTIC) {
  throw new Error('需要 VD_BENCH_DIR / VD_BENCH_REPO / VD_BENCH_PASSWORD_FILE / VD_RESTIC_PATH');
}
if (!BACKUP_PATH) throw new Error('VD_BENCH_BACKUP_PATH 不能为空');
if (DROP_SOURCE && path.resolve(BACKUP_PATH) === path.resolve(BENCH_DIR)) {
  throw new Error('VD_BENCH_DROP_SOURCE=1 时 VD_BENCH_BACKUP_PATH 不能仍是 BENCH_DIR');
}

async function assertFreeSpace(stage) {
  const stats = await statfs(path.parse(BENCH_DIR).root);
  const freeGB = (stats.bavail * stats.bsize) / 1024 ** 3;
  process.stdout.write(`${stage}: free=${freeGB.toFixed(1)}GB\n`);
  if (freeGB < MIN_FREE_GB) {
    throw new Error(`${stage}: 剩余空间 ${freeGB.toFixed(1)}GB 低于阈值 ${MIN_FREE_GB}GB`);
  }
}

const FILE_BYTES = Math.floor((TOTAL_GB * 1024 ** 3) / FILE_COUNT);
const MIB = 1024 * 1024;

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

async function generate() {
  await rm(BENCH_DIR, { recursive: true, force: true });
  await mkdir(BENCH_DIR, { recursive: true });
  const files = [];
  const buf = Buffer.alloc(MIB);
  for (let index = 0; index < FILE_COUNT; index += 1) {
    const fileName = `c3-${String(index).padStart(2, '0')}.bin`;
    const filePath = path.join(BENCH_DIR, fileName);
    const handle = await open(filePath, 'w');
    const hash = createHash('sha256');
    try {
      let written = 0;
      while (written < FILE_BYTES) {
        const size = Math.min(MIB, FILE_BYTES - written);
        const slice = size === MIB ? buf : buf.subarray(0, size);
        randomFillSync(slice);
        hash.update(slice);
        await handle.write(slice, 0, size);
        written += size;
      }
    } finally {
      await handle.close();
    }
    files.push({ fileName, filePath, sizeBytes: FILE_BYTES, sha256: hash.digest('hex') });
    process.stdout.write(`generated=${index + 1}/${FILE_COUNT}\n`);
  }
  return files;
}

async function waitForMerge(sessionId) {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(`${API}/upload-sessions/${sessionId}`, { headers });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? '查询合并状态失败');
    if (body.status === 'completed' && body.file) return body.file;
    if (body.status === 'failed') throw new Error(body.error ?? '服务端合并失败');
  }
  throw new Error('服务端合并超时');
}

async function uploadOne(file) {
  const precheckResponse = await fetch(`${API}/upload-sessions/precheck`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: demo.projectId,
      folderId,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      clientFingerprint: 'c3-capacity',
    }),
  });
  const session = await precheckResponse.json();
  assert.equal(precheckResponse.status, 200, JSON.stringify(session));
  assert.equal(session.kind, 'new', `${file.fileName} 不应命中秒传`);

  const handle = await open(file.filePath, 'r');
  try {
    for (let index = 0; index < session.chunkCount; index += 1) {
      const start = index * session.chunkSize;
      const length = Math.min(session.chunkSize, file.sizeBytes - start);
      const buffer = Buffer.allocUnsafe(length);
      let read = 0;
      while (read < length) {
        const result = await handle.read(buffer, read, length - read, start + read);
        if (result.bytesRead === 0) throw new Error(`读取不足: ${file.fileName}`);
        read += result.bytesRead;
      }
      const digest = createHash('sha256').update(buffer).digest('base64');
      const response = await fetch(`${API}/upload-sessions/${session.sessionId}/chunks/${index}`, {
        method: 'PUT',
        headers: {
          ...headers,
          'content-type': 'application/octet-stream',
          digest: `sha-256=${digest}`,
        },
        body: buffer,
      });
      assert.equal(response.status, 200, `分片上传失败 ${file.fileName}#${index}`);
    }
  } finally {
    await handle.close();
  }

  // 分片已全部上传，源文件不再需要：在服务端合并前删除，避免第二波合并时
  // 「源数据 + 旧对象 + 新分片 + 合并副本」同时占盘导致空间峰值过高。
  if (DROP_SOURCE) {
    await rm(file.filePath, { force: true });
    process.stdout.write(`source dropped: ${file.fileName}\n`);
  }

  const completeResponse = await fetch(`${API}/upload-sessions/${session.sessionId}/complete`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', prefer: 'respond-async' },
    body: JSON.stringify({ sha256: file.sha256 }),
  });
  const uploaded =
    completeResponse.status === 202
      ? await waitForMerge(session.sessionId)
      : await completeResponse.json();
  assert.equal(
    completeResponse.status === 202 ? 200 : completeResponse.status,
    200,
    JSON.stringify(uploaded),
  );
  return uploaded;
}

async function downloadOne(fileId) {
  const response = await fetch(`${API}/files/${fileId}/content`, { headers });
  assert.equal(response.status, 200, '下载失败');
  let bytes = 0;
  if (response.body) {
    for await (const chunk of response.body) bytes += chunk.length;
  }
  return bytes;
}

async function inWaves(items, waveSize, worker) {
  const results = [];
  for (let index = 0; index < items.length; index += waveSize) {
    const wave = items.slice(index, index + waveSize);
    results.push(...(await Promise.all(wave.map(worker))));
  }
  return results;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`命令失败(${code})：${output.slice(-800)}`));
    });
    child.on('error', reject);
  });
}

await assertFreeSpace('before-generate');
const generated = await generate();
const totalBytes = generated.reduce((sum, file) => sum + file.sizeBytes, 0);

const uploadStarted = Date.now();
const uploaded = await inWaves(generated, CONCURRENCY, uploadOne);
const uploadSeconds = (Date.now() - uploadStarted) / 1000;
assert.equal(uploaded.length, FILE_COUNT);

const downloadStarted = Date.now();
const downloaded = await inWaves(
  uploaded.map((file) => file.fileId),
  CONCURRENCY,
  downloadOne,
);
const downloadSeconds = (Date.now() - downloadStarted) / 1000;
assert.ok(downloaded.every((bytes) => bytes === FILE_BYTES), '下载字节数不匹配');

if (DROP_SOURCE) {
  await assertFreeSpace('before-drop');
  await rm(BENCH_DIR, { recursive: true, force: true });
  process.stdout.write('source dropped before backup\n');
}
await assertFreeSpace('before-backup');
await rm(REPO, { recursive: true, force: true });
const resticEnv = { RESTIC_REPOSITORY: REPO, RESTIC_PASSWORD_FILE: PASSWORD_FILE };
await run(RESTIC, ['init'], resticEnv);
const backupStarted = Date.now();
await run(RESTIC, ['backup', BACKUP_PATH, '--tag', 'c3-capacity', '--host', 'capacity-bench'], resticEnv);
const backupSeconds = (Date.now() - backupStarted) / 1000;

// 清理上传的基准文件与对象
for (const file of uploaded) {
  await fetch(`${API}/files/${file.fileId}`, { method: 'DELETE', headers });
}
for (const file of uploaded) {
  await fetch(`${API}/trash/${file.fileId}`, { method: 'DELETE', headers });
}
await rm(BENCH_DIR, { recursive: true, force: true });
await rm(REPO, { recursive: true, force: true });
await writeFile(PASSWORD_FILE, '', 'utf8').catch(() => undefined);

const report = {
  dataGB: Number((totalBytes / 1024 ** 3).toFixed(2)),
  files: FILE_COUNT,
  concurrency: CONCURRENCY,
  uploadSeconds: Number(uploadSeconds.toFixed(1)),
  uploadMBps: Number((totalBytes / 1024 ** 2 / uploadSeconds).toFixed(1)),
  downloadSeconds: Number(downloadSeconds.toFixed(1)),
  downloadMBps: Number((totalBytes / 1024 ** 2 / downloadSeconds).toFixed(1)),
  backupSeconds: Number(backupSeconds.toFixed(1)),
  backupMBps: Number((totalBytes / 1024 ** 2 / backupSeconds).toFixed(1)),
  backupPath: path.resolve(BACKUP_PATH),
  sourceDropped: DROP_SOURCE,
};
console.log(JSON.stringify(report));
