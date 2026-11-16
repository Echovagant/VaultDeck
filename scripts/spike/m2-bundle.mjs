import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = 'http://127.0.0.1:3000/api/v1';

async function login(username, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data.token;
}

const leader = await login('leader', 'leader123');
const member = await login('member', 'member123');

const projects = await (
  await fetch(`${BASE}/projects`, { headers: { authorization: `Bearer ${leader}` } })
).json();
const project = projects.items.find((item) => item.projectCode === 'DEMO-001');

const files = await (
  await fetch(`${BASE}/files?projectId=${project.projectId}`, {
    headers: { authorization: `Bearer ${leader}` },
  })
).json();

assert.ok(!('objectPath' in files.items[0]), '文件列表不应暴露 objectPath');

const targets = files.items.filter((item) =>
  ['权限测试.txt', '大文件测试.bin'].includes(item.fileName),
);
assert.ok(targets.length >= 1, '至少需要一个真实文件用于打包');

const createResponse = await fetch(`${BASE}/bundles`, {
  method: 'POST',
  headers: { authorization: `Bearer ${leader}`, 'content-type': 'application/json' },
  body: JSON.stringify({ fileIds: targets.map((item) => item.fileId) }),
});
const bundle = await createResponse.json();
assert.equal(createResponse.status, 201, JSON.stringify(bundle));
assert.ok(bundle.totalBytes > 0);

const contentResponse = await fetch(`${BASE}/bundles/${bundle.bundleId}/content`, {
  headers: { authorization: `Bearer ${leader}` },
});
assert.equal(contentResponse.status, 200);
const buffer = Buffer.from(await contentResponse.arrayBuffer());
assert.equal(buffer[0], 0x50, 'ZIP 应以 P 开头');
assert.equal(buffer[1], 0x4b, 'ZIP 应以 K 开头');
writeFileSync(path.join(tmpdir(), 'vd-bundle.zip'), buffer);

const denied = await fetch(`${BASE}/bundles/${bundle.bundleId}/content`, {
  headers: { authorization: `Bearer ${member}` },
});
assert.equal(denied.status, 404, '其他用户不应能下载他人打包结果');

console.log(
  JSON.stringify(
    {
      files: targets.map((item) => item.fileName),
      bundleId: bundle.bundleId,
      zipBytes: buffer.byteLength,
      magic: buffer.subarray(0, 2).toString('ascii'),
      crossUserStatus: denied.status,
    },
    null,
    2,
  ),
);
