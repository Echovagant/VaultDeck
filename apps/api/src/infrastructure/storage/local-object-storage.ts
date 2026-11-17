import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ChecksumMismatch, StorageUnavailable } from '../../domain/errors';

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

  async saveChunk(sessionId: string, index: number, data: Buffer): Promise<void> {
    const dir = this.chunkDir(sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${index}.part`), data);
  }

  async mergeChunks(
    sessionId: string,
    chunkCount: number,
    expectedSha256: string,
  ): Promise<{ objectPath: string; sizeBytes: number }> {
    const dir = this.chunkDir(sessionId);
    const target = this.objectPath(expectedSha256);
    await mkdir(path.dirname(target), { recursive: true });

    const hash = createHash('sha256');
    const output = createWriteStream(target);
    let sizeBytes = 0;

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

  openRange(objectPath: string, start: number, end: number): NodeJS.ReadableStream {
    return createReadStream(this.resolve(objectPath), { start, end });
  }

  async cleanupSession(sessionId: string): Promise<void> {
    await rm(this.chunkDir(sessionId), { recursive: true, force: true });
  }
}
