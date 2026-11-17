// E2E：登录 → 上传 → 预览 → 删除 → 回收站彻底删除（无头 Chrome + CDP，走真实 UI）。
// 前置：Vite 5173、API 3000 在跑。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testCredentials as creds } from '../lib/test-credentials.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP = 'http://localhost:5173';
const API = 'http://127.0.0.1:3000/api/v1';
const PORT = 9334;
const CHROME =
  process.env['VD_CHROME_PATH'] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env['VD_E2E_TMP'] ?? path.join(os.tmpdir(), 'vaultdeck-e2e');
const SHOTS = process.env['VD_SHOTS_DIR'] ?? path.join(ROOT, '_private/shots');
const PROFILE =
  process.env['VD_CHROME_PROFILE'] ?? path.join(os.tmpdir(), 'vaultdeck-chrome-e2e');

function rmQuiet(target) {
  try {
    rmSync(target, { recursive: true, force: true });
  } catch {
    // Chrome 句柄释放稍慢，忽略
  }
}

rmQuiet(TMP);
rmQuiet(PROFILE);
mkdirSync(TMP, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const fileName = `e2e-${Date.now()}.png`;
const filePath = path.join(TMP, fileName);
writeFileSync(filePath, png);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiLogin() {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'leader', password: creds.leader }),
  });
  return (await response.json()).token;
}

const token = await apiLogin();
const authHeaders = { authorization: `Bearer ${token}` };
const projects = await (await fetch(`${API}/projects`, { headers: authHeaders })).json();
const demo = projects.items.find((item) => item.projectCode === 'DEMO-001') ?? projects.items[0];

async function listFiles() {
  return (await (await fetch(`${API}/files?projectId=${demo.projectId}`, { headers: authHeaders })).json()).items;
}

// 清理上次中断留下的 e2e 文件
for (const file of await listFiles()) {
  if (!file.fileName.startsWith('e2e-')) continue;
  await fetch(`${API}/files/${file.fileId}`, { method: 'DELETE', headers: authHeaders });
  await fetch(`${API}/trash/${file.fileId}`, { method: 'DELETE', headers: authHeaders });
}
for (const entry of (await (await fetch(`${API}/trash`, { headers: authHeaders })).json()).items) {
  if (entry.fileName.startsWith('e2e-')) {
    await fetch(`${API}/trash/${entry.fileId}`, { method: 'DELETE', headers: authHeaders });
  }
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
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

async function poll(client, expression, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return true;
    await wait(300);
  }
  return false;
}

async function shot(client, name) {
  const image = await client.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOTS, `e2e-${name}.png`);
  writeFileSync(file, Buffer.from(image.result.data, 'base64'));
  return file;
}

async function switchToList(client) {
  await evaluate(
    client,
    `(() => {
      const items = document.querySelectorAll('.ant-segmented-item');
      if (items[1]) items[1].click();
      return 'ok';
    })()`,
  );
  await wait(800);
}

async function clickRowAction(client, label) {
  return evaluate(
    client,
    `(() => {
      const row = [...document.querySelectorAll('tr')].find((item) => item.innerText.includes(${JSON.stringify(fileName)}));
      if (!row) return 'row-missing';
      const button = [...row.querySelectorAll('button')].find((item) => item.innerText.trim() === ${JSON.stringify(label)});
      if (!button) return 'button-missing';
      button.click();
      return 'ok';
    })()`,
  );
}

try {
  await waitForChrome();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((item) => item.type === 'page');
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('DOM.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // 1) 登录（真实表单）
  await client.send('Page.navigate', { url: `${APP}/login` });
  await wait(2500);
  await evaluate(
    client,
    `(() => {
      const set = (el, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        descriptor.set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = document.querySelectorAll('input');
      set(inputs[0], 'leader');
      set(document.querySelector('input[type=password]'), ${JSON.stringify(creds.leader)});
      document.querySelector('button[type=submit]').click();
      return 'ok';
    })()`,
  );
  assert.ok(await poll(client, `location.pathname === '/projects'`), '登录后未进入项目页');
  await shot(client, '1-projects');

  // 2) 上传：设置隐藏 file input，等待服务端真正出现该文件
  await client.send('Page.navigate', { url: `${APP}/projects/${demo.projectId}/files` });
  await wait(2000);
  assert.ok(await poll(client, `Boolean(document.querySelector('.vd-sider'))`), '文件页未加载');

  const documentNode = await client.send('DOM.getDocument', { depth: -1 });
  const fileInput = await client.send('DOM.querySelector', {
    nodeId: documentNode.result.root.nodeId,
    selector: 'input[type=file]',
  });
  await client.send('DOM.setFileInputFiles', { nodeId: fileInput.result.nodeId, files: [filePath] });

  let serverFile = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await wait(500);
    serverFile = (await listFiles()).find((file) => file.fileName === fileName);
    if (serverFile) break;
  }
  assert.ok(serverFile, '上传未在服务端完成');
  await client.send('Page.navigate', { url: `${APP}/projects/${demo.projectId}/files` });
  await wait(1800);
  assert.ok(
    await poll(client, `document.body.innerText.includes(${JSON.stringify(fileName)})`),
    '上传完成后列表未显示文件',
  );
  await switchToList(client);
  await shot(client, '2-files-uploaded');

  // 3) 预览
  assert.equal(await clickRowAction(client, '预览'), 'ok', '未找到预览按钮');
  assert.ok(await poll(client, `Boolean(document.querySelector('.ant-modal-content'))`, 15000), '预览弹窗未打开');
  await wait(600);
  await shot(client, '3-preview');
  await evaluate(client, `document.querySelector('.ant-modal-close')?.click(); 'ok'`);
  await wait(800);

  // 4) 删除到回收站（页面无二次确认）
  assert.equal(await clickRowAction(client, '删除'), 'ok', '未找到删除按钮');
  assert.ok(
    await poll(client, `!document.body.innerText.includes(${JSON.stringify(fileName)})`, 15000),
    '删除后列表仍显示文件',
  );

  // 5) 回收站：可见并彻底删除
  await client.send('Page.navigate', { url: `${APP}/trash` });
  await wait(1800);
  assert.ok(
    await poll(client, `document.body.innerText.includes(${JSON.stringify(fileName)})`, 15000),
    '回收站未出现刚删除的文件',
  );
  await shot(client, '4-trash');
  assert.equal(await clickRowAction(client, '彻底删除'), 'ok', '未找到彻底删除按钮');
  assert.ok(
    await poll(client, `!document.body.innerText.includes(${JSON.stringify(fileName)})`, 15000),
    '彻底删除后回收站仍显示该文件',
  );
  await shot(client, '5-trash-purged');

  client.close();
  console.log(
    JSON.stringify({ login: 'ok', upload: fileName, preview: 'ok', trash: 'ok', purged: true }),
  );
} finally {
  chrome.kill();
  await wait(1500);
  rmQuiet(TMP);
  rmQuiet(PROFILE);
}
