import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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
const auth = (token) => ({ authorization: `Bearer ${token}` });

const initialResponse = await fetch(`${BASE}/system/settings`, { headers: auth(leader) });
const initial = await initialResponse.json();
assert.equal(initialResponse.status, 200);
assert.equal(initial.maxUploadBytes, 20 * 1024 * 1024 * 1024);
assert.equal(initial.instantUploadEnabled, true);

const patchResponse = await fetch(`${BASE}/system/settings`, {
  method: 'PATCH',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ maxUploadBytes: 1024 * 1024, instantUploadEnabled: false }),
});
const patched = await patchResponse.json();
assert.equal(patchResponse.status, 200, JSON.stringify(patched));
assert.equal(patched.maxUploadBytes, 1024 * 1024);
assert.equal(patched.instantUploadEnabled, false);

const projects = await (await fetch(`${BASE}/projects`, { headers: auth(leader) })).json();
const project = projects.items.find((item) => item.projectCode === 'DEMO-001');
const folders = await (
  await fetch(`${BASE}/folders?projectId=${project.projectId}`, { headers: auth(leader) })
).json();
const folder = folders.items[0];

const tooLarge = await fetch(`${BASE}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId: project.projectId,
    folderId: folder.folderId,
    fileName: '超限.bin',
    sizeBytes: 2 * 1024 * 1024,
    clientFingerprint: 'probe',
  }),
});
assert.equal(tooLarge.status, 400, '超过设置上限应 400');

const restoreLimit = await fetch(`${BASE}/system/settings`, {
  method: 'PATCH',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ maxUploadBytes: 20 * 1024 * 1024 * 1024 }),
});
assert.equal(restoreLimit.status, 200);

const payload = Buffer.from('settings-instant-probe');
const sha256 = createHash('sha256').update(payload).digest('hex');
const digest = createHash('sha256').update(payload).digest('base64');

const precheckNew = await fetch(`${BASE}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId: project.projectId,
    folderId: folder.folderId,
    fileName: '秒传开关测试.txt',
    sizeBytes: payload.length,
    sha256,
    clientFingerprint: 'probe',
  }),
});
const session = await precheckNew.json();
assert.equal(session.kind, 'new');

const chunk = await fetch(`${BASE}/upload-sessions/${session.sessionId}/chunks/0`, {
  method: 'PUT',
  headers: {
    ...auth(leader),
    'content-type': 'application/octet-stream',
    digest: `sha-256=${digest}`,
  },
  body: payload,
});
assert.equal(chunk.status, 200);

const complete = await fetch(`${BASE}/upload-sessions/${session.sessionId}/complete`, {
  method: 'POST',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ sha256 }),
});
assert.equal(complete.status, 200);

const precheckDisabled = await fetch(`${BASE}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId: project.projectId,
    folderId: folder.folderId,
    fileName: '秒传开关测试-副本.txt',
    sizeBytes: payload.length,
    sha256,
    clientFingerprint: 'probe',
  }),
});
const disabledResult = await precheckDisabled.json();
assert.notEqual(disabledResult.kind, 'instant', '关闭秒传后不应返回 instant');

await fetch(`${BASE}/system/settings`, {
  method: 'PATCH',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ instantUploadEnabled: true }),
});

const memberPatch = await fetch(`${BASE}/system/settings`, {
  method: 'PATCH',
  headers: { ...auth(member), 'content-type': 'application/json' },
  body: JSON.stringify({ maxUploadBytes: 1024 }),
});
assert.equal(memberPatch.status, 404, 'Member 不应能改设置');

console.log(
  JSON.stringify(
    {
      initialMaxUploadBytes: initial.maxUploadBytes,
      patchedMaxUploadBytes: patched.maxUploadBytes,
      overLimitStatus: tooLarge.status,
      instantDisabledKind: disabledResult.kind,
      memberPatchStatus: memberPatch.status,
    },
    null,
    2,
  ),
);
