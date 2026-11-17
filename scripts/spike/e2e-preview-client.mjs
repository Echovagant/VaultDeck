// E2E：验证 docx/xlsx 走浏览器端渲染（不经 LibreOffice），并检查渲染结果。
// 前置：Vite 5173、API 3000 在跑，且存在文件「预热测试-2.docx」与「preview-test.xlsx」。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP = process.env['APP_BASE'] ?? 'http://localhost:5173';
const API = 'http://127.0.0.1:3000/api/v1';
const PORT = 9336;
const CHROME =
  process.env['VD_CHROME_PATH'] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = process.env['VD_SHOTS_DIR'] ?? path.join(ROOT, '_private/shots');
const PROFILE =
  process.env['VD_CHROME_PROFILE'] ?? path.join(os.tmpdir(), 'vaultdeck-chrome-preview');

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'leader', password: creds.leader }),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const headers = { authorization: `Bearer ${token}` };
const projects = await (await fetch(`${API}/projects`, { headers })).json();
const demo = projects.items.find((item) => item.projectCode === 'DEMO-001') ?? projects.items[0];
const files = await (await fetch(`${API}/files?projectId=${demo.projectId}`, { headers })).json();
const docx = files.items.find((file) => file.fileName.endsWith('.docx'));
const xlsx = files.items.find((file) => file.fileName === 'preview-test.xlsx');
assert.ok(docx, '缺少 docx 测试文件');
assert.ok(xlsx, '缺少 preview-test.xlsx');

const health = await (await fetch(`${API}/system/health`)).json();
assert.equal(health.preview?.officeServer, true, '服务端高保真预览能力未上报');

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--ignore-certificate-errors',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1440,1000',
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForChrome() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch {
      /* 未就绪 */
    }
    await wait(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          return new Promise((done) => {
            const id = (nextId += 1);
            pending.set(id, done);
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
        },
      }),
    );
    socket.addEventListener('error', reject);
  });
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result?.result?.value;
}

async function poll(client, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return true;
    await wait(300);
  }
  return false;
}

async function shot(client, name) {
  const image = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, `e2e-preview-${name}.png`), Buffer.from(image.result.data, 'base64'));
}

async function openPreview(client, fileName) {
  const clicked = await evaluate(
    client,
    `(() => {
      const row = [...document.querySelectorAll('tr')].find((item) => item.innerText.includes(${JSON.stringify(fileName)}));
      if (!row) return 'row-missing';
      const button = [...row.querySelectorAll('button')].find((item) => item.innerText.trim() === '预览');
      if (!button) return 'button-missing';
      button.click();
      return 'ok';
    })()`,
  );
  assert.equal(clicked, 'ok', `无法打开预览: ${fileName}`);
}

try {
  await waitForChrome();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((item) => item.type === 'page');
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await client.send('Page.navigate', { url: `${APP}/login` });
  await wait(1500);
  await client.send('Network.enable');
  await client.send('Network.setCookie', {
    name: 'vd_session',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: APP.startsWith('https'),
    sameSite: 'Strict',
  });
  await client.send('Page.navigate', { url: `${APP}/projects/${demo.projectId}/files` });
  await wait(1800);
  assert.ok(await poll(client, `Boolean(document.querySelector('.vd-sider'))`), '文件页未加载');
  await evaluate(
    client,
    `(() => { const items = document.querySelectorAll('.ant-segmented-item'); if (items[1]) items[1].click(); return 'ok'; })()`,
  );
  await wait(800);

  // docx：浏览器端渲染
  await openPreview(client, docx.fileName);
  const docxReady = await poll(
    client,
    `(document.querySelector('.docx-container')?.innerHTML.length ?? 0) > 100`,
    30000,
  );
  if (!docxReady) {
    const diagnostic = await evaluate(
      client,
      `JSON.stringify({
        body: document.querySelector('.preview-body')?.innerText?.slice(0, 300) ?? '',
        empty: document.querySelector('.ant-empty-description')?.innerText ?? '',
        htmlLength: document.querySelector('.docx-container')?.innerHTML.length ?? -1
      })`,
    );
    await shot(client, 'docx-failed');
    console.error('docx diagnostic:', diagnostic);
  }
  assert.ok(docxReady, 'docx 未渲染出内容');
  await shot(client, 'docx');
  await evaluate(client, `document.querySelector('.ant-modal-close')?.click(); 'ok'`);
  await wait(600);

  // xlsx：浏览器端渲染成表格
  await openPreview(client, xlsx.fileName);
  assert.ok(
    await poll(client, `Boolean(document.querySelector('.sheet-table table'))`, 30000),
    'xlsx 未渲染出表格',
  );
  const text = await evaluate(client, `document.querySelector('.sheet-table')?.innerText ?? ''`);
  assert.ok(text.includes('张三') && text.includes('李四'), `表格内容不符: ${text.slice(0, 80)}`);
  await shot(client, 'xlsx');

  client.close();
  console.log(JSON.stringify({ docx: docx.fileName, xlsx: xlsx.fileName, rendered: true }));
} finally {
  chrome.kill();
  await wait(1500);
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    /* 忽略句柄延迟 */
  }
}
