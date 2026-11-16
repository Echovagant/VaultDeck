import { Pool } from 'pg';

import type { StorePort } from '../application/ports/store.port';
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
  if (!activePool) return;

  const migrationTable = await activePool
    .query<{ count: string }>(
      `SELECT count(*) FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = 'schema_migration'`,
    )
    .catch(() => null);

  if (!migrationTable || Number(migrationTable.rows[0]?.count ?? 0) === 0) {
    throw new Error('数据库未初始化：请先运行 npm run db:migrate');
  }

  const applied = await activePool.query<{ count: string }>(
    'SELECT count(*) FROM schema_migration',
  );
  if (Number(applied.rows[0]?.count ?? 0) < 3) {
    throw new Error('数据库迁移不完整：请先运行 npm run db:migrate');
  }

  await bootstrapDemoData(activePool);
}
