import { Pool } from 'pg';

import { hashPassword } from '../postgres/password';

/**
 * 空库首次部署时创建初始领队账号。
 * 只在 app_user 为空时执行；已有账号的库不会被覆盖。
 * 用法：VD_DATABASE_URL=... VD_BOOTSTRAP_ADMIN_PASSWORD=... \
 *       node dist/infrastructure/db/bootstrap-admin-cli.js
 */
async function main(): Promise<void> {
  const connectionString = process.env['VD_DATABASE_URL'];
  if (!connectionString) throw new Error('需要 VD_DATABASE_URL');

  const username = (process.env['VD_BOOTSTRAP_ADMIN_USERNAME'] ?? 'leader').trim();
  const password = process.env['VD_BOOTSTRAP_ADMIN_PASSWORD'] ?? '';
  const displayName = (process.env['VD_BOOTSTRAP_ADMIN_DISPLAY_NAME'] ?? '领队').trim();

  if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
    throw new Error('VD_BOOTSTRAP_ADMIN_USERNAME 只允许字母、数字、点、下划线与连字符');
  }
  if (password.length < 8) {
    throw new Error('VD_BOOTSTRAP_ADMIN_PASSWORD 至少 8 个字符');
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const existing = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM app_user',
    );
    if ((existing.rows[0]?.count ?? 0) > 0) {
      process.stdout.write(`${JSON.stringify({ created: false, reason: 'users_exist' })}\n`);
      return;
    }

    const result = await pool.query<{ user_id: string }>(
      `INSERT INTO app_user (username, display_name, role_code, password_hash)
       VALUES ($1, $2, 'LEADER', $3)
       RETURNING user_id`,
      [username, displayName || username, hashPassword(password)],
    );
    process.stdout.write(
      `${JSON.stringify({
        created: true,
        userId: result.rows[0]?.user_id,
        username,
      })}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(
    `[bootstrap-admin] FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
