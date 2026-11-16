import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const generatedPath = path.join(root, 'packages/shared/src/generated/api.ts');
const tempDir = mkdtempSync(path.join(tmpdir(), 'vaultdeck-contract-'));
const tempFile = path.join(tempDir, 'api.ts');

function normalize(content) {
  return content.replace(/\r\n/g, '\n').trimEnd();
}

try {
  execSync(`npx openapi-typescript contracts/openapi/v1.yaml -o "${tempFile}"`, {
    cwd: root,
    stdio: 'pipe',
  });

  const expected = normalize(readFileSync(generatedPath, 'utf8'));
  const actual = normalize(readFileSync(tempFile, 'utf8'));

  if (expected !== actual) {
    console.error('契约生成物与 contracts/openapi/v1.yaml 不一致。');
    console.error('请执行 npm run contract:gen 并提交生成结果。');
    process.exitCode = 1;
  } else {
    console.log('契约生成物与 v1.yaml 一致。');
  }
} catch (error) {
  console.error('契约校验执行失败：', error.message);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
