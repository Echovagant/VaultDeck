import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';

import path from 'node:path';

import type { StorePort } from '../../application/ports/store.port';
import { logger, errorMessage } from '../logging/logger';
import { dataRoot, objectStorage } from '../memory/upload-sessions';

/** 完整性巡检（B7）：对象行 ↔ 磁盘文件双向对账，另统计 staging 残留。 */

export interface IntegrityIssue {
  objectId: string;
  sha256: string;
  relPath: string;
  reason: 'missing' | 'size-mismatch' | 'hash-mismatch';
  actualSha256?: string;
}

export interface OrphanFile {
  relPath: string;
  sizeBytes: number;
}

export interface IntegrityReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scannedObjects: number;
  issues: IntegrityIssue[];
  orphanFiles: OrphanFile[];
  chunkSessions: number;
  ok: boolean;
}

let lastReport: IntegrityReport | null = null;
let running = false;

export function getLastIntegrityReport(): IntegrityReport | null {
  return lastReport;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function walkFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(full)));
    else files.push(full);
  }
  return files;
}

export async function runIntegrityScan(store: StorePort): Promise<IntegrityReport> {
  if (running) throw new Error('INTEGRITY_SCAN_RUNNING');
  running = true;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  logger.info('integrity.scan.start');

  try {
    const objects = await store.listStoredObjects();
    const knownPaths = new Set<string>();
    const issues: IntegrityIssue[] = [];

    for (const object of objects) {
      const absolute = objectStorage.resolve(object.relPath);
      const relative = path.relative(dataRoot, absolute).replaceAll('\\', '/');
      knownPaths.add(path.resolve(absolute));
      try {
        const info = await stat(absolute);
        if (info.size !== object.sizeBytes) {
          issues.push({
            objectId: object.objectId,
            sha256: object.sha256,
            relPath: relative,
            reason: 'size-mismatch',
          });
          continue;
        }
        const actual = await sha256File(absolute);
        if (actual !== object.sha256) {
          issues.push({
            objectId: object.objectId,
            sha256: object.sha256,
            relPath: relative,
            reason: 'hash-mismatch',
            actualSha256: actual,
          });
        }
      } catch {
        issues.push({
          objectId: object.objectId,
          sha256: object.sha256,
          relPath: relative,
          reason: 'missing',
        });
      }
    }

    const orphanFiles: OrphanFile[] = [];
    for (const file of await walkFiles(path.join(dataRoot, 'objects'))) {
      if (knownPaths.has(path.resolve(file))) continue;
      const info = await stat(file).catch(() => null);
      orphanFiles.push({
        relPath: path.relative(dataRoot, file).replaceAll('\\', '/'),
        sizeBytes: info?.size ?? 0,
      });
    }

    const chunkEntries = await readdir(path.join(dataRoot, 'chunks'), {
      withFileTypes: true,
    }).catch(() => []);

    const report: IntegrityReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      scannedObjects: objects.length,
      issues,
      orphanFiles,
      chunkSessions: chunkEntries.filter((entry) => entry.isDirectory()).length,
      ok: issues.length === 0,
    };
    lastReport = report;
    logger.info('integrity.scan.finish', {
      scannedObjects: report.scannedObjects,
      issues: issues.length,
      orphanFiles: orphanFiles.length,
      chunkSessions: report.chunkSessions,
      durationMs: report.durationMs,
    });
    return report;
  } catch (error) {
    logger.error('integrity.scan.failed', { error: errorMessage(error) });
    throw error;
  } finally {
    running = false;
  }
}
