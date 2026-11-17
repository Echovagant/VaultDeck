import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { Pool } from 'pg';

import { atRestKey, encryptFileInPlace } from './at-rest';

/**
 * 把已有明文对象、预览缓存与头像原地迁移为应用层加密格式。
 * 用法：
 *   VD_DATABASE_URL=... VD_ENCRYPTION_KEY_FILE=... VD_DATA_ROOT=... \
 *   node dist/infrastructure/crypto/encrypt-objects-cli.js
 * 幂等：已是密文的文件会跳过。建议在服务停止时执行，避免迁移中途被读取。
 */
async function main(): Promise<void> {
  if (!atRestKey()) {
    throw new Error('未配置加密密钥（VD_ENCRYPTION_KEY / VD_ENCRYPTION_KEY_FILE）');
  }

  const dataRoot = path.resolve(process.env['VD_DATA_ROOT'] ?? '_private/storage');
  const previewRoot = path.resolve(process.env['VD_PREVIEW_CACHE'] ?? '_private/storage/previews');
  const connectionString = process.env['VD_DATABASE_URL'];
  if (!connectionString) throw new Error('需要 VD_DATABASE_URL');

  const pool = new Pool({ connectionString, max: 2 });
  let objects = 0;
  let previews = 0;
  let avatars = 0;
  let skipped = 0;

  try {
    const rows = await pool.query<{ rel_path: string }>('SELECT rel_path FROM stored_object');
    for (const row of rows.rows) {
      const absolute = path.isAbsolute(row.rel_path)
        ? row.rel_path
        : path.resolve(dataRoot, row.rel_path);
      const info = await stat(absolute).catch(() => null);
      if (!info?.isFile()) {
        skipped += 1;
        continue;
      }
      if (await encryptFileInPlace(absolute)) objects += 1;
      else skipped += 1;
      process.stdout.write(`object ${row.rel_path} -> ${objects + skipped}/${rows.rowCount}\n`);
    }

    previews = await encryptDirectory(previewRoot, '.pdf');
    avatars = await encryptDirectory(path.join(dataRoot, 'avatars'));

    console.log(
      JSON.stringify({
        objectsEncrypted: objects,
        previewsEncrypted: previews,
        avatarsEncrypted: avatars,
        skipped,
      }),
    );
  } finally {
    await pool.end();
  }
}

async function encryptDirectory(dir: string, extension?: string): Promise<number> {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await encryptDirectory(full, extension);
      continue;
    }
    if (extension && !entry.name.toLowerCase().endsWith(extension)) continue;
    if (entry.name.endsWith('.mime') || entry.name.endsWith('.log')) continue;
    if (await encryptFileInPlace(full)) count += 1;
  }
  return count;
}

main().catch((error) => {
  process.stderr.write(
    `[encrypt-objects] FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
