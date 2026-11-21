import { readdirSync } from 'node:fs';

import { Pool } from 'pg';

import type { StorePort } from '../application/ports/store.port';
import { migrationsDir } from './db/migrations-path';
import { TRASH_RETENTION_DAYS, memoryStore } from './memory/memory-store';
import { PgStore, bootstrapDemoData } from './postgres/pg-store';

const usePostgres = process.env['VD_STORE'] === 'postgres';

let activeStore: StorePort;
let activePool: Pool | null = null;

if (usePostgres) {
  const connectionString = process.env['VD_DATABASE_URL'];
  if (!connectionString) {
    throw new Error('VD_STORE=postgres 时必须提供 VD_DATABASE_URL');
  }
  activePool = new Pool({ connectionString, max: 10 });
  activeStore = new PgStore(activePool);
} else {
  activeStore = memoryStore;
}

export const store: StorePort = activeStore;
export const pool: Pool | null = activePool;
export { TRASH_RETENTION_DAYS };
export const storeKind = usePostgres ? 'postgres' : 'memory';

export async function prepareStore(): Promise<void> {
  // 富化演示数据：VD_BOOTSTRAP_DEMO=rich 且内存模式时，在基础 demo 之上追加足量语料
  if (!activePool) {
    if (process.env['VD_BOOTSTRAP_DEMO'] === 'rich') {
      const { seedRichDemo } = await import('./memory/rich-demo');
      await seedRichDemo();
    }
    return;
  }

  // 连接失败必须显式暴露：吞掉会把「连不上」误报成「未初始化」，排障时误导方向
  const migrationTable = await activePool
    .query<{ count: string }>(
      `SELECT count(*) FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = 'schema_migration'`,
    )
    .catch((error: unknown) => {
      throw new Error(
        `数据库连接失败：${error instanceof Error ? error.message : String(error)}`,
      );
    });

  if (!migrationTable || Number(migrationTable.rows[0]?.count ?? 0) === 0) {
    throw new Error('数据库未初始化：请先运行 npm run db:migrate');
  }

  const applied = await activePool.query<{ count: string }>(
    'SELECT count(*) FROM schema_migration',
  );
  // 门禁与 migrate-cli 保持同一事实源：已应用版本数必须覆盖迁移目录里的全部 .up.sql
  const expectedMigrations = readdirSync(migrationsDir).filter((file) =>
    file.endsWith('.up.sql'),
  ).length;
  const appliedCount = Number(applied.rows[0]?.count ?? 0);
  if (appliedCount < expectedMigrations) {
    throw new Error(
      `数据库迁移不完整：已应用 ${appliedCount}/${expectedMigrations}，请先运行 npm run db:migrate`,
    );
  }

  await bootstrapDemoData(activePool);
}
