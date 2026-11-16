import { createHash } from 'node:crypto';

import type {
  ByteRange,
  PutObjectInput,
  StoragePort,
  StoredObject,
} from '../../application/ports/storage.port';
import { ChecksumMismatch, StorageUnavailable } from '../../domain/errors';

interface MemoryObject {
  bytes: Uint8Array;
  sha256: string;
  sizeBytes: number;
}

export class InMemoryStorageFake implements StoragePort {
  private readonly objects = new Map<string, MemoryObject>();
  private available = true;

  setAvailable(value: boolean): void {
    this.available = value;
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    this.assertAvailable();

    const chunks: Uint8Array[] = [];
    const hash = createHash('sha256');
    for await (const chunk of input.content) {
      chunks.push(chunk);
      hash.update(chunk);
    }

    const actual = hash.digest('hex');
    if (actual !== input.sha256) {
      throw new ChecksumMismatch(`期望 ${input.sha256}，实际 ${actual}`);
    }

    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const objectId = `mem-${actual.slice(0, 16)}`;
    this.objects.set(objectId, { bytes, sha256: actual, sizeBytes: bytes.byteLength });
    return { objectId, sha256: actual, sizeBytes: bytes.byteLength };
  }

  async statObject(objectId: string): Promise<StoredObject | null> {
    const found = this.objects.get(objectId);
    if (!found) return null;
    return { objectId, sha256: found.sha256, sizeBytes: found.sizeBytes };
  }

  async openRead(objectId: string, range?: ByteRange): Promise<AsyncIterable<Uint8Array>> {
    this.assertAvailable();
    const found = this.objects.get(objectId);
    if (!found) throw new StorageUnavailable(`对象不存在：${objectId}`);

    const start = range?.start ?? 0;
    const end = range?.end ?? found.sizeBytes - 1;
    const slice = found.bytes.subarray(start, end + 1);

    return (async function* stream() {
      yield slice;
    })();
  }

  async deleteObject(objectId: string): Promise<void> {
    this.objects.delete(objectId);
  }

  async freeBytes(): Promise<number> {
    return 10 * 1024 * 1024 * 1024;
  }

  private assertAvailable(): void {
    if (!this.available) throw new StorageUnavailable();
  }
}
