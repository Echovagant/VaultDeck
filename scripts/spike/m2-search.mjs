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

async function search(token, keyword) {
  const response = await fetch(`${BASE}/search?q=${encodeURIComponent(keyword)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  return { status: response.status, body };
}

const leader = await login('leader', creds.leader);
const member = await login('member', creds.member);

const leaderHit = await search(leader, '测试');
assert.equal(leaderHit.status, 200);
assert.ok(leaderHit.body.total >= 2, `Leader 应至少命中 2 条，实际 ${leaderHit.body.total}`);

const memberHidden = await search(member, '现场');
assert.equal(memberHidden.body.total, 0, 'Member 不应搜到他人上传的文件');

const memberOwn = await search(member, '队员');
assert.equal(memberOwn.body.total, 1, 'Member 应搜到自己上传的文件');

const tooShort = await search(leader, 'a');
assert.equal(tooShort.status, 400);
assert.equal(tooShort.body.code, 'VD-VAL-010');

console.log(
  JSON.stringify(
    {
      leaderTotal: leaderHit.body.total,
      leaderNames: leaderHit.body.items.map((item) => item.fileName),
      memberHiddenTotal: memberHidden.body.total,
      memberOwnTotal: memberOwn.body.total,
      shortKeywordStatus: tooShort.status,
    },
    null,
    2,
  ),
);
