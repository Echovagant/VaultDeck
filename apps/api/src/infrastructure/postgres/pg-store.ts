import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { Pool } from 'pg';

import type {
  AddFileInput,
  AddMemberInput,
  CreateCategoryInput,
  CreateFolderInput,
  CreateProjectInput,
  CreateUserInput,
  RecordAuditInput,
  StoreAuditEntry,
  StoreCategory,
  StoreFile,
  StoreFolder,
  StoreLoginResult,
  StoreMember,
  StorePort,
  StoreProject,
  StoreSettings,
  StoreUser,
  SettingsPatch,
  UpdateCategoryInput,
  UpdateFolderInput,
  UpdateUserInput,
} from '../../application/ports/store.port';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const TRASH_RETENTION_DAYS = Number(process.env['VD_TRASH_RETENTION_DAYS'] ?? 10);

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface UserRow {
  user_id: string;
  username: string;
  display_name: string;
  role_code: StoreUser['role'];
  status: StoreUser['status'];
  password_hash: string;
}

function mapUser(row: UserRow): StoreUser {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role_code,
    status: row.status,
  };
}

interface FileRow {
  file_id: string;
  project_id: string;
  folder_id: string;
  file_name: string;
  size_bytes: string;
  content_type: string | null;
  uploader_id: string;
  status: StoreFile['status'];
  trashed_at: Date | null;
  expire_at: Date | null;
  created_at: Date;
  sha256: string | null;
  object_path: string | null;
}

function mapFile(row: FileRow): StoreFile {
  return {
    fileId: row.file_id,
    projectId: row.project_id,
    folderId: row.folder_id,
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes),
    contentType: row.content_type ?? 'application/octet-stream',
    uploaderId: row.uploader_id,
    sha256: row.sha256 ?? '',
    objectPath: row.object_path ?? '',
    status: row.status,
    trashedAt: row.trashed_at ? iso(row.trashed_at) : null,
    expireAt: row.expire_at ? iso(row.expire_at) : null,
    createdAt: iso(row.created_at),
  };
}

const FILE_SELECT = `
  SELECT f.file_id, f.project_id, f.folder_id, f.file_name, f.size_bytes, f.content_type,
         f.uploader_id, f.status, f.trashed_at, f.expire_at, f.created_at,
         o.sha256, o.rel_path AS object_path
  FROM file f
  LEFT JOIN stored_object o ON o.object_id = f.object_id
`;

interface FolderRow {
  folder_id: string;
  project_id: string;
  folder_name: string;
  parent_id: string | null;
  created_at: Date;
}

function mapFolderRow(row: FolderRow): StoreFolder {
  return {
    folderId: row.folder_id,
    projectId: row.project_id,
    folderName: row.folder_name,
    parentId: row.parent_id,
    createdAt: iso(row.created_at),
  };
}

interface CategoryRow {
  category_id: string;
  category_code: string;
  category_name: string;
  extensions: string[] | null;
  is_system: boolean;
}

function mapCategory(row: CategoryRow): StoreCategory {
  return {
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    extensions: row.extensions ?? [],
    isSystem: row.is_system,
  };
}

export class PgStore implements StorePort {
  constructor(private readonly pool: Pool) {}

  async login(username: string, password: string): Promise<StoreLoginResult | null> {
    const result = await this.pool.query<UserRow>(
      'SELECT * FROM app_user WHERE lower(username) = lower($1) AND status = $2',
      [username, 'active'],
    );
    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) return null;

    const token = randomBytes(32).toString('base64url');
    await this.pool.query(
      'INSERT INTO user_session (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [sha256Hex(token), row.user_id, new Date(Date.now() + SESSION_TTL_MS)],
    );
    return { token, user: mapUser(row) };
  }

  async logout(token: string): Promise<void> {
    await this.pool.query(
      'UPDATE user_session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [sha256Hex(token)],
    );
  }

  async userByToken(token: string): Promise<StoreUser | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT u.* FROM user_session s
       JOIN app_user u ON u.user_id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.status = 'active'`,
      [sha256Hex(token)],
    );
    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }

  async listUsers(): Promise<StoreUser[]> {
    const result = await this.pool.query<UserRow>('SELECT * FROM app_user ORDER BY username');
    return result.rows.map(mapUser);
  }

  async getUser(userId: string): Promise<StoreUser | null> {
    const result = await this.pool.query<UserRow>('SELECT * FROM app_user WHERE user_id = $1', [
      userId,
    ]);
    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }

  async createUser(input: CreateUserInput): Promise<StoreUser> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO app_user (username, display_name, role_code, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.username, input.displayName, input.role, hashPassword(input.password)],
    );
    const row = result.rows[0];
    if (!row) throw new Error('USER_CREATE_FAILED');
    return mapUser(row);
  }

  async updateUser(input: UpdateUserInput): Promise<StoreUser> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.displayName !== undefined) {
      params.push(input.displayName);
      sets.push(`display_name = $${params.length}`);
    }
    if (input.role !== undefined) {
      params.push(input.role);
      sets.push(`role_code = $${params.length}`);
    }
    if (input.status !== undefined) {
      params.push(input.status);
      sets.push(`status = $${params.length}`);
    }
    if (input.password !== undefined) {
      params.push(hashPassword(input.password));
      sets.push(`password_hash = $${params.length}`);
    }

    if (sets.length === 0) {
      const current = await this.getUser(input.userId);
      if (!current) throw new Error('USER_NOT_FOUND');
      return current;
    }

    params.push(input.userId);
    const result = await this.pool.query<UserRow>(
      `UPDATE app_user SET ${sets.join(', ')} WHERE user_id = $${params.length} RETURNING *`,
      params,
    );
    const row = result.rows[0];
    if (!row) throw new Error('USER_NOT_FOUND');
    return mapUser(row);
  }

  async getSettings(): Promise<StoreSettings> {
    const result = await this.pool.query<{ setting_key: string; setting_value: unknown }>(
      'SELECT setting_key, setting_value FROM setting',
    );
    const values = new Map(result.rows.map((row) => [row.setting_key, row.setting_value]));

    return {
      maxUploadBytes: Number(values.get('upload.maxBytes') ?? 20 * 1024 * 1024 * 1024),
      chunkSizeBytes: Number(values.get('upload.chunkSizeBytes') ?? 8 * 1024 * 1024),
      trashRetentionDays: Number(values.get('trash.retentionDays') ?? 10),
      instantUploadEnabled: Boolean(values.get('upload.instantEnabled') ?? true),
    };
  }

  async updateSettings(patch: SettingsPatch): Promise<StoreSettings> {
    const entries: Array<[string, unknown]> = [];
    if (patch.maxUploadBytes !== undefined) {
      entries.push(['upload.maxBytes', patch.maxUploadBytes]);
    }
    if (patch.chunkSizeBytes !== undefined) {
      entries.push(['upload.chunkSizeBytes', patch.chunkSizeBytes]);
    }
    if (patch.trashRetentionDays !== undefined) {
      entries.push(['trash.retentionDays', patch.trashRetentionDays]);
    }
    if (patch.instantUploadEnabled !== undefined) {
      entries.push(['upload.instantEnabled', patch.instantUploadEnabled]);
    }

    for (const [key, value] of entries) {
      await this.pool.query(
        `INSERT INTO setting (setting_key, setting_value) VALUES ($1, $2::jsonb)
         ON CONFLICT (setting_key) DO UPDATE
         SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    }
    return this.getSettings();
  }

  async memberProjectIds(userId: string): Promise<string[]> {
    const result = await this.pool.query<{ project_id: string }>(
      'SELECT project_id FROM project_member WHERE user_id = $1',
      [userId],
    );
    return result.rows.map((row) => row.project_id);
  }

  async visibleProjectIds(user: StoreUser): Promise<string[] | null> {
    if (user.role === 'LEADER') return null;
    return this.memberProjectIds(user.userId);
  }

  async canAccessProject(user: StoreUser, projectId: string): Promise<boolean> {
    if (user.role === 'LEADER') return true;
    const result = await this.pool.query(
      'SELECT 1 FROM project_member WHERE user_id = $1 AND project_id = $2',
      [user.userId, projectId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async canReadFile(user: StoreUser, file: StoreFile): Promise<boolean> {
    if (file.status !== 'active') return false;
    if (user.role === 'LEADER') return true;
    if (!(await this.canAccessProject(user, file.projectId))) return false;
    if (user.role === 'DEPUTY_LEADER') return true;
    return file.uploaderId === user.userId;
  }

  async canDeleteFile(user: StoreUser, file: StoreFile): Promise<boolean> {
    return this.canReadFile(user, file);
  }

  async canManageTrashedFile(user: StoreUser, file: StoreFile): Promise<boolean> {
    if (user.role === 'LEADER') return true;
    if (!(await this.canAccessProject(user, file.projectId))) return false;
    if (user.role === 'DEPUTY_LEADER') return true;
    return file.uploaderId === user.userId;
  }

  canViewAudit(user: StoreUser): boolean {
    return user.role !== 'MEMBER';
  }

  async recordAudit(input: RecordAuditInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (actor_id, actor_name, action, object_type, object_id, result, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.actor.userId,
        input.actor.username,
        input.action,
        input.objectType,
        input.objectId,
        input.result,
        input.detail,
      ],
    );
  }

  async listAudit(user: StoreUser): Promise<StoreAuditEntry[]> {
    if (!this.canViewAudit(user)) return [];

    const params: unknown[] = [];
    let sql = `
      SELECT audit_id, actor_id, actor_name, action, object_type, object_id, result, detail, occurred_at
      FROM audit_log
    `;
    if (user.role !== 'LEADER') {
      const projectIds = await this.memberProjectIds(user.userId);
      params.push(user.userId, projectIds);
      sql += ' WHERE actor_id = $1 OR object_id = ANY($2::text[])';
    }
    sql += ' ORDER BY occurred_at DESC LIMIT 1000';

    const result = await this.pool.query(sql, params);
    return result.rows.map((row) => ({
      auditId: row.audit_id,
      actorId: row.actor_id ?? '',
      actorName: row.actor_name,
      action: row.action,
      objectType: row.object_type,
      objectId: row.object_id,
      result: row.result,
      detail: row.detail,
      occurredAt: iso(row.occurred_at),
    }));
  }

  async listProjects(): Promise<StoreProject[]> {
    const result = await this.pool.query('SELECT * FROM project ORDER BY created_at DESC');
    return result.rows.map((row) => ({
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      status: row.status,
      createdAt: iso(row.created_at),
    }));
  }

  async createProject(input: CreateProjectInput): Promise<StoreProject> {
    const result = await this.pool.query(
      `INSERT INTO project (project_code, project_name) VALUES ($1, $2) RETURNING *`,
      [input.projectCode, input.projectName],
    );
    const row = result.rows[0];
    return {
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      status: row.status,
      createdAt: iso(row.created_at),
    };
  }

  async listMembers(projectId: string): Promise<StoreMember[]> {
    const result = await this.pool.query(
      'SELECT * FROM project_member WHERE project_id = $1 ORDER BY joined_at',
      [projectId],
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      userId: row.user_id,
      memberRole: row.member_role,
      joinedAt: iso(row.joined_at),
    }));
  }

  async addMember(input: AddMemberInput): Promise<StoreMember> {
    const result = await this.pool.query(
      `INSERT INTO project_member (project_id, user_id, member_role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role
       RETURNING *`,
      [input.projectId, input.userId, input.memberRole],
    );
    const row = result.rows[0];
    return {
      projectId: row.project_id,
      userId: row.user_id,
      memberRole: row.member_role,
      joinedAt: iso(row.joined_at),
    };
  }

  async listFolders(projectId: string): Promise<StoreFolder[]> {
    const result = await this.pool.query(
      'SELECT * FROM folder WHERE project_id = $1 ORDER BY created_at',
      [projectId],
    );
    return result.rows.map((row) => ({
      folderId: row.folder_id,
      projectId: row.project_id,
      folderName: row.folder_name,
      parentId: row.parent_id,
      createdAt: iso(row.created_at),
    }));
  }

  async createFolder(input: CreateFolderInput): Promise<StoreFolder> {
    const result = await this.pool.query(
      `INSERT INTO folder (project_id, parent_id, folder_name, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.projectId, input.parentId, input.folderName, input.createdBy],
    );
    const row = result.rows[0];
    return {
      folderId: row.folder_id,
      projectId: row.project_id,
      folderName: row.folder_name,
      parentId: row.parent_id,
      createdAt: iso(row.created_at),
    };
  }

  async getFolder(folderId: string): Promise<StoreFolder | null> {
    const result = await this.pool.query<FolderRow>('SELECT * FROM folder WHERE folder_id = $1', [
      folderId,
    ]);
    const row = result.rows[0];
    return row ? mapFolderRow(row) : null;
  }

  async updateFolder(input: UpdateFolderInput): Promise<StoreFolder> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.folderName !== undefined) {
      params.push(input.folderName);
      sets.push(`folder_name = $${params.length}`);
    }
    if (input.parentId !== undefined) {
      params.push(input.parentId);
      sets.push(`parent_id = $${params.length}`);
    }

    if (sets.length === 0) {
      const found = await this.pool.query<FolderRow>('SELECT * FROM folder WHERE folder_id = $1', [
        input.folderId,
      ]);
      const row = found.rows[0];
      if (!row) throw new Error('FOLDER_NOT_FOUND');
      return mapFolderRow(row);
    }

    params.push(input.folderId);
    const result = await this.pool.query<FolderRow>(
      `UPDATE folder SET ${sets.join(', ')} WHERE folder_id = $${params.length} RETURNING *`,
      params,
    );
    const row = result.rows[0];
    if (!row) throw new Error('FOLDER_NOT_FOUND');
    return mapFolderRow(row);
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.pool.query('DELETE FROM folder WHERE folder_id = $1', [folderId]);
  }

  async listCategories(): Promise<StoreCategory[]> {
    const result = await this.pool.query<CategoryRow>(
      'SELECT * FROM category ORDER BY category_code',
    );
    return result.rows.map(mapCategory);
  }

  async createCategory(input: CreateCategoryInput): Promise<StoreCategory> {
    const result = await this.pool.query<CategoryRow>(
      `INSERT INTO category (category_code, category_name, extensions, is_system)
       VALUES ($1, $2, $3, false) RETURNING *`,
      [input.categoryCode, input.categoryName, input.extensions],
    );
    const row = result.rows[0];
    if (!row) throw new Error('CATEGORY_CREATE_FAILED');
    return mapCategory(row);
  }

  async updateCategory(input: UpdateCategoryInput): Promise<StoreCategory> {
    const current = await this.pool.query<{ is_system: boolean }>(
      'SELECT is_system FROM category WHERE category_id = $1',
      [input.categoryId],
    );
    const currentRow = current.rows[0];
    if (!currentRow) throw new Error('CATEGORY_NOT_FOUND');
    if (currentRow.is_system) throw new Error('CATEGORY_SYSTEM_READONLY');

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.categoryName !== undefined) {
      params.push(input.categoryName);
      sets.push(`category_name = $${params.length}`);
    }
    if (input.extensions !== undefined) {
      params.push(input.extensions);
      sets.push(`extensions = $${params.length}`);
    }

    if (sets.length === 0) {
      const found = await this.pool.query<CategoryRow>(
        'SELECT * FROM category WHERE category_id = $1',
        [input.categoryId],
      );
      const row = found.rows[0];
      if (!row) throw new Error('CATEGORY_NOT_FOUND');
      return mapCategory(row);
    }

    params.push(input.categoryId);
    const result = await this.pool.query<CategoryRow>(
      `UPDATE category SET ${sets.join(', ')} WHERE category_id = $${params.length} RETURNING *`,
      params,
    );
    const row = result.rows[0];
    if (!row) throw new Error('CATEGORY_NOT_FOUND');
    return mapCategory(row);
  }

  async deleteCategory(categoryId: string): Promise<void> {
    const result = await this.pool.query(
      'DELETE FROM category WHERE category_id = $1 AND is_system = false RETURNING category_id',
      [categoryId],
    );
    if ((result.rowCount ?? 0) > 0) return;

    const exists = await this.pool.query<{ is_system: boolean }>(
      'SELECT is_system FROM category WHERE category_id = $1',
      [categoryId],
    );
    if ((exists.rowCount ?? 0) === 0) throw new Error('CATEGORY_NOT_FOUND');
    throw new Error('CATEGORY_SYSTEM_READONLY');
  }

  async listFiles(projectId: string): Promise<StoreFile[]> {
    const result = await this.pool.query<FileRow>(`${FILE_SELECT} WHERE f.project_id = $1`, [
      projectId,
    ]);
    return result.rows.map(mapFile);
  }

  async getFile(fileId: string): Promise<StoreFile | null> {
    const result = await this.pool.query<FileRow>(`${FILE_SELECT} WHERE f.file_id = $1`, [fileId]);
    const row = result.rows[0];
    return row ? mapFile(row) : null;
  }

  async addFile(input: AddFileInput): Promise<StoreFile> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let objectId: string | null = null;
      if (input.objectPath && input.sha256) {
        const objectKey = `obj-${input.sha256.slice(0, 24)}`;
        await client.query(
          `INSERT INTO stored_object (object_id, sha256, size_bytes, rel_path, ref_count)
           VALUES ($1, $2, $3, $4, 1)
           ON CONFLICT (sha256) DO UPDATE SET ref_count = stored_object.ref_count + 1`,
          [objectKey, input.sha256, input.sizeBytes, input.objectPath],
        );
        const found = await client.query<{ object_id: string }>(
          'SELECT object_id FROM stored_object WHERE sha256 = $1',
          [input.sha256],
        );
        objectId = found.rows[0]?.object_id ?? null;
      }

      const result = await client.query<{ file_id: string }>(
        `INSERT INTO file (project_id, folder_id, object_id, file_name, size_bytes, content_type, uploader_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING file_id`,
        [
          input.projectId,
          input.folderId,
          objectId,
          input.fileName,
          input.sizeBytes,
          input.contentType,
          input.uploaderId,
        ],
      );
      await client.query('COMMIT');

      const fileId = result.rows[0]?.file_id;
      if (!fileId) throw new Error('文件写入失败：未返回 file_id');
      const created = await this.getFile(fileId);
      if (!created) throw new Error('文件写入后读取失败');
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async trashFile(user: StoreUser, file: StoreFile): Promise<StoreFile> {
    const settings = await this.getSettings();
    await this.pool.query(
      `UPDATE file SET status = 'trashed', trashed_at = now(), expire_at = now() + ($2 || ' days')::interval
       WHERE file_id = $1`,
      [file.fileId, String(settings.trashRetentionDays)],
    );
    await this.recordAudit({
      actor: user,
      action: 'file.trash',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
    const updated = await this.getFile(file.fileId);
    if (!updated) throw new Error('回收站更新后读取失败');
    return updated;
  }

  async restoreFile(user: StoreUser, file: StoreFile): Promise<StoreFile> {
    await this.pool.query(
      `UPDATE file SET status = 'active', trashed_at = NULL, expire_at = NULL WHERE file_id = $1`,
      [file.fileId],
    );
    await this.recordAudit({
      actor: user,
      action: 'file.restore',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
    const updated = await this.getFile(file.fileId);
    if (!updated) throw new Error('恢复后读取失败');
    return updated;
  }

  async purgeFile(user: StoreUser, file: StoreFile): Promise<void> {
    await this.pool.query('DELETE FROM file WHERE file_id = $1', [file.fileId]);
    await this.recordAudit({
      actor: user,
      action: 'file.purge',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
  }

  async listTrash(user: StoreUser): Promise<StoreFile[]> {
    await this.purgeExpired();
    const result = await this.pool.query<FileRow>(
      `${FILE_SELECT} WHERE f.status = 'trashed' ORDER BY f.trashed_at DESC`,
    );
    const visible: StoreFile[] = [];
    for (const row of result.rows) {
      const file = mapFile(row);
      if (await this.canManageTrashedFile(user, file)) visible.push(file);
    }
    return visible;
  }

  async purgeExpired(): Promise<void> {
    const result = await this.pool.query<{ file_id: string; file_name: string }>(
      `DELETE FROM file WHERE status = 'trashed' AND expire_at <= now()
       RETURNING file_id, file_name`,
    );
    for (const row of result.rows) {
      await this.pool.query(
        `INSERT INTO audit_log (actor_name, action, object_type, object_id, result, detail)
         VALUES ('system', 'file.purge_expired', 'file', $1, 'success', $2)`,
        [row.file_id, row.file_name],
      );
    }
  }
}

export async function bootstrapDemoData(pool: Pool): Promise<void> {
  if (process.env['VD_BOOTSTRAP_DEMO'] !== 'true') return;

  const existing = await pool.query<{ count: string }>('SELECT count(*) FROM app_user');
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  const users = [
    { username: 'leader', password: 'leader123', displayName: '领队', role: 'LEADER' },
    { username: 'deputy', password: 'deputy123', displayName: '执行领队', role: 'DEPUTY_LEADER' },
    { username: 'member', password: 'member123', displayName: '队员', role: 'MEMBER' },
  ];

  const created: Record<string, string> = {};
  for (const user of users) {
    const result = await pool.query<{ user_id: string }>(
      `INSERT INTO app_user (username, display_name, role_code, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING user_id`,
      [user.username, user.displayName, user.role, hashPassword(user.password)],
    );
    created[user.username] = result.rows[0]?.user_id ?? '';
  }

  const project = await pool.query<{ project_id: string }>(
    `INSERT INTO project (project_code, project_name) VALUES ('DEMO-001', '示例项目') RETURNING project_id`,
  );
  const projectId = project.rows[0]?.project_id ?? '';

  await pool.query(
    `INSERT INTO project (project_code, project_name) VALUES ('DEMO-002', '仅领队可见项目')`,
  );

  await pool.query(
    `INSERT INTO project_member (project_id, user_id, member_role) VALUES ($1, $2, 'DEPUTY_LEADER'), ($1, $3, 'MEMBER')`,
    [projectId, created['deputy'], created['member']],
  );

  const folder = await pool.query<{ folder_id: string }>(
    `INSERT INTO folder (project_id, folder_name, created_by) VALUES ($1, '原始资料', $2) RETURNING folder_id`,
    [projectId, created['leader']],
  );
  const folderId = folder.rows[0]?.folder_id ?? '';

  const samples = [
    { name: '现场照片-说明.txt', size: 2048, type: 'text/plain', uploader: created['leader'] },
    { name: '测绘成果-示例.csv', size: 8192, type: 'text/csv', uploader: created['leader'] },
    { name: '队员上传-交接记录.txt', size: 1024, type: 'text/plain', uploader: created['member'] },
  ];

  for (const sample of samples) {
    await pool.query(
      `INSERT INTO file (project_id, folder_id, file_name, size_bytes, content_type, uploader_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [projectId, folderId, sample.name, sample.size, sample.type, sample.uploader],
    );
  }
}
