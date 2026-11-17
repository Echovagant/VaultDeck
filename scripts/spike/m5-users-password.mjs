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

async function call(pathname, headers, init = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const leader = await login('leader', creds.leader);
assert.equal(leader.status, 200, JSON.stringify(leader.body));
const leaderAuth = { authorization: `Bearer ${leader.body.token}` };

const users = await call('/users', leaderAuth);
assert.equal(users.status, 200);
const member = users.body.items.find((item) => item.username === 'member');
assert.ok(member, '未找到 member 账号');

const memberLogin = await login('member', creds.member);
assert.equal(memberLogin.status, 200, JSON.stringify(memberLogin.body));
const memberAuth = { authorization: `Bearer ${memberLogin.body.token}` };

const deputy = await login('deputy', creds.deputy);
assert.equal(deputy.status, 200, JSON.stringify(deputy.body));
const deputyAuth = { authorization: `Bearer ${deputy.body.token}` };

const tooShort = await call(`/users/${member.userId}`, leaderAuth, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: '1234567' }),
});
assert.equal(tooShort.status, 400, '7 位口令应被拒绝');

const forbidden = await call(`/users/${member.userId}`, deputyAuth, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'DeputyTried123' }),
});
assert.equal(forbidden.status, 404, '非领队重置口令应 404');

const reset = await call(`/users/${member.userId}`, leaderAuth, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'MemberTemp123' }),
});
assert.equal(reset.status, 200, JSON.stringify(reset.body));

const oldSession = await call('/auth/me', memberAuth);
assert.equal(oldSession.status, 401, '重置口令后原会话应失效');

const oldPassword = await login('member', creds.member);
assert.equal(oldPassword.status, 401, '旧口令应失效');

const newLogin = await login('member', 'MemberTemp123');
assert.equal(newLogin.status, 200, JSON.stringify(newLogin.body));

const restore = await call(`/users/${member.userId}`, leaderAuth, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: creds.member }),
});
assert.equal(restore.status, 200);

const restored = await login('member', creds.member);
assert.equal(restored.status, 200, JSON.stringify(restored.body));

const leaderStillValid = await call('/auth/me', leaderAuth);
assert.equal(leaderStillValid.status, 200, '重置他人口令不应影响领队会话');

const audit = await call('/audit?pageSize=20', leaderAuth);
assert.equal(audit.status, 200);
const resetEntry = audit.body.items.find((item) => item.action === 'user.password_reset');
assert.ok(resetEntry, '未写入 password_reset 审计');
assert.ok(!JSON.stringify(resetEntry).includes('MemberTemp123'), '审计不得包含明文口令');

console.log(
  JSON.stringify(
    {
      tooShort: tooShort.status,
      forbidden: forbidden.status,
      reset: reset.status,
      oldSessionRevoked: oldSession.status,
      oldPasswordRejected: oldPassword.status,
      newPasswordLogin: newLogin.status,
      restored: restored.status,
      leaderSessionKept: leaderStillValid.status,
      auditAction: resetEntry.action,
    },
    null,
    2,
  ),
);
