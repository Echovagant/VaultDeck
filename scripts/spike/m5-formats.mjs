import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { buildZip } from './lib/zip.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const TMP = path.resolve('_private/tmp');

const digest = (buffer, encoding = 'hex') => createHash('sha256').update(buffer).digest(encoding);

function chunk(buffer, size) {
  const parts = [];
  for (let start = 0; start < buffer.length; start += size) {
    parts.push(buffer.subarray(start, Math.min(buffer.length, start + size)));
  }
  return parts;
}

function buildPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      raw[offset] = (x * 4) % 256;
      raw[offset + 1] = (y * 4) % 256;
      raw[offset + 2] = 160;
    }
  }
  const block = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block('IHDR', header),
    block('IDAT', deflateSync(raw)),
    block('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function login(username, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.token;
}

async function call(pathname, headers, init = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  return response;
}

async function upload(headers, input) {
  const sha256 = digest(input.buffer);
  const precheck = await call('/upload-sessions/precheck', headers, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: input.projectId,
      folderId: input.folderId,
      fileName: input.fileName,
      sizeBytes: input.buffer.length,
      sha256,
      clientFingerprint: 'format-probe',
    }),
  });
  const session = await precheck.json();
  assert.equal(precheck.status, 200, JSON.stringify(session));
  if (session.kind === 'instant') {
    return { file: { fileId: session.fileId }, mode: 'instant', sha256 };
  }

  const parts = chunk(input.buffer, session.chunkSize);
  assert.equal(parts.length, session.chunkCount);
  for (const [index, part] of parts.entries()) {
    const response = await call(`/upload-sessions/${session.sessionId}/chunks/${index}`, headers, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        digest: `sha-256=${digest(part, 'base64')}`,
      },
      body: part,
    });
    assert.equal(response.status, 200, `分片 ${index} 上传失败`);
  }

  const complete = await call(`/upload-sessions/${session.sessionId}/complete`, headers, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });
  const file = await complete.json();
  assert.equal(complete.status, 200, JSON.stringify(file));
  return { file, mode: 'new', sha256 };
}

const token = await login('leader', 'leader123');
const headers = { authorization: `Bearer ${token}` };

const projects = await (await call('/projects', headers)).json();
const project = projects.items.find((item) => item.projectCode === 'DEMO-001');
assert.ok(project, '未找到 DEMO-001');
const folders = await (await call(`/folders?projectId=${project.projectId}`, headers)).json();
const folderId = folders.items[0].folderId;

const csv = readFileSync(path.join(TMP, 'sample.csv'));
const zipBuffer = buildZip([
  { name: 'notes.csv', data: csv },
  { name: 'readme.txt', data: 'VaultDeck zip 打包测试\n' },
]);

const samples = [
  { fileName: '格式测试.csv', buffer: csv, preview: false },
  { fileName: '格式测试.docx', buffer: readFileSync(path.join(TMP, 'sample.docx')), preview: true },
  { fileName: '格式测试.xlsx', buffer: readFileSync(path.join(TMP, 'sample.xlsx')), preview: true },
  { fileName: '格式测试.pptx', buffer: readFileSync(path.join(TMP, 'sample.pptx')), preview: true },
  { fileName: '格式测试.pdf', buffer: readFileSync(path.join(TMP, 'sample.pdf')), preview: false },
  { fileName: '格式测试.png', buffer: buildPng(64, 64), preview: false },
  { fileName: '格式测试.zip', buffer: zipBuffer, preview: false },
  { fileName: '格式测试.bin', buffer: randomBytes(20 * 1024 * 1024 + 321), preview: false },
];

const results = [];
const created = [];

try {
  for (const sample of samples) {
    const uploaded = await upload(headers, {
      projectId: project.projectId,
      folderId,
      fileName: sample.fileName,
      buffer: sample.buffer,
    });
    created.push(uploaded.file.fileId);

    const detail = await (await call(`/files/${uploaded.file.fileId}`, headers)).json();
    assert.equal(detail.sizeBytes, sample.buffer.length, `${sample.fileName} 大小不符`);
    assert.equal(detail.sha256, uploaded.sha256, `${sample.fileName} 哈希不符`);

    const full = await call(`/files/${uploaded.file.fileId}/content`, headers);
    assert.equal(full.status, 200);
    const fullBytes = Buffer.from(await full.arrayBuffer());
    assert.equal(fullBytes.length, sample.buffer.length, `${sample.fileName} 下载长度不符`);
    assert.equal(digest(fullBytes), uploaded.sha256, `${sample.fileName} 下载内容不符`);

    const rangeBytes = Buffer.from(
      await (
        await call(`/files/${uploaded.file.fileId}/content`, headers, {
          headers: { range: 'bytes=0-15' },
        })
      ).arrayBuffer(),
    );
    assert.equal(rangeBytes.toString('base64'), sample.buffer.subarray(0, 16).toString('base64'));

    const second = await call('/upload-sessions/precheck', headers, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.projectId,
        folderId,
        fileName: `副本-${sample.fileName}`,
        sizeBytes: sample.buffer.length,
        sha256: uploaded.sha256,
        clientFingerprint: 'format-probe',
      }),
    });
    const secondBody = await second.json();
    assert.equal(secondBody.kind, 'instant', `${sample.fileName} 秒传未命中`);

    let preview = 'skip';
    if (sample.preview) {
      const previewResponse = await call(`/files/${uploaded.file.fileId}/preview`, headers);
      assert.equal(previewResponse.status, 200, `${sample.fileName} 预览失败`);
      assert.match(previewResponse.headers.get('content-type') ?? '', /application\/pdf/);
      const pdfBytes = Buffer.from(await previewResponse.arrayBuffer());
      assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');
      preview = `${pdfBytes.length}B`;
    }

    results.push({
      fileName: sample.fileName,
      size: sample.buffer.length,
      upload: uploaded.mode,
      instantRetry: secondBody.kind,
      range: rangeBytes.length,
      preview,
    });
  }
} finally {
  for (const fileId of created) {
    await call(`/files/${fileId}`, headers, { method: 'DELETE' });
  }
}

console.log(JSON.stringify({ project: project.projectCode, folderId, results }, null, 2));
