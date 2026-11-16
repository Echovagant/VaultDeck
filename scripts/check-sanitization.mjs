import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const patterns = [
  { name: '盘符路径', pattern: /\b[A-Z]:\\/g },
  {
    name: '内网 IPv4',
    pattern: /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g,
  },
  { name: '设备型号关键词', pattern: /浪潮|NP5570|PM8222|Xeon\s+Silver\s+5218/gi },
  { name: '主机名占位符泄漏', pattern: /https?:\/\/[a-z0-9-]+\.(?:local|lan|internal)\b/gi },
];

const allowList = [
  { file: 'apps/web/src/pages/login/index.vue', reason: '演示账号口令，非真实凭据' },
  { file: 'contracts/openapi/v1.yaml', reason: '契约中的占位域名' },
  { file: 'scripts/check-sanitization.mjs', reason: '规则定义文件，关键词仅用于检测' },
];

function trackedFiles() {
  const output = execSync('git ls-files', { cwd: root, encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith('_private/'))
    .filter((file) => /\.(md|txt|ya?ml|json|ts|vue|ps1|mjs)$/.test(file));
}

const findings = [];

for (const file of trackedFiles()) {
  if (allowList.some((entry) => entry.file === file)) continue;
  let content;
  try {
    content = readFileSync(path.join(root, file), 'utf8');
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of patterns) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        findings.push({ file, line: index + 1, rule: rule.name, text: line.trim().slice(0, 120) });
      }
    }
  }
}

if (findings.length === 0) {
  console.log('脱敏检查通过：未发现盘符路径、内网地址或设备型号。');
  process.exit(0);
}

console.error(`脱敏检查失败：发现 ${findings.length} 处疑似敏感信息`);
for (const item of findings.slice(0, 50)) {
  console.error(`  ${item.file}:${item.line} [${item.rule}] ${item.text}`);
}
console.error('请将真实值移入 _private/ 并用占位符替代。');
process.exit(1);
