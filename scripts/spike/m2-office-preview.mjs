import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

const token = await login('leader', 'leader123');
const headers = { authorization: `Bearer ${token}` };

const projects = await (await fetch(`${BASE}/projects`, { headers })).json();
const project = projects.items.find((item) => item.projectCode === 'DEMO-001');
const folders = await (
  await fetch(`${BASE}/folders?projectId=${project.projectId}`, { headers })
).json();
const folder = folders.items[0];

const docx = readFileSync(path.resolve('_private/tmp/sample.docx'));
const sha256 = createHash('sha256').update(docx).digest('hex');

const precheckResponse = await fetch(`${BASE}/upload-sessions/precheck`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId: project.projectId,
    folderId: folder.folderId,
    fileName: 'Office预览测试.docx',
    sizeBytes: docx.length,
    sha256,
    clientFingerprint: 'probe',
  }),
});
const session = await precheckResponse.json();
assert.equal(precheckResponse.status, 200, JSON.stringify(session));

let fileId;
if (session.kind === 'instant') {
  fileId = session.fileId;
} else {
  const digest = createHash('sha256').update(docx).digest('base64');
  const chunkResponse = await fetch(`${BASE}/upload-sessions/${session.sessionId}/chunks/0`, {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      digest: `sha-256=${digest}`,
    },
    body: docx,
  });
  assert.equal(chunkResponse.status, 200);

  const completeResponse = await fetch(`${BASE}/upload-sessions/${session.sessionId}/complete`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });
  const file = await completeResponse.json();
  assert.equal(completeResponse.status, 200, JSON.stringify(file));
  fileId = file.fileId;
}

const startedAt = Date.now();
const previewResponse = await fetch(`${BASE}/files/${fileId}/preview`, { headers });
assert.equal(previewResponse.status, 200, `预览失败: ${previewResponse.status}`);
assert.ok(
  (previewResponse.headers.get('content-type') ?? '').includes('application/pdf'),
  '预览应返回 PDF',
);

const pdf = Buffer.from(await previewResponse.arrayBuffer());
const firstRunMs = Date.now() - startedAt;
assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF', 'PDF 魔数不正确');
assert.ok(pdf.byteLength > 1000, 'PDF 体积异常');

const cachedStartedAt = Date.now();
const cachedResponse = await fetch(`${BASE}/files/${fileId}/preview`, { headers });
assert.equal(cachedResponse.status, 200);
const cachedPdf = Buffer.from(await cachedResponse.arrayBuffer());
const cachedMs = Date.now() - cachedStartedAt;
assert.equal(cachedPdf.subarray(0, 4).toString('ascii'), '%PDF');

console.log(
  JSON.stringify(
    {
      fileId,
      pdfBytes: pdf.byteLength,
      magic: pdf.subarray(0, 4).toString('ascii'),
      firstRunMs,
      cachedMs,
    },
    null,
    2,
  ),
);
