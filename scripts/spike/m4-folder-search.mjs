import assert from 'node:assert/strict';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
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

const leader = await login('leader', creds.leader);
const member = await login('member', creds.member);
const auth = (token) => ({ authorization: `Bearer ${token}` });

const projectsResponse = await fetch(`${BASE}/projects`, { headers: auth(leader) });
const projectsData = await projectsResponse.json();
const demo2 = projectsData.items.find((item) => item.projectCode === 'DEMO-002');
assert.ok(demo2, '应存在 DEMO-002');

const createFolderResponse = await fetch(`${BASE}/folders`, {
  method: 'POST',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ projectId: demo2.projectId, folderName: '内部资料', parentId: null }),
});
assert.ok(
  [201, 409].includes(createFolderResponse.status),
  `创建文件夹返回 ${createFolderResponse.status}`,
);

const leaderResponse = await fetch(`${BASE}/folders/search?q=${encodeURIComponent('资料')}`, {
  headers: auth(leader),
});
const leaderResult = await leaderResponse.json();
assert.equal(leaderResponse.status, 200, JSON.stringify(leaderResult));
assert.ok(
  leaderResult.items.length >= 2,
  `Leader 应至少命中 2 个文件夹，实际 ${leaderResult.items.length}`,
);

const projects = new Set(leaderResult.items.map((item) => item.projectName));
assert.ok(projects.size >= 2, '应跨项目命中');

const memberResponse = await fetch(`${BASE}/folders/search?q=${encodeURIComponent('内部')}`, {
  headers: auth(member),
});
const memberResult = await memberResponse.json();
assert.equal(memberResponse.status, 200);
assert.equal(memberResult.items.length, 0, 'Member 不应搜到不可见项目的文件夹');

const emptyResponse = await fetch(`${BASE}/folders/search?q=`, { headers: auth(leader) });
assert.equal(emptyResponse.status, 400, '空关键词应 400');

console.log(
  JSON.stringify(
    {
      leaderHits: leaderResult.items.map((item) => `${item.projectName}/${item.folderName}`),
      crossProjects: projects.size,
      memberHits: memberResult.items.length,
      emptyStatus: emptyResponse.status,
    },
    null,
    2,
  ),
);
