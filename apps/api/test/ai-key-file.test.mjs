import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  aiSecretsDir,
  loadPersistedAiKey,
  loadPersistedAiProfile,
  persistAiKey,
  persistAiProfile,
} from '../src/infrastructure/secrets/ai-key-file.ts';

const SAVED_APPDATA = process.env['APPDATA'];
const SAVED_OVERRIDE = process.env['VD_AI_SECRETS_DIR'];
let workDir = null;

function useTempDir() {
  workDir = mkdtempSync(path.join(tmpdir(), 'vd-ai-key-'));
  process.env['VD_AI_SECRETS_DIR'] = workDir;
  return workDir;
}

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = null;
  if (SAVED_APPDATA === undefined) delete process.env['APPDATA'];
  else process.env['APPDATA'] = SAVED_APPDATA;
  if (SAVED_OVERRIDE === undefined) delete process.env['VD_AI_SECRETS_DIR'];
  else process.env['VD_AI_SECRETS_DIR'] = SAVED_OVERRIDE;
});

describe('ai-key-file 仓库外持久化', () => {
  it('密封落盘后解密回装一致', () => {
    const dir = useTempDir();
    assert.equal(persistAiKey('sk-test-1234567890'), true);
    assert.equal(loadPersistedAiKey(), 'sk-test-1234567890');
    assert.ok(existsSync(path.join(dir, 'ai-master.key')));
    assert.ok(existsSync(path.join(dir, 'ai-api-key.bin')));
  });

  it('磁盘上没有明文：密文文件不含原始 key', () => {
    const dir = useTempDir();
    const secret = 'sk-plain-marker-abcdef';
    persistAiKey(secret);
    const raw = readFileSync(path.join(dir, 'ai-api-key.bin')).toString('latin1');
    assert.equal(raw.includes(secret), false);
  });

  it('重复保存走覆盖，读到新值', () => {
    useTempDir();
    persistAiKey('first-key-value');
    persistAiKey('second-key-value');
    assert.equal(loadPersistedAiKey(), 'second-key-value');
  });

  it('清除（null）删除密文文件，读取为 null', () => {
    const dir = useTempDir();
    persistAiKey('to-be-cleared');
    assert.equal(persistAiKey(null), true);
    assert.equal(existsSync(path.join(dir, 'ai-api-key.bin')), false);
    assert.equal(loadPersistedAiKey(), null);
  });

  it('密文损坏按未配置降级，不抛错', () => {
    const dir = useTempDir();
    persistAiKey('victim-key');
    writeFileSync(path.join(dir, 'ai-api-key.bin'), Buffer.from('garbage-not-a-valid-frame'));
    assert.equal(loadPersistedAiKey(), null);
  });

  it('主密钥缺失读取为 null', () => {
    const dir = useTempDir();
    persistAiKey('orphan-key');
    rmSync(path.join(dir, 'ai-master.key'));
    assert.equal(loadPersistedAiKey(), null);
  });

  it('目录拿不到时退化为内存-only', () => {
    delete process.env['VD_AI_SECRETS_DIR'];
    delete process.env['APPDATA'];
    assert.equal(aiSecretsDir(), null);
    assert.equal(persistAiKey('no-dir-key'), false);
    assert.equal(loadPersistedAiKey(), null);
  });

  it('VD_AI_SECRETS_DIR 覆盖优先于 APPDATA', () => {
    const dir = useTempDir();
    process.env['APPDATA'] = path.join(dir, 'should-not-be-used');
    assert.equal(aiSecretsDir(), dir);
  });

  it('非敏感设置（profile）回装一致', () => {
    useTempDir();
    persistAiProfile({
      providerId: 'minimax-cn',
      baseUrl: null,
      model: 'MiniMax-M3.1-Flash',
      effort: null,
    });
    const profile = loadPersistedAiProfile();
    assert.equal(profile.providerId, 'minimax-cn');
    assert.equal(profile.model, 'MiniMax-M3.1-Flash');
    assert.equal(profile.baseUrl, null);
  });

  it('profile 损坏按未配置降级，不抛错', () => {
    const dir = useTempDir();
    writeFileSync(path.join(dir, 'ai-settings.json'), '{ broken json');
    assert.equal(loadPersistedAiProfile(), null);
  });
});
