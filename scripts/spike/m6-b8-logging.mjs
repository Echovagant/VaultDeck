// B8 闭环：结构化 JSON 日志与字段脱敏；部署实例的访问日志也应是可解析的 JSON 行。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const loggerUrl = `file:///${ROOT.replaceAll('\\', '/')}/apps/api/dist/infrastructure/logging/logger.js`;
const script = `
  const { log } = await import('${loggerUrl}');
  log('info', 'test.redact', {
    username: 'leader',
    password: creds.leader,
    token: 'secret-token',
    nested: { authorization: 'Bearer abc' },
    ok: 1,
  });
  log('error', 'test.error', { error: 'boom' });
`;
const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
  encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr);
const lines = result.stdout.trim().split(/\r?\n/);
assert.equal(lines.length, 2);

const events = lines.map((line) => JSON.parse(line));
assert.equal(events[0].event, 'test.redact');
assert.equal(events[0].level, 'info');
assert.equal(events[0].password, '[redacted]');
assert.equal(events[0].token, '[redacted]');
assert.equal(events[0].nested.authorization, '[redacted]');
assert.equal(events[0].ok, 1);
assert.ok(!result.stdout.includes(creds.leader), '日志泄露了口令');
assert.ok(!result.stdout.includes('secret-token'), '日志泄露了令牌');
assert.equal(events[1].level, 'error');

// 部署实例的请求日志（可选：VD_LOG_FILE 指向 API 的 JSON 日志时校验最近一条 api.request）
const logFile = process.env['VD_LOG_FILE'];
let serviceLogOk = null;
if (logFile && existsSync(logFile)) {
  const tail = readFileSync(logFile, 'utf8').trim().split(/\r?\n/).slice(-20);
  const jsonLines = tail.filter((line) => line.startsWith('{'));
  serviceLogOk = jsonLines.length > 0 && jsonLines.every((line) => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  });
}

console.log(
  JSON.stringify({
    jsonLines: lines.length,
    redacted: true,
    leakFree: true,
    serviceLogJson: serviceLogOk,
  }),
);
