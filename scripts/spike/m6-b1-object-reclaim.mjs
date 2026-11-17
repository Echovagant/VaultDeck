// B1 对象回收验证：彻底删除后 file 行删除、stored_object ref_count 递减、归零即删对象行与磁盘文件。
// 用法：先启动加载了新代码的后端（VD_STORE=postgres），然后
// VD_DATABASE_URL=postgres://... node scripts/spike/m6-b1-object-reclaim.mjs
// 说明：直接读写后端所用数据库校验行级状态；rel_path 为磁盘对象的绝对路径。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

import { Client } from 'pg';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
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

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

async function json(path, token, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...auth(token), ...(init.headers ?? {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
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
      clientFingerprint: 'm6-b1',
    }),
  });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  assert.equal(pre.body.kind, 'new', `预检应为新会话：${JSON.stringify(pre.body)}`);

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

async function withDb(fn) {
  const client = new Client({ connectionString: process.env['VD_DATABASE_URL'] });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const objectRow = (sha256) =>
  withDb((db) =>
    db
      .query('SELECT object_id, ref_count, rel_path FROM stored_object WHERE sha256 = $1', [sha256])
      .then((result) => result.rows[0] ?? null),
  );

const fileCountByObject = (objectId) =>
  withDb((db) =>
    db
      .query('SELECT count(*)::int AS n FROM file WHERE object_id = $1', [objectId])
      .then((result) => result.rows[0].n),
  );

async function diskExists(relPath) {
  try {
    await stat(relPath);
    return true;
  } catch {
    return false;
  }
}

async function trashAndPurge(token, fileId) {
  const trashed = await json(`/files/${fileId}`, token, { method: 'DELETE' });
  assert.equal(trashed.status, 200, JSON.stringify(trashed.body));
  const purged = await json(`/trash/${fileId}`, token, { method: 'DELETE' });
  assert.equal(purged.status, 200, JSON.stringify(purged.body));
}

assert.ok(
  process.env['VD_DATABASE_URL']?.startsWith('postgres'),
  '需要 VD_DATABASE_URL（与后端 VD_STORE=postgres 同库）',
);

const leader = await login('leader', creds.leader);

const projects = (await json('/projects', leader)).body.items;
assert.ok(projects.length >= 1, 'Leader 应至少可见 1 个项目');
const project1 = projects[0];
const folders1 = (await json(`/folders?projectId=${project1.projectId}`, leader)).body.items;
let folder1 = folders1[0];
if (!folder1) {
  const created = await json('/folders', leader, {
    method: 'POST',
    body: JSON.stringify({ projectId: project1.projectId, folderName: 'm6-b1 资料' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  folder1 = created.body;
}

// —— Case A：单引用对象，彻底删除后对象行与磁盘文件都应消失 ——
const contentA = Buffer.from(`m6-b1-caseA-${Date.now()}-${Math.random().toString(36)}`);
const fileA = await upload(leader, project1.projectId, folder1.folderId, 'm6-b1-单引用.txt', contentA);

const rowA = await objectRow(fileA.sha256);
assert.ok(rowA, '上传后应有 stored_object 行');
assert.equal(rowA.ref_count, 1, `单引用 ref_count 应为 1，实际 ${rowA.ref_count}`);
assert.ok(await diskExists(rowA.rel_path), '磁盘对象应存在');

await trashAndPurge(leader, fileA.fileId);
assert.equal(await fileCountByObject(rowA.object_id), 0, 'file 行应已删除');
assert.equal(await objectRow(fileA.sha256), null, 'ref_count 归零后 stored_object 行应删除');
assert.equal(await diskExists(rowA.rel_path), false, '磁盘对象文件应删除');
console.log('Case A 通过：单引用对象随彻底删除被回收（DB 行 + 磁盘文件）');

// —— Case B：两个项目共享同一内容对象，删除一个文件只递减引用 ——
const projectCode = `M6B1${Date.now().toString(36).toUpperCase().slice(-6)}`;
const project2 = (
  await json('/projects', leader, {
    method: 'POST',
    body: JSON.stringify({ projectCode, projectName: 'm6-b1 临时项目' }),
  })
).body;
const folder2 = (
  await json('/folders', leader, {
    method: 'POST',
    body: JSON.stringify({ projectId: project2.projectId, folderName: 'm6-b1 资料' }),
  })
).body;

const contentB = Buffer.from(`m6-b1-caseB-${Date.now()}-${Math.random().toString(36)}`);
const fileB1 = await upload(leader, project1.projectId, folder1.folderId, 'm6-b1-共享.txt', contentB);
const fileB2 = await upload(leader, project2.projectId, folder2.folderId, 'm6-b1-共享.txt', contentB);

const rowB = await objectRow(fileB1.sha256);
assert.ok(rowB, '共享内容应有 stored_object 行');
assert.equal(rowB.ref_count, 2, `两个文件引用同一对象，ref_count 应为 2，实际 ${rowB.ref_count}`);
assert.equal(await fileCountByObject(rowB.object_id), 2, '应有两个 file 行指向该对象');

await trashAndPurge(leader, fileB1.fileId);
const rowAfterFirst = await objectRow(fileB1.sha256);
assert.ok(rowAfterFirst, '仍有引用时 stored_object 行应保留');
assert.equal(rowAfterFirst.ref_count, 1, `删除一个文件后 ref_count 应为 1，实际 ${rowAfterFirst.ref_count}`);
assert.ok(await diskExists(rowB.rel_path), '仍有引用时磁盘对象应保留');

await trashAndPurge(leader, fileB2.fileId);
assert.equal(await objectRow(fileB1.sha256), null, '最后一个引用删除后对象行应删除');
assert.equal(await diskExists(rowB.rel_path), false, '最后一个引用删除后磁盘对象应删除');
console.log('Case B 通过：共享对象按引用计数递减，归零后回收');

// —— 清理临时项目（真实库；audit_log 为 append-only 触发器保护，测试审计条目按设计保留） ——
await withDb((db) => db.query('DELETE FROM project_member WHERE project_id = $1', [project2.projectId]));
await withDb((db) => db.query('DELETE FROM folder WHERE project_id = $1', [project2.projectId]));
await withDb((db) => db.query('DELETE FROM project WHERE project_id = $1', [project2.projectId]));
console.log('已清理临时项目；审计条目按 append-only 设计保留');

console.log('PASS m6-b1-object-reclaim');
