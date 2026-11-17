// 测试脚本统一口令入口：优先环境变量（VD_LEADER_PASSWORD 等），其次本机私有凭据文件，
// 最后回退到代码种子口令（仅适用于 VD_BOOTSTRAP_DEMO=true 初始化出来的全新演示库）。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FILE =
  process.env['VD_TEST_CREDENTIALS_FILE'] ?? path.join(ROOT, '_private', 'new-credentials.txt');

function readPrivateFile() {
  if (!existsSync(FILE)) return {};
  const result = {};
  for (const line of readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const match = /^(leader|deputy|member)=(.+)$/.exec(line.trim());
    if (match) result[match[1]] = match[2];
  }
  return result;
}

const file = readPrivateFile();
const pick = (name, demo) => process.env[`VD_${name.toUpperCase()}_PASSWORD`] ?? file[name] ?? demo;

export const testCredentials = {
  leader: pick('leader', 'leader123'),
  deputy: pick('deputy', 'deputy123'),
  member: pick('member', 'member123'),
};
