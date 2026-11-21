/**
 * AI API Key 的仓库外持久化（仅内存存储模式使用）。
 *
 * ## 设计（用户已批的方案 A）
 *
 * - 落点：`%APPDATA%\VaultDeck\`（Windows 用户数据目录，天然在一切仓库之外，
 *   不会被上传到远程仓库）；可用环境变量 `VD_AI_SECRETS_DIR` 覆盖。
 * - 两个文件：`ai-master.key`（首次保存时随机生成 32 字节主密钥）与
 *   `ai-api-key.bin`（AES-256-GCM 密文，VDAK1 帧）。
 * - 重启不丢：进程启动时 loadPersistedAiKey() 解密回内存。
 * - 静止非明文：磁盘上只有密文；运行时内存里的明文是调用模型的物理必要，无法消除。
 *
 * ## 纯模块约束（同 parse-natural-search）
 *
 * node --test 靠 Node 24 类型剥离直跑本文件：运行时只依赖 node 内建模块，
 * 全部自包含（不 import 仓库其他模块，避免扩展名链断裂）。
 *
 * ## 密钥红线
 *
 * 主密钥与密文都只落在这个目录；任何日志、审计、接口响应都不得出现明文。
 * 解密失败一律按「未配置」降级返回 null，绝不抛错阻断启动。
 * 持久化失败（目录不可写等）退化为内存-only，不影响保存本身。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAGIC = Buffer.from('VDAK1', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MASTER_BYTES = 32;

const MASTER_FILE = 'ai-master.key';
const KEY_FILE = 'ai-api-key.bin';
const PROFILE_FILE = 'ai-settings.json';

/** 密封目录：VD_AI_SECRETS_DIR 优先，其次 %APPDATA%\VaultDeck；都拿不到返回 null（退化为内存-only） */
export function aiSecretsDir(): string | null {
  const override = process.env['VD_AI_SECRETS_DIR'];
  if (override && override.trim()) return override.trim();
  const appData = process.env['APPDATA'];
  if (!appData) return null;
  return path.join(appData, 'VaultDeck');
}

function seal(plain: string, master: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', master, nonce);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted]);
}

function unseal(payload: Buffer, master: Buffer): string | null {
  if (payload.length < MAGIC.length + NONCE_BYTES + TAG_BYTES) return null;
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  const nonce = payload.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
  const tagStart = MAGIC.length + NONCE_BYTES;
  const decipher = createDecipheriv('aes-256-gcm', master, nonce);
  decipher.setAuthTag(payload.subarray(tagStart, tagStart + TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(payload.subarray(tagStart + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null; // 密文损坏或密钥不匹配：按未配置降级
  }
}

/** 持久化 AI key：null=清除（删密文文件）；字符串=密封写盘。返回是否落盘成功。 */
export function persistAiKey(plain: string | null): boolean {
  const dir = aiSecretsDir();
  if (!dir) return false;
  try {
    const keyFile = path.join(dir, KEY_FILE);
    if (plain === null) {
      rmSync(keyFile, { force: true });
      return true;
    }
    mkdirSync(dir, { recursive: true });
    const masterFile = path.join(dir, MASTER_FILE);
    let master: Buffer;
    if (existsSync(masterFile)) {
      master = readFileSync(masterFile);
      if (master.length !== MASTER_BYTES) master = randomBytes(MASTER_BYTES);
    } else {
      master = randomBytes(MASTER_BYTES);
    }
    writeFileSync(masterFile, master);
    writeFileSync(keyFile, seal(plain, master));
    return true;
  } catch {
    return false;
  }
}

/** 启动时解密回装：任何失败（缺文件/损坏/密钥不匹配）都返回 null，绝不抛错。 */
export function loadPersistedAiKey(): string | null {
  const dir = aiSecretsDir();
  if (!dir) return null;
  try {
    const masterFile = path.join(dir, MASTER_FILE);
    const keyFile = path.join(dir, KEY_FILE);
    if (!existsSync(masterFile) || !existsSync(keyFile)) return null;
    const master = readFileSync(masterFile);
    if (master.length !== MASTER_BYTES) return null;
    return unseal(readFileSync(keyFile), master);
  } catch {
    return null;
  }
}

/**
 * AI 设置的非敏感部分（供应商 / 接入点 / 模型 / 档位）持久化：
 * 明文 JSON 与密文 key 同目录——这些字段不含机密，明文存放便于用户自查。
 */
export interface AiProfile {
  providerId: string | null;
  baseUrl: string | null;
  model: string | null;
  effort: string | null;
}

export function persistAiProfile(profile: AiProfile | null): boolean {
  const dir = aiSecretsDir();
  if (!dir) return false;
  try {
    const file = path.join(dir, PROFILE_FILE);
    if (profile === null) {
      rmSync(file, { force: true });
      return true;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 启动时回装非敏感设置；缺文件 / 损坏返回 null。 */
export function loadPersistedAiProfile(): AiProfile | null {
  const dir = aiSecretsDir();
  if (!dir) return null;
  try {
    const file = path.join(dir, PROFILE_FILE);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AiProfile>;
    if (typeof raw !== 'object' || raw === null) return null;
    return {
      providerId: typeof raw.providerId === 'string' ? raw.providerId : null,
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : null,
      model: typeof raw.model === 'string' ? raw.model : null,
      effort: typeof raw.effort === 'string' ? raw.effort : null,
    };
  } catch {
    return null;
  }
}
