import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { ZipFile } from 'yazl';

import type { StoreFile } from '../../application/ports/store.port';
import { encryptFileInPlace } from '../crypto/at-rest';
import { LocalObjectStorage } from './local-object-storage';

export interface BundleRecord {
  bundleId: string;
  ownerId: string;
  zipPath: string;
  totalBytes: number;
  createdAt: string;
}

export const bundles = new Map<string, BundleRecord>();

export async function buildBundle(input: {
  ownerId: string;
  files: StoreFile[];
  root: string;
}): Promise<BundleRecord> {
  const bundleId = randomUUID();
  const dir = path.join(input.root, 'bundles');
  await mkdir(dir, { recursive: true });
  const zipPath = path.join(dir, `${bundleId}.zip`);

  const zip = new ZipFile();
  const storage = new LocalObjectStorage(input.root);
  for (const file of input.files) {
    const stream = await storage.openRange(file.objectPath, 0, file.sizeBytes - 1);
    zip.addReadStream(stream, file.fileName, { size: file.sizeBytes });
  }
  zip.end();

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    output.on('close', () => resolve());
    output.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(output);
  });

  const info = await stat(zipPath);
  await encryptFileInPlace(zipPath).catch(() => undefined);
  const record: BundleRecord = {
    bundleId,
    ownerId: input.ownerId,
    zipPath,
    totalBytes: info.size,
    createdAt: new Date().toISOString(),
  };
  bundles.set(bundleId, record);
  return record;
}

export async function purgeOldBundles(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const now = Date.now();
  let purged = 0;
  for (const [bundleId, record] of bundles) {
    if (now - new Date(record.createdAt).getTime() <= maxAgeMs) continue;
    bundles.delete(bundleId);
    await rm(record.zipPath, { force: true });
    purged += 1;
  }
  return purged;
}
