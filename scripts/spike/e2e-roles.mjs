// 角色 UI 验收：deputy / member 登录后的导航、项目可见性、文件页布局、越权页跳转。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP = process.env['APP_BASE'] ?? 'http://localhost:5173';
const PORT = 9337;
const CHROME =
  process.env['VD_CHROME_PATH'] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = process.env['VD_SHOTS_DIR'] ?? path.join(ROOT, '_private/shots');
const PROFILE =
  process.env['VD_CHROME_PROFILE'] ?? path.join(os.tmpdir(), 'vaultdeck-chrome-role');
const PROJECT_ID = 'f978c349-2dbc-4998-8367-3244e8762702'; // DEMO-001

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  writeFileSync(path.join(SHOTS, `role-${name}.png`), Buffer.from(image.result.data, 'base64'));
}

async function loginAs(client, username, password) {
  await client.send('Page.navigate', { url: `${APP}/login` });
  await wait(2000);
  await evaluate(client, `localStorage.clear(); 'ok'`);
  await client.send('Page.navigate', { url: `${APP}/login` });
  await wait(1500);
  await evaluate(
    client,
    `(() => {
      const set = (el, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        descriptor.set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = document.querySelectorAll('input');
      set(inputs[0], ${JSON.stringify(username)});
      set(document.querySelector('input[type=password]'), ${JSON.stringify(password)});
      document.querySelector('button[type=submit]').click();
      return 'ok';
    })()`,
  );
  assert.ok(await poll(client, `location.pathname === '/projects'`), `${username} 登录失败`);
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

  // deputy
  await loginAs(client, 'deputy', creds.deputy);
  const deputyNav = await evaluate(client, `document.querySelector('.vd-menu')?.innerText ?? ''`);
  for (const item of ['项目', '统计', '回收站', '操作日志']) {
    assert.ok(deputyNav.includes(item), `deputy 导航缺少 ${item}`);
  }
  for (const item of ['分类', '设置', '后台']) {
    assert.ok(!deputyNav.includes(item), `deputy 不应看到 ${item}`);
  }
  await shot(client, 'deputy-projects');
  assert.ok(
    !(await evaluate(client, `document.body.innerText.includes('新建项目')`)),
    'deputy 不应看到新建项目入口',
  );

  await client.send('Page.navigate', { url: `${APP}/projects/${PROJECT_ID}/files` });
  await wait(2000);
  assert.ok(await poll(client, `Boolean(document.querySelector('.vd-sider'))`), 'deputy 文件页未加载');
  const deputyFilesText = await evaluate(client, `document.body.innerText`);
  for (const item of ['上传', '新建']) {
    assert.ok(deputyFilesText.includes(item), `deputy 文件页缺少 ${item}`);
  }
  assert.ok(
    await evaluate(client, `Boolean(document.querySelector('button[title="文件夹管理"]'))`),
    'deputy 文件页缺少文件夹管理',
  );
  await shot(client, 'deputy-files');

  await client.send('Page.navigate', { url: `${APP}/audit` });
  await wait(1800);
  assert.equal(await evaluate(client, `location.pathname`), '/audit', 'deputy 应能访问操作日志');
  await shot(client, 'deputy-audit');

  await client.send('Page.navigate', { url: `${APP}/stats` });
  await wait(1800);
  assert.equal(await evaluate(client, `location.pathname`), '/stats', 'deputy 应能访问统计');

  // member
  await loginAs(client, 'member', creds.member);
  const memberNav = await evaluate(client, `document.querySelector('.vd-menu')?.innerText ?? ''`);
  for (const item of ['项目', '回收站']) {
    assert.ok(memberNav.includes(item), `member 导航缺少 ${item}`);
  }
  for (const item of ['统计', '分类', '操作日志', '设置', '后台']) {
    assert.ok(!memberNav.includes(item), `member 不应看到 ${item}`);
  }
  await shot(client, 'member-projects');

  await client.send('Page.navigate', { url: `${APP}/projects/${PROJECT_ID}/files` });
  await wait(2000);
  assert.ok(await poll(client, `Boolean(document.querySelector('.vd-sider'))`), 'member 文件页未加载');
  const memberFilesText = await evaluate(client, `document.body.innerText`);
  for (const item of ['上传', '新建']) {
    assert.ok(memberFilesText.includes(item), `member 文件页缺少 ${item}`);
  }
  assert.ok(
    await evaluate(client, `Boolean(document.querySelector('button[title="文件夹管理"]'))`),
    'member 文件页缺少文件夹管理',
  );
  await shot(client, 'member-files');

  // 越权页应跳回项目页
  await client.send('Page.navigate', { url: `${APP}/audit` });
  await wait(1500);
  assert.equal(await evaluate(client, `location.pathname`), '/projects', 'member 访问操作日志应被拦截');

  // 窄屏布局：不允许整页横向滚动
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await client.send('Page.navigate', { url: `${APP}/projects/${PROJECT_ID}/files` });
  await wait(2000);
  const overflow = await evaluate(
    client,
    `JSON.stringify({ doc: document.documentElement.scrollWidth, win: window.innerWidth })`,
  );
  const metrics = JSON.parse(overflow);
  assert.ok(metrics.doc <= metrics.win + 1, `窄屏出现整页横向滚动: ${overflow}`);
  await shot(client, 'member-files-mobile');

  client.close();
  console.log(
    JSON.stringify({
      deputy: { nav: 'ok', files: 'ok', audit: 'ok', stats: 'ok' },
      member: { nav: 'ok', files: 'ok', auditBlocked: true, mobileNoOverflow: true },
    }),
  );
} finally {
  chrome.kill();
  await wait(1500);
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    /* 忽略句柄延迟 */
  }
}
