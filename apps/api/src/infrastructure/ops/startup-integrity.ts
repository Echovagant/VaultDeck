import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { logger, errorMessage } from '../logging/logger';
import { dataRoot } from '../memory/upload-sessions';

/**
 * 启动完整性校验（B6）：上传会话只存在内存中，进程重启后 staging 分片不可能再被续传，
 * 启动时整体清理，避免断电/崩溃后残留的分片无限堆积。
 */
export async function reconcileUploadStaging(): Promise<number> {
  const dir = path.join(dataRoot, 'chunks');
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await rm(path.join(dir, entry.name), { recursive: true, force: true }).catch(
      (error: unknown) => {
        logger.warn('startup.staging_remove_failed', {
          sessionId: entry.name,
          error: errorMessage(error),
        });
      },
    );
    removed += 1;
  }
  if (removed > 0) logger.info('startup.staging_reconciled', { removed });
  return removed;
}
