import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  createWriteStream,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs';
import { open, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

import { StorageUnavailable } from '../../domain/errors';
import { logger } from '../logging/logger';

/**
 * 应用层静态加密（AES-256-GCM）。
 *
 * 对象文件格式（大文件可分帧流式读取）：
 *   magic(5) | version(1) | frameBytes(4) | noncePrefix(8) | plainSize(8) | frame...
 *   每帧：ciphertext(frameBytes) | tag(16)，nonce = noncePrefix + frameIndex(4)
 *   最后一帧可能小于 frameBytes，plainSize 决定实际长度。
 *
 * 分片文件（上传暂存）与头像等小文件使用整体 GCM 格式：
 *   magic(5) | nonce(12) | tag(16) | ciphertext
 *
 * 未配置密钥时保持明文读写（兼容历史数据）；配置后只写密文，读取时按 magic 自动识别。
 */
const OBJECT_MAGIC = Buffer.from('VDEN1');
const CHUNK_MAGIC = Buffer.from('VDCH1');
const VERSION = 1;
const DEFAULT_FRAME_BYTES = 1024 * 1024;
const HEADER_BYTES = OBJECT_MAGIC.length + 1 + 4 + 8 + 8;
const TAG_BYTES = 16;
const NONCE_BYTES = 12;

export interface ObjectHeader {
  version: number;
  frameBytes: number;
  noncePrefix: Buffer;
  plainSize: number;
  headerBytes: number;
}

let cachedKey: Buffer | null | undefined;

function decodeKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  const decoded = Buffer.from(trimmed, 'base64');
  return decoded.length === 32 ? decoded : null;
}

/** 读取加密密钥；未配置返回 null（保持明文，兼容旧数据）。 */
export function atRestKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;

  const direct = process.env['VD_ENCRYPTION_KEY'];
  if (direct) {
    const key = decodeKey(direct);
    if (!key) throw new Error('VD_ENCRYPTION_KEY 必须是 32 字节 base64 或 64 位 hex');
    cachedKey = key;
    return key;
  }

  const explicitKeyFile = process.env['VD_ENCRYPTION_KEY_FILE'];
  const keyFile =
    explicitKeyFile ??
    path.resolve(process.env['VD_SECRETS_DIR'] ?? '_private/secrets', 'encryption.key');
  try {
    const key = decodeKey(readFileSync(keyFile, 'utf8'));
    if (!key) throw new Error(`加密密钥文件内容无效：${keyFile}`);
    cachedKey = key;
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (explicitKeyFile) {
        throw new Error(`加密密钥文件不存在：${explicitKeyFile}`);
      }
    } else {
      throw error;
    }
  }

  cachedKey = null;
  logger.warn('crypto.at_rest_disabled', {
    message: '未配置 VD_ENCRYPTION_KEY / VD_ENCRYPTION_KEY_FILE，文件将以明文落盘',
  });
  return null;
}

/** 仅用于测试或密钥轮换后重新加载。 */
export function resetAtRestKeyCache(): void {
  cachedKey = undefined;
}

export function encryptionEnabled(): boolean {
  return atRestKey() !== null;
}

function frameAad(header: Buffer, index: number): Buffer {
  const indexBuffer = Buffer.alloc(4);
  indexBuffer.writeUInt32BE(index, 0);
  return Buffer.concat([header, indexBuffer]);
}

function frameNonce(prefix: Buffer, index: number): Buffer {
  const nonce = Buffer.alloc(NONCE_BYTES);
  prefix.copy(nonce, 0, 0, 8);
  nonce.writeUInt32BE(index, 8);
  return nonce;
}

function parseHeader(buffer: Buffer): ObjectHeader | null {
  if (
    buffer.length < HEADER_BYTES ||
    !buffer.subarray(0, OBJECT_MAGIC.length).equals(OBJECT_MAGIC)
  ) {
    return null;
  }
  const version = buffer[OBJECT_MAGIC.length] ?? 0;
  const frameBytes = buffer.readUInt32BE(OBJECT_MAGIC.length + 1);
  const plainSize = Number(buffer.readBigUInt64BE(OBJECT_MAGIC.length + 13));
  return {
    version,
    frameBytes,
    noncePrefix: buffer.subarray(OBJECT_MAGIC.length + 5, OBJECT_MAGIC.length + 13),
    plainSize,
    headerBytes: HEADER_BYTES,
  };
}

/** 读取对象头；文件不是 VDEN1 密文时返回 null。 */
export async function readObjectHeader(filePath: string): Promise<ObjectHeader | null> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(filePath, 'r');
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    if (bytesRead < HEADER_BYTES) return null;
    const header = parseHeader(buffer);
    if (!header) return null;
    if (header.version !== VERSION) {
      throw new StorageUnavailable(`不支持的对象加密版本 ${header.version}`);
    }
    if (header.frameBytes === 0 || header.frameBytes > 16 * 1024 * 1024) {
      throw new StorageUnavailable('对象加密头中的分帧大小无效');
    }
    return header;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** 同步判断文件是否以 VDEN1 开头，供迁移与运维脚本使用。 */
export function isEncryptedFileSync(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(OBJECT_MAGIC.length);
    const bytesRead = readSync(fd, buffer, 0, OBJECT_MAGIC.length, 0);
    return bytesRead === OBJECT_MAGIC.length && buffer.equals(OBJECT_MAGIC);
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

async function readExact(handle: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(buffer, read, length - read, offset + read);
    if (result.bytesRead === 0) throw new StorageUnavailable('对象文件被截断');
    read += result.bytesRead;
  }
  return buffer;
}

/** 按帧写入 VDEN1 对象；成功结束调用 end()，中途失败调用 abort()。 */
export class AtRestWriter {
  private frame = Buffer.alloc(0);
  private frameIndex = 0;
  private position = HEADER_BYTES;
  private closed = false;

  private constructor(
    private readonly handle: FileHandle,
    private readonly key: Buffer,
    private readonly header: Buffer,
    private readonly frameBytes: number,
  ) {}

  /** 创建目标文件并写入对象头；plainSize 决定读取端的最后一帧长度。 */
  static async create(filePath: string, plainSize: number, key: Buffer): Promise<AtRestWriter> {
    const handle = await open(filePath, 'w');
    const header = Buffer.alloc(HEADER_BYTES);
    OBJECT_MAGIC.copy(header, 0);
    header[OBJECT_MAGIC.length] = VERSION;
    header.writeUInt32BE(DEFAULT_FRAME_BYTES, OBJECT_MAGIC.length + 1);
    randomBytes(8).copy(header, OBJECT_MAGIC.length + 5);
    header.writeBigUInt64BE(BigInt(plainSize), OBJECT_MAGIC.length + 13);
    const writer = new AtRestWriter(handle, key, header, DEFAULT_FRAME_BYTES);
    await handle.write(header, 0, header.length, 0);
    return writer;
  }

  /** 追加明文；内部按 1 MiB 切帧，满帧立即加密落盘。 */
  async write(chunk: Buffer): Promise<void> {
    if (this.closed) throw new StorageUnavailable('写入已关闭');
    let offset = 0;
    while (offset < chunk.length) {
      const remaining = this.frameBytes - this.frame.length;
      const take = Math.min(remaining, chunk.length - offset);
      this.frame = Buffer.concat([this.frame, chunk.subarray(offset, offset + take)]);
      offset += take;
      if (this.frame.length === this.frameBytes) await this.flushFrame();
    }
  }

  /** 刷出最后一帧并关闭文件；重复调用安全。 */
  async end(): Promise<void> {
    if (this.closed) return;
    if (this.frame.length > 0) await this.flushFrame();
    this.closed = true;
    await this.handle.sync().catch(() => undefined);
    await this.handle.close();
  }

  /** 放弃写入并关闭句柄；临时文件由调用方清理。 */
  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close().catch(() => undefined);
  }

  private async flushFrame(): Promise<void> {
    const plain = this.frame;
    this.frame = Buffer.alloc(0);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.key,
      frameNonce(this.noncePrefix, this.frameIndex),
    );
    cipher.setAAD(frameAad(this.header, this.frameIndex));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const payload = Buffer.concat([encrypted, cipher.getAuthTag()]);
    await this.handle.write(payload, 0, payload.length, this.position);
    this.position += payload.length;
    this.frameIndex += 1;
  }

  private get noncePrefix(): Buffer {
    return this.header.subarray(OBJECT_MAGIC.length + 5, OBJECT_MAGIC.length + 13);
  }
}

/** 读取明文区间 [start, end]（含端点），返回可流式消费的 Readable。 */
export function createAtRestReadStream(
  filePath: string,
  header: ObjectHeader,
  start: number,
  end: number,
): Readable {
  if (header.plainSize === 0 || end < start) return Readable.from([]);

  const firstFrame = Math.floor(start / header.frameBytes);
  const lastFrame = Math.floor(end / header.frameBytes);
  const key = atRestKey();
  if (!key) throw new StorageUnavailable('对象已加密，但当前未配置加密密钥');
  const encryptionKey: Buffer = key;
  const headerBuffer = Buffer.concat([
    OBJECT_MAGIC,
    Buffer.from([header.version]),
    (() => {
      const size = Buffer.alloc(4);
      size.writeUInt32BE(header.frameBytes, 0);
      return size;
    })(),
    header.noncePrefix,
    (() => {
      const size = Buffer.alloc(8);
      size.writeBigUInt64BE(BigInt(header.plainSize), 0);
      return size;
    })(),
  ]);

  async function* generate(): AsyncGenerator<Buffer> {
    const handle = await open(filePath, 'r');
    try {
      for (let index = firstFrame; index <= lastFrame; index += 1) {
        const plainStart = index * header.frameBytes;
        const plainLength = Math.min(header.frameBytes, header.plainSize - plainStart);
        if (plainLength <= 0) break;
        const storedOffset = header.headerBytes + index * (header.frameBytes + TAG_BYTES);
        const payload = await readExact(handle, storedOffset, plainLength + TAG_BYTES);
        const decipher = createDecipheriv(
          'aes-256-gcm',
          encryptionKey,
          frameNonce(header.noncePrefix, index),
        );
        decipher.setAAD(frameAad(headerBuffer, index));
        decipher.setAuthTag(payload.subarray(plainLength));
        let plain: Buffer;
        try {
          plain = Buffer.concat([
            decipher.update(payload.subarray(0, plainLength)),
            decipher.final(),
          ]);
        } catch {
          throw new StorageUnavailable('对象解密失败：密钥不匹配或文件已损坏');
        }
        const from = Math.max(0, start - plainStart);
        const to = Math.min(plainLength, end - plainStart + 1);
        if (to > from) yield plain.subarray(from, to);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  return Readable.from(generate());
}

/** 用 AES-256-GCM 封装小数据（分片、头像、MFA 密钥等）。 */
export function sealBuffer(plain: Buffer, key: Buffer = requireKey()): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(CHUNK_MAGIC);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([CHUNK_MAGIC, nonce, cipher.getAuthTag(), encrypted]);
}

/** 解封 VDCH1 小数据；不带 magic 的旧明文原样返回。 */
export function openBuffer(payload: Buffer): Buffer {
  if (payload.length < CHUNK_MAGIC.length + NONCE_BYTES + TAG_BYTES) return payload;
  if (!payload.subarray(0, CHUNK_MAGIC.length).equals(CHUNK_MAGIC)) return payload;
  const key = atRestKey();
  if (!key) throw new StorageUnavailable('文件已加密，但当前未配置加密密钥');
  const nonce = payload.subarray(CHUNK_MAGIC.length, CHUNK_MAGIC.length + NONCE_BYTES);
  const tagStart = CHUNK_MAGIC.length + NONCE_BYTES;
  const tag = payload.subarray(tagStart, tagStart + TAG_BYTES);
  const ciphertext = payload.subarray(tagStart + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(CHUNK_MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new StorageUnavailable('文件解密失败：密钥不匹配或文件已损坏');
  }
}

/** 把短文本加密成带 v1: 前缀的字符串，便于直接存数据库。 */
export function sealText(text: string): string {
  return `v1:${sealBuffer(Buffer.from(text, 'utf8')).toString('base64')}`;
}

/** 解密 v1: 前缀文本；没有前缀的历史明文原样返回。 */
export function openText(stored: string): string {
  if (!stored.startsWith('v1:')) return stored;
  return openBuffer(Buffer.from(stored.slice(3), 'base64')).toString('utf8');
}

/** 返回对象明文大小；未加密文件回退到文件 stat。 */
export async function plaintextSizeOf(filePath: string): Promise<number> {
  const header = await readObjectHeader(filePath);
  if (header) return header.plainSize;
  const info = await stat(filePath);
  return info.size;
}

/** 将明文对象原地加密；已是密文返回 false。 */
export async function encryptFileInPlace(filePath: string): Promise<boolean> {
  const key = requireKey();
  const existing = await readObjectHeader(filePath);
  if (existing) return false;

  const info = await stat(filePath);
  const tempPath = `${filePath}.enc-${randomBytes(6).toString('hex')}`;
  const writer = await AtRestWriter.create(tempPath, info.size, key);
  try {
    const source = createReadStream(filePath);
    for await (const chunk of source) {
      await writer.write(chunk as Buffer);
    }
    await writer.end();
    await rename(tempPath, filePath);
    return true;
  } catch (error) {
    await writer.abort().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 把（可能加密的）对象解密到目标路径。 */
export async function decryptFileToPath(filePath: string, destination: string): Promise<void> {
  const header = await readObjectHeader(filePath);
  if (!header) {
    await pipeline(createReadStream(filePath), createWriteStream(destination));
    return;
  }
  const source = createAtRestReadStream(filePath, header, 0, header.plainSize - 1);
  await pipeline(source, createWriteStream(destination));
}

/** 对明文内容计算 SHA-256，兼容加密对象与历史明文。 */
export async function hashPlaintextFile(filePath: string): Promise<string> {
  const header = await readObjectHeader(filePath);
  const hash = createHash('sha256');
  if (!header) {
    for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }
  for await (const chunk of createAtRestReadStream(filePath, header, 0, header.plainSize - 1)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

function requireKey(): Buffer {
  const key = atRestKey();
  if (!key) throw new StorageUnavailable('未配置加密密钥，无法执行加密操作');
  return key;
}

export const AT_REST_FORMAT = {
  objectMagic: OBJECT_MAGIC.toString('ascii'),
  chunkMagic: CHUNK_MAGIC.toString('ascii'),
  version: VERSION,
  frameBytes: DEFAULT_FRAME_BYTES,
  headerBytes: HEADER_BYTES,
} as const;
