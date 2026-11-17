// M6 存储对象路径闭环：存量文件可读、新上传落盘为相对键、删除后磁盘对象被回收。
// 运行：VD_DATA_ROOT=<VAULTDECK_HOME>/data/storage node scripts/spike/m6-object-relpath.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const BASE = process.env['VD_API_BASE'] ?? 'http://127.0.0.1:3000/api/v1';
const DATA_ROOT = process.env['VD_DATA_ROOT'];
if (!DATA_ROOT) throw new Error('缺少 VD_DATA_ROOT（部署实例的对象根目录）');
const objectPathFor = (sha256) =>
  path.join(DATA_ROOT, 'objects', sha256.slice(0, 2), `${sha256}.bin`);

const loginResponse = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'leader', password: creds.leader }),
});
assert.equal(loginResponse.status, 200, '登录失败');
const { token } = await loginResponse.json();
const headers = { authorization: `Bearer ${token}` };

const projects = await (await fetch(`${BASE}/projects`, { headers })).json();
const demo = projects.items.find((item) => item.projectCode === 'DEMO-001') ?? projects.items[0];
assert.ok(demo, '没有可用项目');
const folders = await (await fetch(`${BASE}/folders?projectId=${demo.projectId}`, { headers })).json();
const folderId = folders.items[0]?.folderId;
assert.ok(folderId, '项目没有文件夹');

// 1) 迁移后的存量文件：Range 读取应全部 206（证明相对键能在数据根下解析）
const fileList = await (await fetch(`${BASE}/files?projectId=${demo.projectId}`, { headers })).json();
let legacyChecked = 0;
for (const file of fileList.items) {
  if (!file.hasContent) continue;
  const response = await fetch(`${BASE}/files/${file.fileId}/content`, {
    headers: { ...headers, range: 'bytes=0-0' },
  });
  assert.equal(response.status, 206, `存量文件读取失败: ${file.fileName}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.byteLength, 1);
  legacyChecked += 1;
}
assert.ok(legacyChecked > 0, '没有可验证的存量文件');

// 2) 新上传：对象必须落到部署实例的数据根
const payload = randomBytes(64 * 1024);
const sha256 = createHash('sha256').update(payload).digest('hex');
const fileName = `relpath-probe-${Date.now()}.bin`;

const precheck = await fetch(`${BASE}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId: demo.projectId,
    folderId,
    fileName,
    sizeBytes: payload.length,
    sha256,
    clientFingerprint: 'm6-relpath',
  }),
});
const session = await precheck.json();
assert.equal(precheck.status, 200, JSON.stringify(session));
assert.equal(session.kind, 'new', '新内容不应命中秒传');

for (let index = 0; index < session.chunkCount; index += 1) {
  const start = index * session.chunkSize;
  const end = Math.min(payload.length, start + session.chunkSize);
  const chunk = payload.subarray(start, end);
  const digest = createHash('sha256').update(chunk).digest('base64');
  const response = await fetch(`${BASE}/upload-sessions/${session.sessionId}/chunks/${index}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      digest: `sha-256=${digest}`,
    },
    body: chunk,
  });
  assert.equal(response.status, 200, `分片 ${index} 上传失败`);
}

const complete = await fetch(`${BASE}/upload-sessions/${session.sessionId}/complete`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ sha256 }),
});
const uploaded = await complete.json();
assert.equal(complete.status, 200, JSON.stringify(uploaded));

const objectPath = objectPathFor(sha256);
assert.ok(existsSync(objectPath), `对象未落到数据根: ${objectPath}`);
const downloaded = Buffer.from(
  await (
    await fetch(`${BASE}/files/${uploaded.fileId}/content`, { headers })
  ).arrayBuffer(),
);
assert.equal(createHash('sha256').update(downloaded).digest('hex'), sha256);

// 3) 删除 + 永久删除：ref_count 归零后磁盘对象应被回收
assert.equal(
  (await fetch(`${BASE}/files/${uploaded.fileId}`, { method: 'DELETE', headers })).status,
  200,
);
assert.equal(
  (await fetch(`${BASE}/trash/${uploaded.fileId}`, { method: 'DELETE', headers })).status,
  200,
);
assert.equal(existsSync(objectPath), false, '永久删除后对象文件仍存在');

console.log(
  JSON.stringify({
    legacyFilesChecked: legacyChecked,
    uploadedBytes: payload.length,
    storedRelPath: path.relative(DATA_ROOT, objectPath).replaceAll('\\', '/'),
    purged: true,
  }),
);
