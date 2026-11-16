import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { migrationsDir } from './migrations-path';

interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

function loadMigrations(): Migration[] {
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.up.sql'));

  const migrations = files.map((file) => {
    const match = /^(\d+)_(.+)\.up\.sql$/.exec(file);
    if (!match) throw new Error(`迁移文件命名不合法：${file}`);
    const rawVersion = match[1];
    const name = match[2];
    if (!rawVersion || !name) throw new Error(`迁移文件命名不合法：${file}`);

    return {
      version: Number(rawVersion),
      name,
      up: readFileSync(path.join(migrationsDir, file), 'utf8'),
      down: readFileSync(path.join(migrationsDir, `${rawVersion}_${name}.down.sql`), 'utf8'),
    };
  });

  return migrations.sort((left, right) => left.version - right.version);
}

async function main(): Promise<void> {
  const connectionString = process.env['VD_DATABASE_URL'];
  if (!connectionString) {
    throw new Error('缺少环境变量 VD_DATABASE_URL');
  }

  const direction =
    process.argv.includes('--down') || process.env['VD_MIGRATE_DIRECTION'] === 'down'
      ? 'down'
      : 'up';
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await client.query<{ version: number }>(
      'SELECT version FROM schema_migration ORDER BY version',
    );
    const applied = new Set(appliedRows.rows.map((row) => row.version));
    const migrations = loadMigrations();

    if (direction === 'up') {
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.up);
          await client.query('INSERT INTO schema_migration (version, name) VALUES ($1, $2)', [
            migration.version,
            migration.name,
          ]);
          await client.query('COMMIT');
          applied.add(migration.version);
          console.log(`applied ${migration.version}_${migration.name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      const pending = migrations.filter((migration) => !applied.has(migration.version));
      const total = await client.query<{ count: string }>('SELECT count(*) FROM schema_migration');
      console.log(`applied_total=${total.rows[0]?.count ?? 0} pending=${pending.length}`);
      if (pending.length > 0) {
        console.log(`pending_versions=${pending.map((item) => item.version).join(',')}`);
      }
    } else {
      for (const migration of [...migrations].reverse()) {
        if (!applied.has(migration.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.down);
          await client.query('DELETE FROM schema_migration WHERE version = $1', [
            migration.version,
          ]);
          await client.query('COMMIT');
          console.log(`reverted ${migration.version}_${migration.name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
