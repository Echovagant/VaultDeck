import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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
    headers: { ...auth(token), ...(init.headers ?? {}) },
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function uploadSmall(token, projectId, folderId, fileName, text) {
  const buffer = Buffer.from(`${text}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const digest = createHash('sha256').update(buffer).digest('base64');

  const pre = await json('/upload-sessions/precheck', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      folderId,
      fileName,
      sizeBytes: buffer.length,
      sha256,
      clientFingerprint: 'probe',
    }),
  });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));

  const chunk = await fetch(`${BASE}/upload-sessions/${pre.body.sessionId}/chunks/0`, {
    method: 'PUT',
    headers: {
      ...auth(token),
      'content-type': 'application/octet-stream',
      digest: `sha-256=${digest}`,
    },
    body: buffer,
  });
  assert.equal(chunk.status, 200);

  const complete = await json(`/upload-sessions/${pre.body.sessionId}/complete`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  return complete.body;
}

const leader = await login('leader', creds.leader);
const deputy = await login('deputy', creds.deputy);
const member = await login('member', creds.member);

const leaderProjects = (await json('/projects', leader)).body.items;
const deputyProjects = (await json('/projects', deputy)).body.items;
const memberProjects = (await json('/projects', member)).body.items;

assert.equal(leaderProjects.length, 2, 'Leader 应看到 2 个项目');
assert.equal(deputyProjects.length, 1, 'Deputy 只应看到所属项目');
assert.equal(memberProjects.length, 1, 'Member 只应看到所属项目');

const project = leaderProjects.find((item) => item.projectCode === 'DEMO-001');
const privateProject = leaderProjects.find((item) => item.projectCode === 'DEMO-002');

const leaderFolders = (await json(`/folders?projectId=${project.projectId}`, leader)).body.items;
const folder = leaderFolders[0];

const deniedFolder = await json(`/folders?projectId=${privateProject.projectId}`, member);
assert.equal(deniedFolder.status, 404, 'Member 访问未授权项目应 404');

const leaderFiles = (await json(`/files?projectId=${project.projectId}`, leader)).body.items;
const memberFiles = (await json(`/files?projectId=${project.projectId}`, member)).body.items;
assert.ok(leaderFiles.length >= 3, `Leader 应至少看到 3 个文件，实际 ${leaderFiles.length}`);
assert.equal(memberFiles.length, 1, 'Member 只应看到自己上传的文件');

const uploaded = await uploadSmall(
  leader,
  project.projectId,
  folder.folderId,
  '权限测试.txt',
  'permission probe',
);

const memberFilesAfter = (await json(`/files?projectId=${project.projectId}`, member)).body.items;
assert.equal(memberFilesAfter.length, 1, 'Member 不应看到别人新上传的文件');

const memberDelete = await json(`/files/${uploaded.fileId}`, member, { method: 'DELETE' });
assert.equal(memberDelete.status, 404, 'Member 删除他人文件应 404');

const memberOwnFile = memberFilesAfter[0];
const memberDeleteOwn = await json(`/files/${memberOwnFile.fileId}`, member, { method: 'DELETE' });
assert.equal(memberDeleteOwn.status, 200, 'Member 删除自己的文件应成功');

const memberTrash = (await json('/trash', member)).body.items;
assert.equal(memberTrash.length, 1, 'Member 回收站只应有自己的条目');

const memberRestore = await json(`/trash/${memberTrash[0].fileId}/restore`, member, {
  method: 'POST',
});
assert.equal(memberRestore.status, 201, `恢复应成功: ${JSON.stringify(memberRestore.body)}`);

const memberAudit = await json('/audit', member);
assert.equal(memberAudit.status, 404, 'Member 不应看到审计');

const leaderAudit = await json('/audit', leader);
assert.equal(leaderAudit.status, 200, 'Leader 应能查看审计');
assert.ok(leaderAudit.body.items.length >= 5, '审计应包含登录、上传、删除等');
const actions = new Set(leaderAudit.body.items.map((item) => item.action));
for (const action of ['auth.login', 'file.upload', 'file.trash', 'file.restore']) {
  assert.ok(actions.has(action), `审计缺少 ${action}`);
}

console.log(
  JSON.stringify(
    {
      projects: {
        leader: leaderProjects.length,
        deputy: deputyProjects.length,
        member: memberProjects.length,
      },
      files: { leader: leaderFiles.length, member: memberFiles.length },
      memberTrash: memberTrash.length,
      auditActions: [...actions].sort(),
    },
    null,
    2,
  ),
);
