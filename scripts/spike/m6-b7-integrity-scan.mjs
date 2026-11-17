// B7 闭环：完整性巡检能发现缺失/哈希不符对象与孤儿文件，清理后恢复通过。
// 运行：VD_DATA_ROOT=<VAULTDECK_HOME>/data/storage node scripts/spike/m6-b7-integrity-scan.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const BASE = 'http://127.0.0.1:3000/api/v1';
const DATA_ROOT = process.env['VD_DATA_ROOT'];
if (!DATA_ROOT) throw new Error('缺少 VD_DATA_ROOT');

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'leader', password: creds.leader }),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const headers = { authorization: `Bearer ${token}` };

async function scan() {
  const response = await fetch(`${BASE}/system/integrity/scan`, { method: 'POST', headers });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

const projects = await (await fetch(`${BASE}/projects`, { headers })).json();
const demo = projects.items.find((item) => item.projectCode === 'DEMO-001') ?? projects.items[0];

// 清理上次中断留下的探针（幂等）
for (const file of (
  await (await fetch(`${BASE}/files?projectId=${demo.projectId}`, { headers })).json()
).items) {
  if (!file.fileName.startsWith('integrity-probe-')) continue;
  await fetch(`${BASE}/files/${file.fileId}`, { method: 'DELETE', headers });
  await fetch(`${BASE}/trash/${file.fileId}`, { method: 'DELETE', headers });
}
for (const entry of (await (await fetch(`${BASE}/trash`, { headers })).json()).items) {
  if (entry.fileName.startsWith('integrity-probe-')) {
    await fetch(`${BASE}/trash/${entry.fileId}`, { method: 'DELETE', headers });
  }
}

const baseline = await scan();
assert.equal(baseline.ok, true, `基线巡检应通过：${JSON.stringify(baseline.issues)}`);
assert.equal(baseline.orphanFiles.length, 0);

const folders = await (
  await fetch(`${BASE}/folders?projectId=${demo.projectId}`, { headers })
).json();
const folderId = folders.items[0].folderId;

const payload = randomBytes(32 * 1024);
const sha256 = createHash('sha256').update(payload).digest('hex');
const precheck = await (
  await fetch(`${BASE}/upload-sessions/precheck`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: demo.projectId,
      folderId,
      fileName: `integrity-probe-${Date.now()}.bin`,
      sizeBytes: payload.length,
      sha256,
      clientFingerprint: 'm6-integrity',
    }),
  })
).json();
assert.equal(precheck.kind, 'new');
const chunkDigest = createHash('sha256').update(payload).digest('base64');
const chunkResponse = await fetch(`${BASE}/upload-sessions/${precheck.sessionId}/chunks/0`, {
  method: 'PUT',
  headers: {
    ...headers,
    'content-type': 'application/octet-stream',
    digest: `sha-256=${chunkDigest}`,
  },
  body: payload,
});
assert.equal(chunkResponse.status, 200);
const uploaded = await (
  await fetch(`${BASE}/upload-sessions/${precheck.sessionId}/complete`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  })
).json();

const objectFile = path.join(DATA_ROOT, 'objects', sha256.slice(0, 2), `${sha256}.bin`);
assert.ok(existsSync(objectFile), '探针对象未落盘');

// 篡改一个字节，保持文件大小不变
const original = readFileSync(objectFile);
const corrupted = Buffer.from(original);
corrupted[0] = corrupted[0] ^ 0xff;
writeFileSync(objectFile, corrupted);

const corruptedScan = await scan();
const issue = corruptedScan.issues.find((item) => item.sha256 === sha256);
assert.ok(issue, '巡检未发现损坏对象');
// 应用层加密后，翻转首字节会破坏 VDEN1 头：明文大小不可得时报告 size-mismatch，
// 头仍可识别但 GCM 校验失败时报告 hash-mismatch。
assert.ok(
  issue.reason === 'hash-mismatch' || issue.reason === 'size-mismatch',
  `损坏对象应被识别：${JSON.stringify(issue)}`,
);

const orphanDir = path.join(DATA_ROOT, 'objects', 'zz');
mkdirSync(orphanDir, { recursive: true });
const orphanFile = path.join(orphanDir, `orphan-${Date.now()}.bin`);
writeFileSync(orphanFile, 'orphan');
const orphanScan = await scan();
assert.ok(
  orphanScan.orphanFiles.some((item) => item.relPath.includes('objects/zz/')),
  '巡检未发现孤儿文件',
);

// 清理：删除探针文件与孤儿文件，再巡检应通过
await fetch(`${BASE}/files/${uploaded.fileId}`, { method: 'DELETE', headers });
await fetch(`${BASE}/trash/${uploaded.fileId}`, { method: 'DELETE', headers });
rmSync(orphanFile, { force: true });
rmSync(orphanDir, { recursive: true, force: true });

const finalScan = await scan();
assert.equal(finalScan.ok, true, `清理后巡检应通过：${JSON.stringify(finalScan.issues)}`);
assert.equal(finalScan.orphanFiles.length, 0);

console.log(
  JSON.stringify({
    baselineObjects: baseline.scannedObjects,
    detectedIssue: issue.reason,
    orphanDetected: true,
    finalOk: finalScan.ok,
  }),
);
