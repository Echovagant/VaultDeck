// B9 离线包冒烟验证：用发布包内自带的 Node 运行时跑包内后端产物，
// 用包内迁移目录初始化临时库，验证 node_modules 闭包完整、B3 门禁兼容部署形态、健康检查可用。
// 用法：VD_DATABASE_URL=<有 CREATEDB 权限的连接串> node scripts/spike/m6-b9-offline-smoke.mjs
// 可选：PACKAGE_DIR=<发布包目录>（默认取 releases/ 下最新的 *-offline）
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = '3933';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

function log(line) {
  process.stdout.write(`[smoke-b9] ${line}\n`);
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
    let stderr = '';
    const onData = (chunk) => {
      stdout += chunk;
      if (pattern.test(stdout)) {
        cleanup();
        resolve(stdout);
      }
    };
    const onErrData = (chunk) => (stderr += chunk);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待 ${pattern} 超时（${timeoutMs}ms）\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onErrData);
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onErrData);
    child.on('exit', (code) => {
      cleanup();
      reject(new Error(`进程提前退出（code=${code}）\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
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

async function newestPackage() {
  if (process.env['PACKAGE_DIR']) return path.resolve(process.env['PACKAGE_DIR']);
  const releasesDir = path.join(ROOT, 'releases');
  const names = (await readdir(releasesDir)).filter((name) => name.endsWith('-offline')).sort();
  if (names.length === 0) throw new Error('releases/ 下没有 *-offline 包，先跑 build-offline-package.mjs');
  return path.join(releasesDir, names[names.length - 1]);
}

const baseUrl = process.env['VD_DATABASE_URL'];
assert.ok(baseUrl && baseUrl.startsWith('postgres'), '需要 VD_DATABASE_URL（有 CREATEDB 权限）');

const pkg = await newestPackage();
const nodeExe = path.join(pkg, 'runtime', 'node', 'node.exe');
const mainJs = path.join(pkg, 'current', 'api', 'main.js');
const migrationsDir = path.join(pkg, 'current', 'migrations');
assert.ok(existsSync(nodeExe), `包内缺 node.exe：${nodeExe}`);
assert.ok(existsSync(mainJs), `包内缺 main.js：${mainJs}`);
assert.ok(existsSync(path.join(migrationsDir, '0001_init.up.sql')), '包内缺迁移目录');
log(`package=${path.basename(pkg)}`);

const scratchName = `vaultdeck_spk_b9_${Date.now().toString(36)}`;
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${scratchName}`;
const scratchUrlStr = scratchUrl.toString();

const dataRoot = path.join(ROOT, '_private', 'spike-tmp', `m6b9-${Date.now().toString(36)}`);
const runEnv = {
  VD_STORE: 'postgres',
  VD_DATABASE_URL: scratchUrlStr,
  VD_MIGRATIONS_DIR: migrationsDir,
  VD_DATA_ROOT: path.join(dataRoot, 'storage'),
  VD_PREVIEW_CACHE: path.join(dataRoot, 'previews'),
  VD_BOOTSTRAP_DEMO: 'true',
  PORT,
  HOST: '127.0.0.1',
};

let server = null;
let serverStdout = '';
try {
  await withClient(baseUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
    await client.query(`CREATE DATABASE "${scratchName}"`);
  });

  // 1) 用包内 node + 包内迁移目录跑迁移（部署形态的真实路径，无 tsx、无仓库目录）
  const migrate = spawn(nodeExe, [mainJs.replace('main.js', 'infrastructure/db/migrate-cli.js')], {
    cwd: path.join(pkg, 'current'),
    env: { ...process.env, ...runEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let migrateOut = '';
  migrate.stdout.on('data', (chunk) => (migrateOut += chunk));
  migrate.stderr.on('data', (chunk) => (migrateOut += chunk));
  const migrateExit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('迁移超时')), 60_000);
    migrate.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    migrate.on('error', reject);
  });
  assert.equal(migrateExit, 0, `包内迁移失败：${migrateOut.slice(-1000)}`);
  const migrationCount = (
    await readdir(path.join(pkg, 'current', 'migrations'))
  ).filter((name) => name.endsWith('.up.sql')).length;
  assert.match(
    migrateOut,
    new RegExp(`applied_total=${migrationCount}`),
    `应应用全部 ${migrationCount} 个迁移：${migrateOut}`,
  );
  log('包内迁移通过（bundled node + VD_MIGRATIONS_DIR）');

  // 2) 包内 node 启动后端
  server = spawn(nodeExe, [mainJs], {
    cwd: path.join(pkg, 'current'),
    env: { ...process.env, ...runEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => (serverStdout += chunk));
  server.stderr.on('data', (chunk) => (serverStdout += chunk));
  await waitStdout(server, /api\.started/, 45_000);
  assert.match(
    serverStdout,
    /maintenance\.scheduler_started/,
    '维护调度器应随包启动',
  );
  log('包内后端启动通过（node_modules 闭包完整、B3 门禁兼容 VD_MIGRATIONS_DIR）');

  // 3) 健康检查 + 登录 + 回收站列表
  const health = await fetch(`${BASE}/system/health`);
  assert.equal(health.status, 200, `system/health 应 200：${await health.text()}`);
  // 冒烟库是包内迁移新建的空库 + VD_BOOTSTRAP_DEMO=true，故使用代码种子口令
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'leader', password: 'leader123' }),
  });
  const loginBody = await login.json();
  assert.equal(login.status, 200, `登录应成功：${JSON.stringify(loginBody)}`);
  const token = loginBody.token;
  const trash = await fetch(`${BASE}/trash`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(trash.status, 200, '回收站列表应 200');
  log('健康检查 / 登录 / 业务接口通过');

  console.log('PASS m6-b9-offline-smoke');
} finally {
  if (server) await killTree(server);
  await withClient(baseUrl, (client) =>
    client.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
  ).catch(() => {});
  await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
}
