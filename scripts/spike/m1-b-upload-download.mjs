import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const BASE = 'http://127.0.0.1:3000/api/v1';

async function login() {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'leader', password: 'leader123' }),
  });
  const data = await response.json();
  return data.token;
}

const token = await login();
const headers = { authorization: `Bearer ${token}` };

const projectResponse = await fetch(`${BASE}/projects`, { headers });
const projects = await projectResponse.json();
const demoProject =
  projects.items.find((item) => item.projectCode === 'DEMO-001') ?? projects.items[0];
const projectId = demoProject.projectId;

const folderResponse = await fetch(`${BASE}/folders?projectId=${projectId}`, { headers });
const folders = await folderResponse.json();
const folderId = folders.items[0].folderId;

const size = 20 * 1024 * 1024 + 123;
const payload = Buffer.alloc(size);
randomBytes(64).copy(payload, 0);
const sha256 = createHash('sha256').update(payload).digest('hex');

const precheck = await fetch(`${BASE}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId,
    folderId,
    fileName: '大文件测试.bin',
    sizeBytes: size,
    sha256,
    clientFingerprint: 'probe',
  }),
});
const session = await precheck.json();
assert.equal(precheck.status, 200, JSON.stringify(session));
assert.equal(session.kind, 'new');
assert.ok(session.chunkCount >= 3);

for (let index = 0; index < session.chunkCount; index += 1) {
  const start = index * session.chunkSize;
  const end = Math.min(size, start + session.chunkSize);
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
  assert.equal(response.status, 200, `chunk ${index} 上传失败`);
}

const completeResponse = await fetch(`${BASE}/upload-sessions/${session.sessionId}/complete`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ sha256 }),
});
const file = await completeResponse.json();
assert.equal(completeResponse.status, 200, JSON.stringify(file));
assert.equal(file.sizeBytes, size);
assert.equal(file.sha256, sha256);

const rangeResponse = await fetch(`${BASE}/files/${file.fileId}/content`, {
  headers: { ...headers, range: 'bytes=100-1099' },
});
assert.equal(rangeResponse.status, 206, 'Range 下载应返回 206');
const received = Buffer.from(await rangeResponse.arrayBuffer());
assert.equal(received.byteLength, 1000);
assert.deepEqual(received, payload.subarray(100, 1100));

const instantPrecheck = await fetch(`${BASE}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId,
    folderId,
    fileName: '大文件测试-副本.bin',
    sizeBytes: size,
    sha256,
    clientFingerprint: 'probe',
  }),
});
const instant = await instantPrecheck.json();
assert.equal(instant.kind, 'instant', '同 sha256 应命中秒传');

console.log(
  JSON.stringify(
    {
      sizeBytes: size,
      chunkCount: session.chunkCount,
      chunkSize: session.chunkSize,
      rangeBytes: received.byteLength,
      instantKind: instant.kind,
      fileId: file.fileId,
    },
    null,
    2,
  ),
);
