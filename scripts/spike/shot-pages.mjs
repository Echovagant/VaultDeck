import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:3000/api/v1';
const APP = 'http://localhost:5173';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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

const token = await login('leader', 'leader123');

try {
  await waitForChrome();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((item) => item.type === 'page');
  if (!page) throw new Error('未找到页面目标');

  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await client.send('Page.navigate', { url: `${APP}/login` });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const projects = await (
    await fetch(`${BASE}/projects`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();
  const project = projects.items.find((item) => item.projectCode === 'DEMO-001');

  const pages = [
    { name: 'projects', path: '/projects' },
    { name: 'files', path: project ? `/projects/${project.projectId}/files` : '/projects' },
    { name: 'admin', path: '/admin' },
    { name: 'stats', path: '/stats' },
    { name: 'login', path: '/login' },
  ];

  for (const themeName of ['dark', 'light']) {
    await client.send('Runtime.evaluate', {
      expression: `localStorage.setItem('vd_token', ${JSON.stringify(
        token,
      )}); localStorage.setItem('vd_theme', '${themeName}'); 'ok'`,
    });

    for (const target of pages) {
      await client.send('Page.navigate', { url: `${APP}${target.path}` });
      await new Promise((resolve) => setTimeout(resolve, 2600));
      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT_DIR, `${themeName}-${target.name}.png`);
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
      console.log(`${themeName}/${target.name} -> ${file}`);
    }
  }

  await client.send('Page.navigate', { url: `${APP}/projects` });
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await client.send('Runtime.evaluate', {
    expression: `localStorage.setItem('vd_theme', 'dark'); 'ok'`,
  });
  await client.send('Page.reload');
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 150, y: 140 });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const hoverShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT_DIR, 'dark-hover.png'), Buffer.from(hoverShot.result.data, 'base64'));
  console.log('dark/hover -> dark-hover.png');

  client.close();
} finally {
  chrome.kill();
}
