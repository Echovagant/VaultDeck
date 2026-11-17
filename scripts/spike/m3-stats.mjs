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

const leaderStatsResponse = await fetch(`${BASE}/stats/projects`, {
  headers: { authorization: `Bearer ${leader}` },
});
const leaderStats = await leaderStatsResponse.json();
assert.equal(leaderStatsResponse.status, 200);
assert.equal(leaderStats.items.length, 2, 'Leader 应看到两个项目的统计');

const demo = leaderStats.items.find((item) => item.projectCode === 'DEMO-001');
assert.ok(demo);
assert.ok(demo.totalFiles >= 2, `DEMO-001 应有至少 2 个文件，实际 ${demo.totalFiles}`);
assert.ok(demo.groups.length >= 1, '应有类型分组');

const exportResponse = await fetch(`${BASE}/stats/exports`, {
  method: 'POST',
  headers: { authorization: `Bearer ${leader}`, 'content-type': 'application/json' },
  body: JSON.stringify({}),
});
const exportRecord = await exportResponse.json();
assert.equal(exportResponse.status, 201, JSON.stringify(exportRecord));

const csvResponse = await fetch(`${BASE}/stats/exports/${exportRecord.exportId}/content`, {
  headers: { authorization: `Bearer ${leader}` },
});
assert.equal(csvResponse.status, 200);
assert.ok((csvResponse.headers.get('content-type') ?? '').includes('text/csv'), '导出应为 CSV');
const csvBuffer = Buffer.from(await csvResponse.arrayBuffer());
assert.equal(csvBuffer[0], 0xef, 'CSV 应以 BOM 开头');
assert.equal(csvBuffer[1], 0xbb);
assert.equal(csvBuffer[2], 0xbf);
const csv = csvBuffer.toString('utf8');
assert.ok(csv.includes('项目编码'), 'CSV 应包含表头');

const memberStatsResponse = await fetch(`${BASE}/stats/projects`, {
  headers: { authorization: `Bearer ${member}` },
});
const memberStats = await memberStatsResponse.json();
assert.equal(memberStats.items.length, 1, 'Member 只应看到所属项目');
assert.equal(memberStats.items[0].totalFiles, 1, 'Member 统计只应包含本人可见文件');

console.log(
  JSON.stringify(
    {
      leaderProjects: leaderStats.items.length,
      demoFiles: demo.totalFiles,
      demoGroups: demo.groups.map((group) => `${group.type}:${group.count}`),
      memberProjects: memberStats.items.length,
      memberFiles: memberStats.items[0].totalFiles,
      csvBytes: Buffer.byteLength(csv),
    },
    null,
    2,
  ),
);
