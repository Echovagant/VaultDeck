import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const token = await login('leader', 'leader123');
const headers = { authorization: `Bearer ${token}` };

const projects = await (await fetch(`${BASE}/projects`, { headers })).json();
const project = projects.items.find((item) => item.projectCode === 'DEMO-001');
const folders = await (
  await fetch(`${BASE}/folders?projectId=${project.projectId}`, { headers })
).json();
const folder = folders.items[0];

const docx = readFileSync(path.resolve('_private/tmp/sample-2.docx'));
const sha256 = createHash('sha256').update(docx).digest('hex');

const precheckResponse = await fetch(`${BASE}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId: project.projectId,
    folderId: folder.folderId,
    fileName: '预热测试-2.docx',
    sizeBytes: docx.length,
    sha256,
    clientFingerprint: 'probe',
  }),
});
const session = await precheckResponse.json();
assert.equal(precheckResponse.status, 200, JSON.stringify(session));

if (session.kind !== 'instant') {
  const digest = createHash('sha256').update(docx).digest('base64');
  const chunk = await fetch(`${BASE}/upload-sessions/${session.sessionId}/chunks/0`, {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      digest: `sha-256=${digest}`,
    },
    body: docx,
  });
  assert.equal(chunk.status, 200);

  const complete = await fetch(`${BASE}/upload-sessions/${session.sessionId}/complete`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });
  assert.equal(complete.status, 200);
}

const files = await (
  await fetch(`${BASE}/files?projectId=${project.projectId}`, { headers })
).json();
const uploaded = files.items.find((item) => item.fileName === '预热测试-2.docx');
assert.ok(uploaded, '应找到刚上传的文件');

const cachePath = path.resolve(`_private/storage/previews/${uploaded.fileId}.pdf`);
const waitStart = Date.now();
while (!existsSync(cachePath) && Date.now() - waitStart < 45000) {
  await sleep(1000);
}
assert.ok(existsSync(cachePath), '上传后应自动生成预览缓存');
const preheatMs = Date.now() - waitStart;

const previewStart = Date.now();
const previewResponse = await fetch(`${BASE}/files/${uploaded.fileId}/preview`, { headers });
const previewMs = Date.now() - previewStart;
assert.equal(previewResponse.status, 200);
const pdf = Buffer.from(await previewResponse.arrayBuffer());
assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
assert.ok(previewMs < 2000, `预热后预览应小于 2 秒，实际 ${previewMs}ms`);

console.log(
  JSON.stringify(
    {
      fileId: uploaded.fileId,
      preheatMs,
      previewMs,
      pdfBytes: pdf.byteLength,
    },
    null,
    2,
  ),
);
