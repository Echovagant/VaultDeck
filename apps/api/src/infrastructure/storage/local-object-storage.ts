import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { ChecksumMismatch, StorageUnavailable } from '../../domain/errors';
import {
  AtRestWriter,
  atRestKey,
  createAtRestReadStream,
  decryptFileToPath,
  hashPlaintextFile,
  isEncryptedFileSync,
  openBuffer,
  plaintextSizeOf,
  readObjectHeader,
  sealBuffer,
} from '../crypto/at-rest';

export class LocalObjectStorage {
  constructor(private readonly root: string) {}

  private chunkDir(sessionId: string): string {
    return path.join(this.root, 'chunks', sessionId);
  }

  private objectKey(sha256: string): string {
    return `objects/${sha256.slice(0, 2)}/${sha256}.bin`;
  }

  private objectPath(sha256: string): string {
    return this.resolve(this.objectKey(sha256));
  }

  /** 数据库只存相对 dataRoot 的键；兼容迁移前的历史绝对路径 */
  resolve(relPath: string): string {
    return path.isAbsolute(relPath) ? relPath : path.resolve(this.root, relPath);
  }

  /** 保存单个上传分片；配置密钥时按 VDCH1 加密落盘。 */
  async saveChunk(sessionId: string, index: number, data: Buffer): Promise<void> {
    const dir = this.chunkDir(sessionId);
    await mkdir(dir, { recursive: true });
    const key = atRestKey();
    await writeFile(path.join(dir, `${index}.part`), key ? sealBuffer(data, key) : data);
  }

  /** 合并分片并校验明文 SHA-256 / 大小；密文模式下边解密边重加密。 */
  async mergeChunks(
    sessionId: string,
    chunkCount: number,
    expectedSha256: string,
    expectedSizeBytes: number,
  ): Promise<{ objectPath: string; sizeBytes: number }> {
    const dir = this.chunkDir(sessionId);
    const target = this.objectPath(expectedSha256);
    await mkdir(path.dirname(target), { recursive: true });

    const hash = createHash('sha256');
    let sizeBytes = 0;
    const key = atRestKey();

    if (!key) {
      const output = createWriteStream(target);
      try {
        for (let index = 0; index < chunkCount; index += 1) {
          const partPath = path.join(dir, `${index}.part`);
          const part = await readFile(partPath).catch(() => {
            throw new StorageUnavailable(`缺少分片 ${index}`);
          });
          hash.update(part);
          sizeBytes += part.byteLength;
          if (!output.write(part)) {
            await new Promise<void>((resolve) => output.once('drain', () => resolve()));
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          output.end((error?: Error | null) => (error ? reject(error) : resolve()));
        });
      }

      const actual = hash.digest('hex');
      if (actual !== expectedSha256) {
        await rm(target, { force: true });
        throw new ChecksumMismatch(`期望 ${expectedSha256}，实际 ${actual}`);
      }
      return { objectPath: this.objectKey(expectedSha256), sizeBytes };
    }

    const writer = await AtRestWriter.create(target, expectedSizeBytes, key);
    try {
      for (let index = 0; index < chunkCount; index += 1) {
        const partPath = path.join(dir, `${index}.part`);
        const stored = await readFile(partPath).catch(() => {
          throw new StorageUnavailable(`缺少分片 ${index}`);
        });
        const part = openBuffer(stored);
        hash.update(part);
        sizeBytes += part.byteLength;
        await writer.write(part);
      }
      await writer.end();
    } catch (error) {
      await writer.abort().catch(() => undefined);
      await rm(target, { force: true });
      throw error;
    }

    const actual = hash.digest('hex');
    if (actual !== expectedSha256 || sizeBytes !== expectedSizeBytes) {
      await rm(target, { force: true });
      throw new ChecksumMismatch(
        `期望 ${expectedSha256}/${expectedSizeBytes}B，实际 ${actual}/${sizeBytes}B`,
      );
    }
    return { objectPath: this.objectKey(expectedSha256), sizeBytes };
  }

  /** 判断内容对象是否已存在，用于秒传。 */
  async objectExists(sha256: string): Promise<boolean> {
    try {
      const info = await stat(this.objectPath(sha256));
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }

  /** 删除存储对象文件；对象按 sha 前两位分桶，删空后顺带移除空目录 */
  async deleteObject(objectPath: string): Promise<void> {
    const target = this.resolve(objectPath);
    await rm(target, { force: true });
    await rmdir(path.dirname(target)).catch(() => {
      // 目录非空或不存在均忽略
    });
  }

  /** 读取明文区间；对象为密文时自动解密。 */
  async openRange(objectPath: string, start: number, end: number): Promise<Readable> {
    if (end < start) return Readable.from([]);
    const target = this.resolve(objectPath);
    if (!isEncryptedFileSync(target)) {
      return createReadStream(target, { start, end });
    }
    const header = await readObjectHeader(target);
    if (!header) return createReadStream(target, { start, end });
    return createAtRestReadStream(target, header, start, end);
  }

  /** 返回对象明文大小；密文按对象头计算。 */
  async plaintextSize(objectPath: string): Promise<number> {
    return plaintextSizeOf(this.resolve(objectPath));
  }

  /** 对对象明文计算 SHA-256，供巡检使用。 */
  async hashPlaintext(objectPath: string): Promise<string> {
    return hashPlaintextFile(this.resolve(objectPath));
  }

  /**
   * 为 LibreOffice 等需要真实文件路径的消费者准备明文副本。
   * 明文对象直接返回原路径；密文对象解密到 tmp 目录，调用方用完负责删除。
   */
  async materializePlaintext(
    objectPath: string,
    originalName: string,
  ): Promise<{ path: string; temporary: boolean }> {
    const target = this.resolve(objectPath);
    if (!isEncryptedFileSync(target)) return { path: target, temporary: false };

    const dir = path.join(this.root, 'tmp');
    await mkdir(dir, { recursive: true });
    const destination = path.join(dir, `${randomUUID()}${path.extname(originalName)}`);
    await decryptFileToPath(target, destination);
    return { path: destination, temporary: true };
  }

  async cleanupMaterialized(materialized: { path: string; temporary: boolean }): Promise<void> {
    if (materialized.temporary) await rm(materialized.path, { force: true });
  }

  /** 删除上传会话的分片目录，合并完成或取消后调用。 */
  async cleanupSession(sessionId: string): Promise<void> {
    await rm(this.chunkDir(sessionId), { recursive: true, force: true });
  }
}
