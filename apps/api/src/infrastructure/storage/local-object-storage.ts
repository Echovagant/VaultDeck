import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ChecksumMismatch, StorageUnavailable } from '../../domain/errors';

export class LocalObjectStorage {
  constructor(private readonly root: string) {}

  private chunkDir(sessionId: string): string {
    return path.join(this.root, 'chunks', sessionId);
  }

  private objectPath(sha256: string): string {
    return path.join(this.root, 'objects', sha256.slice(0, 2), `${sha256}.bin`);
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

    return { objectPath: target, sizeBytes };
  }

  async objectExists(sha256: string): Promise<boolean> {
    try {
      const info = await stat(this.objectPath(sha256));
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }

  openRange(objectPath: string, start: number, end: number): NodeJS.ReadableStream {
    return createReadStream(objectPath, { start, end });
  }

  async cleanupSession(sessionId: string): Promise<void> {
    await rm(this.chunkDir(sessionId), { recursive: true, force: true });
  }
}
