import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { ZipFile } from 'yazl';

import type { StoreFile } from '../../application/ports/store.port';

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
  for (const file of input.files) {
    zip.addFile(file.objectPath, file.fileName);
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

export async function purgeOldBundles(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const now = Date.now();
  for (const [bundleId, record] of bundles) {
    if (now - new Date(record.createdAt).getTime() <= maxAgeMs) continue;
    bundles.delete(bundleId);
    await rm(record.zipPath, { force: true });
  }
}
