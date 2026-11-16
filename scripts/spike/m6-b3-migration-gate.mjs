// B3 启动迁移门禁验证：已应用迁移数必须覆盖迁移目录里的全部 .up.sql，缺任一版本拒绝启动。
// 用法：VD_DATABASE_URL=postgres://... node scripts/spike/m6-b3-migration-gate.mjs
// 前置：VD_DATABASE_URL 指向的 PG 账号可创建/删除测试库（脚本会创建并删除 vaultdeck_spk_b3_* 临时库）。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const GATE_MESSAGE = /数据库迁移不完整/;

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

function waitExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`进程未在 ${timeoutMs}ms 内退出`)), timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
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
      reject(new Error(`等待 ${pattern} 超时（${timeoutMs}ms），已收输出：\n${stdout}\n${stderr}`));
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

const baseUrl = process.env['VD_DATABASE_URL'];
assert.ok(baseUrl && baseUrl.startsWith('postgres'), '需要 VD_DATABASE_URL（postgres://...）');

const scratchName = `vaultdeck_spk_b3_${Date.now().toString(36)}`;
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${scratchName}`;
const scratchUrlStr = scratchUrl.toString();

const runEnv = {
  VD_STORE: 'postgres',
  VD_DATABASE_URL: scratchUrlStr,
  PORT: '3931',
  HOST: '127.0.0.1',
  VD_BOOTSTRAP_DEMO: 'false',
};

let okChild = null;
try {
  await withClient(baseUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
    await client.query(`CREATE DATABASE "${scratchName}"`);
  });

  // 1) 全量迁移到临时库
  const migrate = spawnNode(['--import', 'tsx', 'apps/api/src/infrastructure/db/migrate-cli.ts'], {
    VD_DATABASE_URL: scratchUrlStr,
  });
  const migrateExit = await waitExit(migrate, 60_000);
  assert.equal(migrateExit.code, 0, `迁移失败：${migrateExit.stderr}`);
  const appliedTotal = /applied_total=(\d+)/.exec(migrateExit.stdout)?.[1];
  assert.ok(appliedTotal && Number(appliedTotal) >= 1, `未解析到 applied_total：${migrateExit.stdout}`);
  console.log(`迁移完成 applied_total=${appliedTotal}`);

  // 2) 正向控制：迁移齐全 → 启动成功
  okChild = spawnNode(['--import', 'tsx', 'apps/api/src/main.ts'], runEnv);
  await waitStdout(okChild, /listening/, 45_000);
  console.log('正向控制通过：完整迁移可启动');
  await killTree(okChild);
  okChild = null;

  // 3) 反向：模拟旧库缺最新一个迁移 → 启动必须拒绝
  await withClient(scratchUrlStr, (client) =>
    client.query('DELETE FROM schema_migration WHERE version = (SELECT max(version) FROM schema_migration)'),
  );
  const badChild = spawnNode(['--import', 'tsx', 'apps/api/src/main.ts'], runEnv);
  const badExit = await waitExit(badChild, 45_000);
  assert.notEqual(badExit.code, 0, `缺迁移时启动不应成功，实际退出码 ${badExit.code}`);
  assert.match(`${badExit.stdout}\n${badExit.stderr}`, GATE_MESSAGE, '错误信息应说明迁移不完整');
  console.log(`反向验证通过：缺迁移启动被拒绝（exit=${badExit.code}，信息含“数据库迁移不完整”）`);

  await withClient(baseUrl, (client) =>
    client.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
  );
  console.log('PASS m6-b3-migration-gate');
} catch (error) {
  await withClient(baseUrl, (client) =>
    client.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`).catch(() => {}),
  ).catch(() => {});
  throw error;
} finally {
  if (okChild) await killTree(okChild);
}
