// B5/B6/B11 闭环：健康告警字段、磁盘低于 5% 拒写、启动清理 staging、应用层限流与安全响应头。
// 用一个独立实例（3101）验证，不打扰正在运行的 3000。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const databaseUrl = process.env['VD_DATABASE_URL'];
assert.ok(databaseUrl, '需要 VD_DATABASE_URL');

const dataRoot = process.env['VD_OPS_TMP'] ?? path.join(os.tmpdir(), 'vaultdeck-ops-test');
rmSync(dataRoot, { recursive: true, force: true });
mkdirSync(path.join(dataRoot, 'chunks', 'stale-session'), { recursive: true });
writeFileSync(path.join(dataRoot, 'chunks', 'stale-session', '0.part'), 'stale');

const child = spawn(process.execPath, [path.join(ROOT, 'apps/api/dist/main.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    VD_STORE: 'postgres',
    VD_DATABASE_URL: databaseUrl,
    VD_DATA_ROOT: dataRoot,
    VD_PREVIEW_CACHE: path.join(dataRoot, 'previews'),
    VD_MIGRATIONS_DIR: path.join(ROOT, 'apps/api/src/infrastructure/db/migrations'),
    VD_TEST_DISK_FREE_BYTES: '1024',
    VD_RATE_LIMIT_LOGIN: '3',
    VD_MAINTENANCE_TICK_MS: '600000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stdout += chunk));

async function waitHealth() {
  for (let index = 0; index < 40; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`${BASE}/system/health`);
      if (response.ok) return response;
    } catch {
      // 实例尚未监听
    }
  }
  throw new Error(`实例未就绪，输出：${stdout.slice(-800)}`);
}

try {
  const healthResponse = await waitHealth();
  const health = await healthResponse.json();

  assert.equal(health.status, 'degraded', '低磁盘应使健康状态降级');
  assert.equal(health.storage.writeBlocked, true, '低磁盘应标记禁止写入');
  assert.ok(
    health.alerts.some((alert) => alert.code === 'VD-ALERT-DISK-FULL'),
    '缺少磁盘告警',
  );
  assert.equal(
    healthResponse.headers.get('x-content-type-options'),
    'nosniff',
    '缺少安全响应头',
  );

  // B6：启动后 staging 残留应被清理
  assert.equal(
    existsSync(path.join(dataRoot, 'chunks', 'stale-session')),
    false,
    '启动未清理过期 staging',
  );

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'leader', password: creds.leader }),
  });
  assert.equal(login.status, 200, '登录失败');
  const { token } = await login.json();
  const headers = { authorization: `Bearer ${token}` };

  const projects = await (await fetch(`${BASE}/projects`, { headers })).json();
  const projectId = projects.items[0].projectId;
  const folders = await (await fetch(`${BASE}/folders?projectId=${projectId}`, { headers })).json();
  const folderId = folders.items[0].folderId;

  const precheck = await fetch(`${BASE}/upload-sessions/precheck`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      folderId,
      fileName: 'blocked.bin',
      sizeBytes: 1024,
      clientFingerprint: 'low-disk',
    }),
  });
  const blocked = await precheck.json();
  assert.equal(precheck.status, 507, JSON.stringify(blocked));
  assert.equal(blocked.code, 'VD-STO-507');

  // B11：登录桶限制 3 次/分钟，第 4 次应 429
  let lastStatus = 0;
  let lastResponse;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastResponse = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'leader', password: 'wrong-password' }),
    });
    lastStatus = lastResponse.status;
  }
  assert.equal(lastStatus, 429, `第 4 次登录应被限流，实际 ${lastStatus}`);
  assert.ok(
    String(lastResponse.headers.get('content-type')).startsWith('application/problem+json'),
  );
  assert.ok(Number(lastResponse.headers.get('retry-after')) >= 1);

  console.log(
    JSON.stringify({
      healthStatus: health.status,
      alerts: health.alerts.map((alert) => alert.code),
      writeBlocked: health.storage.writeBlocked,
      stagingReconciled: true,
      precheckStatus: precheck.status,
      rateLimitStatus: lastStatus,
    }),
  );
} finally {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  rmSync(dataRoot, { recursive: true, force: true });
}
