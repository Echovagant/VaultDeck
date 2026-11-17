import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const BASE = 'http://127.0.0.1:3000/api/v1';
const APP = 'http://localhost:5173';
const PORT = 9333;
const CHROME =
  process.env['VD_CHROME_PATH'] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT_DIR = path.resolve('_private/shots');
const PROFILE = path.resolve('_private/chrome-profile');

mkdirSync(OUT_DIR, { recursive: true });

async function login(username, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  if (response.status !== 200) throw new Error(JSON.stringify(body));
  return body.token;
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
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
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch {
      /* 端口未就绪 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const token = await login('leader', creds.leader);

try {
  await waitForChrome();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((item) => item.type === 'page');
  if (!page) throw new Error('未找到页面目标');

  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');

  const projects = await (
    await fetch(`${BASE}/projects`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();
  const project = projects.items.find((item) => item.projectCode === 'DEMO-001');

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send('Page.navigate', { url: `${APP}/login` });
  await wait(2600);
  await client.send('Network.enable');
  await client.send('Network.setCookie', {
    name: 'vd_session',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Strict',
  });
  await client.send('Runtime.evaluate', {
    expression: `localStorage.setItem('vd_theme', 'dark'); 'ok'`,
  });

  const pages = [
    { name: 'projects', path: '/projects' },
    { name: 'files', path: `/projects/${project.projectId}/files` },
    { name: 'settings', path: '/settings', desktopOnly: true },
    { name: 'trash', path: '/trash', desktopOnly: true },
    { name: 'categories', path: '/categories', desktopOnly: true },
  ];

  const viewports = [
    { label: 'desktop', width: 1440, height: 1000 },
    { label: 'laptop', width: 1180, height: 820 },
    { label: 'tablet', width: 900, height: 780 },
    { label: 'phone', width: 390, height: 844 },
  ];

  for (const target of pages) {
    for (const viewport of viewports) {
      if (target.desktopOnly && viewport.label !== 'desktop') continue;
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await client.send('Page.navigate', { url: `${APP}${target.path}` });
      await wait(500);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const readiness = await client.send('Runtime.evaluate', {
          expression:
            'Boolean(document.querySelector(".vd-sider") || document.querySelector(".login-page"))',
          returnByValue: true,
        });
        if (readiness.result.result.value) break;
        await wait(300);
      }
      await wait(500);
      await client.send('Runtime.evaluate', {
        expression: 'window.dispatchEvent(new Event("resize")); "ok"',
      });
      await wait(700);
      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT_DIR, `${viewport.label}-${target.name}.png`);
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'));

      const metrics = await client.send('Runtime.evaluate', {
        expression: `JSON.stringify({ doc: document.documentElement.scrollHeight, win: window.innerHeight, body: document.body.scrollHeight })`,
        returnByValue: true,
      });
      const value = JSON.parse(metrics.result.result.value);
      console.log(
        `${viewport.label}/${target.name} -> ${file} (docH=${value.doc} winH=${value.win} bodyH=${value.body})`,
      );

      if (target.name === 'files' && (viewport.label === 'phone' || viewport.label === 'desktop')) {
        await client.send('Runtime.evaluate', {
          expression: `document.querySelectorAll('.ant-segmented-item')[1]?.click(); 'ok'`,
        });
        await wait(700);
        const listShot = await client.send('Page.captureScreenshot', { format: 'png' });
        const listFile = path.join(OUT_DIR, `${viewport.label}-files-list.png`);
        writeFileSync(listFile, Buffer.from(listShot.result.data, 'base64'));
        console.log(`${viewport.label}/files-list -> ${listFile}`);
      }
    }
  }

  client.close();
} finally {
  chrome.kill();
}
