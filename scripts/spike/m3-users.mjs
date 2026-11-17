import assert from 'node:assert/strict';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const BASE = 'http://127.0.0.1:3000/api/v1';

async function login(username, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, body: await response.json() };
}

const leaderLogin = await login('leader', creds.leader);
assert.equal(leaderLogin.status, 200);
const leader = leaderLogin.body.token;

const memberLogin = await login('member', creds.member);
const member = memberLogin.body.token;

const listResponse = await fetch(`${BASE}/users`, {
  headers: { authorization: `Bearer ${leader}` },
});
const list = await listResponse.json();
assert.equal(listResponse.status, 200);
assert.ok(list.items.length >= 3);

const forbidden = await fetch(`${BASE}/users`, {
  headers: { authorization: `Bearer ${member}` },
});
assert.equal(forbidden.status, 404, 'Member 不应能管理账号');

const username = 'qa-user';
const password = 'QaPass12345678';

let existing = list.items.find((item) => item.username === username);
if (!existing) {
  const createResponse = await fetch(`${BASE}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${leader}`, 'content-type': 'application/json' },
    body: JSON.stringify({ username, displayName: '质量测试', role: 'MEMBER', password }),
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, JSON.stringify(created));
  existing = created;
}

const duplicateResponse = await fetch(`${BASE}/users`, {
  method: 'POST',
  headers: { authorization: `Bearer ${leader}`, 'content-type': 'application/json' },
  body: JSON.stringify({ username, displayName: '重复', role: 'MEMBER', password }),
});
assert.equal(duplicateResponse.status, 409, '重复用户名应 409');

const promoteResponse = await fetch(`${BASE}/users/${existing.userId}`, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${leader}`, 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'DEPUTY_LEADER' }),
});
const promoted = await promoteResponse.json();
assert.equal(promoteResponse.status, 200);
assert.equal(promoted.role, 'DEPUTY_LEADER');

const originalLogin = await login(username, password);
assert.equal(originalLogin.status, 200, JSON.stringify(originalLogin.body));

const disableResponse = await fetch(`${BASE}/users/${existing.userId}`, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${leader}`, 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'disabled' }),
});
assert.equal(disableResponse.status, 200);

const disabledLogin = await login(username, password);
assert.equal(disabledLogin.status, 401, '停用账号不应能登录');

const enableResponse = await fetch(`${BASE}/users/${existing.userId}`, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${leader}`, 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'active' }),
});
assert.equal(enableResponse.status, 200);

const reenabledLogin = await login(username, password);
assert.equal(reenabledLogin.status, 200, '启用后应可登录');

console.log(
  JSON.stringify(
    {
      totalUsers: list.items.length,
      memberForbidden: forbidden.status,
      duplicateStatus: duplicateResponse.status,
      promotedRole: promoted.role,
      disabledLoginStatus: disabledLogin.status,
      reenabledLoginStatus: reenabledLogin.status,
    },
    null,
    2,
  ),
);
