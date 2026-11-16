// B2/B4 定时维护验证：tick 周期触发到期清理（回收站文件 + 对象回收 + 过期上传会话），
// 不依赖有人打开回收站。使用独立临时库与独立端口，不影响本机 :3000 服务。
// 用法：VD_DATABASE_URL=postgres://... node scripts/spike/m6-b2-tick-maintenance.mjs
// 前置：VD_DATABASE_URL 指向的 PG 账号可创建/删除测试库（脚本会创建并删除 vaultdeck_spk_b2_*）。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = '3932';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const STORAGE_ROOT = path.join(ROOT, '_private', 'spike-tmp', `m6b2-${Date.now().toString(36)}`);

function spawnNode(args, env) {
  return spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      // 根目录 tsconfig 是 solution 引用结构，装饰器配置在 apps/api/tsconfig.json
      TSX_TSCONFIG_PATH: path.join(ROOT, 'apps/api/tsconfig.json'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function killTree(child) {
  return new Promise((resolve) => {
    if (!child.pid) return resolve();
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
    } else {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    }
  });
}

function waitStdout(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    const onData = (chunk) => {
      stdout += chunk;
      if (pattern.test(stdout)) {
        cleanup();
        resolve(stdout);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待 ${pattern} 超时（${timeoutMs}ms），已收输出：\n${stdout}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', onData);
    }
    child.stdout.on('data', onData);
    child.on('exit', (code) => {
      cleanup();
      reject(new Error(`进程提前退出（code=${code}）`));
    });
  });
}

async function poll(fn, { timeoutMs = 20_000, stepMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

async function withClient(url, fn) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

async function json(pathname, token, init = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      ...auth(token),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function upload(token, projectId, folderId, fileName, content) {
  const sha256 = createHash('sha256').update(content).digest('hex');
  const digest = createHash('sha256').update(content).digest('base64');
  const pre = await json('/upload-sessions/precheck', token, {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      folderId,
      fileName,
      sizeBytes: content.length,
      sha256,
      clientFingerprint: 'm6-b2',
    }),
  });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  const chunk = await fetch(`${BASE}/upload-sessions/${pre.body.sessionId}/chunks/0`, {
    method: 'PUT',
    headers: { ...auth(token), 'content-type': 'application/octet-stream', digest: `sha-256=${digest}` },
    body: content,
  });
  assert.equal(chunk.status, 200);
  const complete = await json(`/upload-sessions/${pre.body.sessionId}/complete`, token, {
    method: 'POST',
    body: JSON.stringify({ sha256 }),
  });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  return { fileId: complete.body.fileId, sha256 };
}

const baseUrl = process.env['VD_DATABASE_URL'];
assert.ok(baseUrl && baseUrl.startsWith('postgres'), '需要 VD_DATABASE_URL（postgres://...）');

const scratchName = `vaultdeck_spk_b2_${Date.now().toString(36)}`;
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${scratchName}`;
const scratchUrlStr = scratchUrl.toString();

const runEnv = {
  VD_STORE: 'postgres',
  VD_DATABASE_URL: scratchUrlStr,
  PORT,
  HOST: '127.0.0.1',
  VD_BOOTSTRAP_DEMO: 'true',
  VD_DATA_ROOT: STORAGE_ROOT,
  VD_MAINTENANCE_TICK_MS: '800',
  VD_MAINTENANCE_INTERVAL_MS: '2000',
  VD_SESSION_TTL_MS: '1500',
};

let server = null;
let serverStdout = '';
try {
  await withClient(baseUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
    await client.query(`CREATE DATABASE "${scratchName}"`);
  });

  const migrate = spawnNode(['--import', 'tsx', 'apps/api/src/infrastructure/db/migrate-cli.ts'], {
    VD_DATABASE_URL: scratchUrlStr,
  });
  await new Promise((resolve, reject) => {
    let out = '';
    migrate.stdout.on('data', (chunk) => (out += chunk));
    migrate.stderr.on('data', (chunk) => (out += chunk));
    migrate.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`迁移失败：${out}`))));
    migrate.on('error', reject);
  });

  server = spawnNode(['--import', 'tsx', 'apps/api/src/main.ts'], runEnv);
  server.stdout.on('data', (chunk) => (serverStdout += chunk));
  server.stderr.on('data', (chunk) => (serverStdout += chunk));
  await waitStdout(server, /listening/, 45_000);

  const leader = (await (await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'leader', password: 'leader123' }),
  })).json()).token;

  const project = (await json('/projects', leader)).body.items.find((item) => item.projectCode === 'DEMO-001');
  assert.ok(project, '演示库应有 DEMO-001');
  const folder = (await json(`/folders?projectId=${project.projectId}`, leader)).body.items[0];
  assert.ok(folder, 'DEMO-001 应有文件夹');

  // —— B2：回收站到期文件由 tick 清理（全程不调用 /trash 列表，排除懒清理路径）——
  const file = await upload(leader, project.projectId, folder.folderId, 'm6-b2-到期清理.txt', Buffer.from(`m6-b2-${Date.now()}`));
  const trashed = await json(`/files/${file.fileId}`, leader, { method: 'DELETE' });
  assert.equal(trashed.status, 200, JSON.stringify(trashed.body));

  const objectBefore = await withClient(scratchUrlStr, (db) =>
    db.query('SELECT object_id, rel_path FROM stored_object WHERE sha256 = $1', [file.sha256]),
  );
  const objectRow = objectBefore.rows[0];
  assert.ok(objectRow, '上传后应有 stored_object 行');

  await withClient(scratchUrlStr, (db) =>
    db.query(`UPDATE file SET expire_at = now() - interval '1 minute' WHERE file_id = $1`, [file.fileId]),
  );

  const purged = await poll(() =>
    withClient(scratchUrlStr, (db) =>
      db
        .query('SELECT count(*)::int AS n FROM file WHERE file_id = $1', [file.fileId])
        .then((result) => result.rows[0].n === 0),
    ),
  );
  assert.ok(purged, '到期文件应被定时任务清理（20s 内）');
  assert.match(serverStdout, /purge_files=\d+/, '维护日志应记录本次清理');

  const objectAfter = await withClient(scratchUrlStr, (db) =>
    db.query('SELECT count(*)::int AS n FROM stored_object WHERE sha256 = $1', [file.sha256]),
  );
  assert.equal(objectAfter.rows[0].n, 0, 'ref_count 归零后对象行应删除');
  assert.equal(existsSync(objectRow.rel_path), false, '磁盘对象应删除');
  console.log('B2 通过：到期文件由 tick 清理，对象行与磁盘文件一并回收');

  // —— B4：过期上传会话与 staging 分片由 tick 清理 ——
  const pre = await json('/upload-sessions/precheck', leader, {
    method: 'POST',
    body: JSON.stringify({
      projectId: project.projectId,
      folderId: folder.folderId,
      fileName: 'm6-b2-半途中断.bin',
      sizeBytes: 1024,
      clientFingerprint: 'm6-b2',
    }),
  });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  assert.equal(pre.body.kind, 'new', JSON.stringify(pre.body));
  const chunkDir = path.join(STORAGE_ROOT, 'chunks', pre.body.sessionId);
  const chunk = await fetch(`${BASE}/upload-sessions/${pre.body.sessionId}/chunks/0`, {
    method: 'PUT',
    headers: { ...auth(leader), 'content-type': 'application/octet-stream' },
    body: Buffer.from('abandoned chunk'),
  });
  assert.equal(chunk.status, 200);
  assert.ok(existsSync(chunkDir), '分片应先落盘');

  const swept = await poll(() =>
    json(`/upload-sessions/${pre.body.sessionId}`, leader).then(
      (result) => result.status === 404,
    ),
  );
  assert.ok(swept, '过期上传会话应被定时清理（20s 内）');
  assert.equal(existsSync(chunkDir), false, 'staging 分片目录应删除');
  console.log('B4 通过：过期会话与 staging 分片由 tick 清理');

  console.log('PASS m6-b2-tick-maintenance');
} finally {
  if (server) await killTree(server);
  await withClient(baseUrl, (client) =>
    client.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
  ).catch(() => {});
  await rm(STORAGE_ROOT, { recursive: true, force: true }).catch(() => {});
}
