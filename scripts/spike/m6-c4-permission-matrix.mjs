// C4 权限矩阵：16 个端点 × 3 个角色 = 48 项断言，另加文件级读写删除 6 项。
// 运行：node scripts/spike/m6-c4-permission-matrix.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const BASE = 'http://127.0.0.1:3000/api/v1';

async function login(username, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `${username} 登录失败`);
  return (await response.json()).token;
}

async function call(token, method, path, body) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.status;
}

const leader = await login('leader', creds.leader);
const deputy = await login('deputy', creds.deputy);
const member = await login('member', creds.member);
const actors = { L: leader, D: deputy, M: member };

const projects = await (await fetch(`${BASE}/projects`, { headers: { authorization: `Bearer ${leader}` } })).json();
const demo = projects.items.find((item) => item.projectCode === 'DEMO-001') ?? projects.items[0];
const projectId = demo.projectId;
const folders = await (
  await fetch(`${BASE}/folders?projectId=${projectId}`, { headers: { authorization: `Bearer ${leader}` } })
).json();
const folderId = folders.items[0].folderId;

const users = await (await fetch(`${BASE}/users?pageSize=100`, { headers: { authorization: `Bearer ${leader}` } })).json();
const memberUser = users.items.find((item) => item.username === 'member');
assert.ok(memberUser, '缺少 member 账号');

const categories = await (await fetch(`${BASE}/categories`, { headers: { authorization: `Bearer ${leader}` } })).json();
const category = categories[0] ?? { categoryCode: 'DOC' };

async function upload(token, fileName) {
  const payload = randomBytes(4096);
  const sha256 = createHash('sha256').update(payload).digest('hex');
  const precheck = await (
    await fetch(`${BASE}/upload-sessions/precheck`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        folderId,
        fileName,
        sizeBytes: payload.length,
        sha256,
        clientFingerprint: 'c4-matrix',
      }),
    })
  ).json();
  const digest = createHash('sha256').update(payload).digest('base64');
  const chunk = await fetch(`${BASE}/upload-sessions/${precheck.sessionId}/chunks/0`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      digest: `sha-256=${digest}`,
    },
    body: payload,
  });
  assert.equal(chunk.status, 200);
  const completed = await fetch(`${BASE}/upload-sessions/${precheck.sessionId}/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });
  return completed.json();
}

// 清理上次中断留下的探针
for (const file of (await (await fetch(`${BASE}/files?projectId=${projectId}`, { headers: { authorization: `Bearer ${leader}` } })).json()).items) {
  if (file.fileName.startsWith('matrix-probe-')) {
    await call(leader, 'DELETE', `/files/${file.fileId}`);
  }
}
for (const entry of (await (await fetch(`${BASE}/trash`, { headers: { authorization: `Bearer ${leader}` } })).json()).items) {
  if (entry.fileName.startsWith('matrix-probe-')) await call(leader, 'DELETE', `/trash/${entry.fileId}`);
}

const leaderFile = await upload(leader, `matrix-probe-leader-${Date.now()}.bin`);
const memberFile = await upload(member, `matrix-probe-member-${Date.now()}.bin`);

const cases = [
  { name: 'GET /projects', method: 'GET', path: '/projects', expect: { L: 200, D: 200, M: 200 } },
  {
    name: 'POST /projects (duplicate)',
    method: 'POST',
    path: '/projects',
    body: { projectCode: demo.projectCode, projectName: 'dup' },
    expect: { L: 409, D: 404, M: 404 },
  },
  { name: 'GET project members', method: 'GET', path: `/projects/${projectId}/members`, expect: { L: 200, D: 200, M: 200 } },
  { name: 'GET /users', method: 'GET', path: '/users', expect: { L: 200, D: 404, M: 404 } },
  {
    name: 'PATCH /users/{member} no-op',
    method: 'PATCH',
    path: `/users/${memberUser.userId}`,
    body: { displayName: memberUser.displayName },
    expect: { L: 200, D: 404, M: 404 },
  },
  { name: 'GET /system/settings', method: 'GET', path: '/system/settings', expect: { L: 200, D: 200, M: 200 } },
  {
    name: 'PATCH /system/settings same value',
    method: 'PATCH',
    path: '/system/settings',
    body: { trashRetentionDays: 10 },
    expect: { L: 200, D: 404, M: 404 },
  },
  { name: 'POST /system/integrity/scan', method: 'POST', path: '/system/integrity/scan', expect: { L: 200, D: 404, M: 404 } },
  { name: 'GET /audit', method: 'GET', path: '/audit', expect: { L: 200, D: 200, M: 404 } },
  { name: 'GET /trash', method: 'GET', path: '/trash', expect: { L: 200, D: 200, M: 200 } },
  { name: 'GET /search', method: 'GET', path: '/search?q=probe', expect: { L: 200, D: 200, M: 200 } },
  { name: 'GET /stats/projects', method: 'GET', path: '/stats/projects', expect: { L: 200, D: 200, M: 200 } },
  { name: 'GET /categories', method: 'GET', path: '/categories', expect: { L: 200, D: 200, M: 200 } },
  {
    name: 'POST /categories (duplicate)',
    method: 'POST',
    path: '/categories',
    body: { categoryCode: category.categoryCode, categoryName: 'dup', extensions: ['.bin'] },
    expect: { L: 409, D: 404, M: 404 },
  },
  { name: 'GET /files', method: 'GET', path: `/files?projectId=${projectId}`, expect: { L: 200, D: 200, M: 200 } },
  {
    name: 'GET leader file content',
    method: 'GET',
    path: `/files/${leaderFile.fileId}/content`,
    expect: { L: 200, D: 200, M: 404 },
  },
];

let assertions = 0;
const failures = [];
for (const testCase of cases) {
  for (const [role, token] of Object.entries(actors)) {
    const status = await call(token, testCase.method, testCase.path, testCase.body);
    assertions += 1;
    if (status !== testCase.expect[role]) {
      failures.push(`${testCase.name} [${role}] 期望 ${testCase.expect[role]} 实际 ${status}`);
    }
  }
}
assert.equal(assertions, 48);
assert.deepEqual(failures, [], failures.join('\n'));

// 文件级：member 自己上传的文件三种角色都可读
for (const [role, token] of Object.entries(actors)) {
  const status = await call(token, 'GET', `/files/${memberFile.fileId}/content`);
  assert.equal(status, 200, `member 文件读取失败 [${role}]`);
}

// 删除权限：deputy 可删他人文件，member 不能删他人文件
const deputyProbe = await upload(leader, `matrix-probe-deputy-${Date.now()}.bin`);
assert.equal(await call(deputy, 'DELETE', `/files/${deputyProbe.fileId}`), 200);
const memberDeniedProbe = await upload(leader, `matrix-probe-denied-${Date.now()}.bin`);
assert.equal(await call(member, 'DELETE', `/files/${memberDeniedProbe.fileId}`), 404);
assert.equal(await call(leader, 'DELETE', `/files/${memberDeniedProbe.fileId}`), 200);

// 清理全部探针
for (const entry of (await (await fetch(`${BASE}/trash`, { headers: { authorization: `Bearer ${leader}` } })).json()).items) {
  if (entry.fileName.startsWith('matrix-probe-')) await call(leader, 'DELETE', `/trash/${entry.fileId}`);
}
for (const file of (await (await fetch(`${BASE}/files?projectId=${projectId}`, { headers: { authorization: `Bearer ${leader}` } })).json()).items) {
  if (file.fileName.startsWith('matrix-probe-')) {
    await call(leader, 'DELETE', `/files/${file.fileId}`);
    await call(leader, 'DELETE', `/trash/${file.fileId}`);
  }
}

console.log(JSON.stringify({ matrixAssertions: 48, extraAssertions: 6, failures: 0 }));
