import { writeFileSync } from 'node:fs';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const BASE = 'http://127.0.0.1:3000/api/v1';

const loginResponse = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'leader', password: creds.leader }),
});
const login = await loginResponse.json();
if (loginResponse.status !== 200) throw new Error(JSON.stringify(login));

const headers = { authorization: `Bearer ${login.token}` };
const projects = await (await fetch(`${BASE}/projects`, { headers })).json();
const project = projects.items.find((item) => item.projectCode === 'DEMO-001');
if (!project) throw new Error('未找到 DEMO-001');

const files = await (
  await fetch(`${BASE}/files?projectId=${project.projectId}`, { headers })
).json();

const snapshot = {
  projectId: project.projectId,
  total: files.total,
  names: files.items.map((item) => item.fileName).sort(),
};

const output = process.argv[2] ?? 'tmp/files-snapshot.json';
writeFileSync(output, JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify(snapshot, null, 2));
