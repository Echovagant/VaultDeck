import { randomUUID } from 'node:crypto';

import type {
  AddFileInput,
  AddMemberInput,
  CreateCategoryInput,
  CreateFolderInput,
  CreateProjectInput,
  CreateUserInput,
  PurgeOutcome,
  RecordAuditInput,
  StoreAuditEntry,
  StoreCategory,
  StoreFile,
  StoreFolder,
  StoreLoginResult,
  StoreMember,
  StoreMfaState,
  StorePort,
  StoreProject,
  StoreSettings,
  StoreUser,
  SettingsPatch,
  StoredObjectRecord,
  UpdateCategoryInput,
  UpdateFolderInput,
  UpdateUserInput,
} from '../../application/ports/store.port';

export const TRASH_RETENTION_DAYS = Number(process.env['VD_TRASH_RETENTION_DAYS'] ?? 10);

interface UserRecord extends StoreUser {
  password: string;
  mfaSecret: string | null;
  mfaEnabledAt: string | null;
}

class MemoryStore implements StorePort {
  private readonly users = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, string>();
  private readonly projects = new Map<string, StoreProject>();
  private readonly members = new Map<string, StoreMember>();
  private readonly folders = new Map<string, StoreFolder>();
  private readonly categories = new Map<string, StoreCategory>();
  private readonly files = new Map<string, StoreFile>();
  private readonly audits: StoreAuditEntry[] = [];
  private settings: StoreSettings = {
    maxUploadBytes: 20 * 1024 * 1024 * 1024,
    chunkSizeBytes: 8 * 1024 * 1024,
    trashRetentionDays: TRASH_RETENTION_DAYS,
    instantUploadEnabled: true,
  };

  constructor() {
    this.seed();
  }

  private toStoreUser(record: UserRecord): StoreUser {
    return {
      userId: record.userId,
      username: record.username,
      displayName: record.displayName,
      role: record.role,
      status: record.status,
    };
  }

  async login(username: string, password: string): Promise<StoreLoginResult | null> {
    const user = await this.verifyCredentials(username, password);
    if (!user) return null;
    const token = await this.createSession(user.userId);
    return { token, user };
  }

  async verifyCredentials(username: string, password: string): Promise<StoreUser | null> {
    const record = [...this.users.values()].find(
      (item) => item.username === username && item.status === 'active',
    );
    if (!record || record.password !== password) return null;
    return this.toStoreUser(record);
  }

  async createSession(userId: string): Promise<string> {
    const token = randomUUID();
    this.sessions.set(token, userId);
    return token;
  }

  async mfaState(userId: string): Promise<StoreMfaState> {
    const record = this.users.get(userId);
    return {
      enabled: Boolean(record?.mfaEnabledAt),
      secret: record?.mfaSecret ?? null,
    };
  }

  async setMfaSecret(userId: string, secret: string | null, enabled: boolean): Promise<void> {
    const record = this.users.get(userId);
    if (!record) throw new Error('USER_NOT_FOUND');
    record.mfaSecret = secret;
    record.mfaEnabledAt = enabled ? new Date().toISOString() : null;
  }

  async logout(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async revokeOtherSessions(userId: string, keepToken: string): Promise<void> {
    for (const [token, owner] of this.sessions) {
      if (owner === userId && token !== keepToken) this.sessions.delete(token);
    }
  }

  async revokeAllSessions(userId: string): Promise<void> {
    for (const [token, owner] of this.sessions) {
      if (owner === userId) this.sessions.delete(token);
    }
  }

  async userByToken(token: string): Promise<StoreUser | null> {
    const userId = this.sessions.get(token);
    if (!userId) return null;
    const record = this.users.get(userId);
    return record ? this.toStoreUser(record) : null;
  }

  async countActiveSessions(): Promise<number> {
    return this.sessions.size;
  }

  async listUsers(): Promise<StoreUser[]> {
    return [...this.users.values()].map((record) => this.toStoreUser(record));
  }

  async getUser(userId: string): Promise<StoreUser | null> {
    const record = this.users.get(userId);
    return record ? this.toStoreUser(record) : null;
  }

  async createUser(input: CreateUserInput): Promise<StoreUser> {
    const duplicated = [...this.users.values()].some(
      (record) => record.username.toLowerCase() === input.username.toLowerCase(),
    );
    if (duplicated) throw new Error('USERNAME_TAKEN');

    const record: UserRecord = {
      userId: randomUUID(),
      username: input.username,
      password: input.password,
      displayName: input.displayName,
      role: input.role,
      status: 'active',
      mfaSecret: null,
      mfaEnabledAt: null,
    };
    this.users.set(record.userId, record);
    return this.toStoreUser(record);
  }

  async updateUser(input: UpdateUserInput): Promise<StoreUser> {
    const record = this.users.get(input.userId);
    if (!record) throw new Error('USER_NOT_FOUND');

    if (input.displayName !== undefined) record.displayName = input.displayName;
    if (input.role !== undefined) record.role = input.role;
    if (input.status !== undefined) record.status = input.status;
    if (input.password !== undefined) record.password = input.password;
    return this.toStoreUser(record);
  }

  async getSettings(): Promise<StoreSettings> {
    return { ...this.settings };
  }

  async updateSettings(patch: SettingsPatch): Promise<StoreSettings> {
    if (patch.maxUploadBytes !== undefined) this.settings.maxUploadBytes = patch.maxUploadBytes;
    if (patch.chunkSizeBytes !== undefined) this.settings.chunkSizeBytes = patch.chunkSizeBytes;
    if (patch.trashRetentionDays !== undefined) {
      this.settings.trashRetentionDays = patch.trashRetentionDays;
    }
    if (patch.instantUploadEnabled !== undefined) {
      this.settings.instantUploadEnabled = patch.instantUploadEnabled;
    }
    return { ...this.settings };
  }

  async updateProfile(userId: string, displayName: string): Promise<StoreUser> {
    const record = this.users.get(userId);
    if (!record) throw new Error('USER_NOT_FOUND');
    record.displayName = displayName;
    return this.toStoreUser(record);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const record = this.users.get(userId);
    if (!record) return false;
    if (record.password !== currentPassword) return false;
    record.password = newPassword;
    return true;
  }

  async memberProjectIds(userId: string): Promise<string[]> {
    return [...this.members.values()]
      .filter((member) => member.userId === userId)
      .map((member) => member.projectId);
  }

  async visibleProjectIds(user: StoreUser): Promise<string[] | null> {
    if (user.role === 'LEADER') return null;
    return this.memberProjectIds(user.userId);
  }

  async canAccessProject(user: StoreUser, projectId: string): Promise<boolean> {
    if (user.role === 'LEADER') return true;
    return (await this.memberProjectIds(user.userId)).includes(projectId);
  }

  async canReadFile(user: StoreUser, file: StoreFile): Promise<boolean> {
    if (file.status !== 'active') return false;
    if (user.role === 'LEADER') return true;
    if (!(await this.canAccessProject(user, file.projectId))) return false;
    if (user.role === 'DEPUTY_LEADER') return true;
    return file.uploaderId === user.userId;
  }

  async canDeleteFile(user: StoreUser, file: StoreFile): Promise<boolean> {
    if (file.status !== 'active') return false;
    if (user.role === 'LEADER') return true;
    if (!(await this.canAccessProject(user, file.projectId))) return false;
    if (user.role === 'DEPUTY_LEADER') return true;
    return file.uploaderId === user.userId;
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
    this.audits.push({
      auditId: randomUUID(),
      actorId: input.actor.userId,
      actorName: input.actor.username,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      result: input.result,
      detail: input.detail,
      occurredAt: new Date().toISOString(),
    });
  }

  async listAudit(user: StoreUser): Promise<StoreAuditEntry[]> {
    if (!this.canViewAudit(user)) return [];
    if (user.role === 'LEADER') return [...this.audits].reverse();

    const projectIds = new Set(await this.memberProjectIds(user.userId));
    return this.audits
      .filter((entry) => entry.actorId === user.userId || projectIds.has(entry.objectId))
      .reverse();
  }

  async listProjects(): Promise<StoreProject[]> {
    return [...this.projects.values()];
  }

  async createProject(input: CreateProjectInput): Promise<StoreProject> {
    const project: StoreProject = {
      projectId: randomUUID(),
      projectCode: input.projectCode,
      projectName: input.projectName,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.projectId, project);
    return project;
  }

  async listMembers(projectId: string): Promise<StoreMember[]> {
    return [...this.members.values()].filter((member) => member.projectId === projectId);
  }

  async addMember(input: AddMemberInput): Promise<StoreMember> {
    const member: StoreMember = {
      projectId: input.projectId,
      userId: input.userId,
      memberRole: input.memberRole,
      joinedAt: new Date().toISOString(),
    };
    this.members.set(`${input.projectId}:${input.userId}`, member);
    return member;
  }

  async listFolders(projectId: string): Promise<StoreFolder[]> {
    return [...this.folders.values()]
      .filter((folder) => folder.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createFolder(input: CreateFolderInput): Promise<StoreFolder> {
    const folder: StoreFolder = {
      folderId: randomUUID(),
      projectId: input.projectId,
      folderName: input.folderName,
      parentId: input.parentId,
      createdAt: new Date().toISOString(),
    };
    this.folders.set(folder.folderId, folder);
    return folder;
  }

  async getFolder(folderId: string): Promise<StoreFolder | null> {
    return this.folders.get(folderId) ?? null;
  }

  async updateFolder(input: UpdateFolderInput): Promise<StoreFolder> {
    const folder = this.folders.get(input.folderId);
    if (!folder) throw new Error('FOLDER_NOT_FOUND');

    if (input.folderName !== undefined) folder.folderName = input.folderName;
    if (input.parentId !== undefined) folder.parentId = input.parentId;
    return folder;
  }

  async deleteFolder(folderId: string): Promise<void> {
    this.folders.delete(folderId);
  }

  async listCategories(): Promise<StoreCategory[]> {
    return [...this.categories.values()].sort((left, right) =>
      left.categoryCode.localeCompare(right.categoryCode),
    );
  }

  async createCategory(input: CreateCategoryInput): Promise<StoreCategory> {
    const duplicated = [...this.categories.values()].some(
      (category) => category.categoryCode.toLowerCase() === input.categoryCode.toLowerCase(),
    );
    if (duplicated) throw new Error('CATEGORY_CODE_TAKEN');

    const category: StoreCategory = {
      categoryId: randomUUID(),
      categoryCode: input.categoryCode,
      categoryName: input.categoryName,
      extensions: input.extensions,
      isSystem: false,
    };
    this.categories.set(category.categoryId, category);
    return category;
  }

  async updateCategory(input: UpdateCategoryInput): Promise<StoreCategory> {
    const category = this.categories.get(input.categoryId);
    if (!category) throw new Error('CATEGORY_NOT_FOUND');
    if (category.isSystem) throw new Error('CATEGORY_SYSTEM_READONLY');
    if (input.categoryName !== undefined) category.categoryName = input.categoryName;
    if (input.extensions !== undefined) category.extensions = input.extensions;
    return category;
  }

  async deleteCategory(categoryId: string): Promise<void> {
    const category = this.categories.get(categoryId);
    if (!category) throw new Error('CATEGORY_NOT_FOUND');
    if (category.isSystem) throw new Error('CATEGORY_SYSTEM_READONLY');
    this.categories.delete(categoryId);
  }

  async listFiles(projectId: string): Promise<StoreFile[]> {
    return [...this.files.values()].filter((file) => file.projectId === projectId);
  }

  async getFile(fileId: string): Promise<StoreFile | null> {
    return this.files.get(fileId) ?? null;
  }

  async addFile(input: AddFileInput): Promise<StoreFile> {
    const file: StoreFile = {
      fileId: randomUUID(),
      projectId: input.projectId,
      folderId: input.folderId,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      uploaderId: input.uploaderId,
      sha256: input.sha256,
      objectPath: input.objectPath,
      status: 'active',
      trashedAt: null,
      expireAt: null,
      createdAt: new Date().toISOString(),
    };
    this.files.set(file.fileId, file);
    return file;
  }

  async listStoredObjects(): Promise<StoredObjectRecord[]> {
    const objects = new Map<string, StoredObjectRecord>();
    for (const file of this.files.values()) {
      if (!file.objectPath || !file.sha256) continue;
      objects.set(file.objectPath, {
        objectId: `obj-${file.sha256.slice(0, 24)}`,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        relPath: file.objectPath,
      });
    }
    return [...objects.values()];
  }

  async trashFile(user: StoreUser, file: StoreFile): Promise<StoreFile> {
    const now = new Date();
    file.status = 'trashed';
    file.trashedAt = now.toISOString();
    file.expireAt = new Date(
      now.getTime() + this.settings.trashRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    await this.recordAudit({
      actor: user,
      action: 'file.trash',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
    return file;
  }

  async restoreFile(user: StoreUser, file: StoreFile): Promise<StoreFile> {
    file.status = 'active';
    file.trashedAt = null;
    file.expireAt = null;
    await this.recordAudit({
      actor: user,
      action: 'file.restore',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
    return file;
  }

  async purgeFile(user: StoreUser, file: StoreFile): Promise<PurgeOutcome> {
    this.files.delete(file.fileId);
    await this.recordAudit({
      actor: user,
      action: 'file.purge',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
    // 内存模式无对象登记表，不做磁盘回收（对象回收语义仅 postgres 实现承担）
    return { purgedFiles: 1, reclaimedObjectPaths: [] };
  }

  async listTrash(user: StoreUser): Promise<StoreFile[]> {
    await this.purgeExpired();
    const candidates = [...this.files.values()].filter((file) => file.status === 'trashed');
    const visible: StoreFile[] = [];
    for (const file of candidates) {
      if (await this.canManageTrashedFile(user, file)) visible.push(file);
    }
    return visible.sort((left, right) =>
      (right.trashedAt ?? '').localeCompare(left.trashedAt ?? ''),
    );
  }

  async purgeExpired(): Promise<PurgeOutcome> {
    const now = Date.now();
    let purged = 0;
    for (const file of [...this.files.values()]) {
      if (file.status !== 'trashed' || !file.expireAt) continue;
      if (new Date(file.expireAt).getTime() <= now) {
        this.files.delete(file.fileId);
        purged += 1;
        this.audits.push({
          auditId: randomUUID(),
          actorId: 'system',
          actorName: 'system',
          action: 'file.purge_expired',
          objectType: 'file',
          objectId: file.fileId,
          result: 'success',
          detail: file.fileName,
          occurredAt: new Date().toISOString(),
        });
      }
    }
    return { purgedFiles: purged, reclaimedObjectPaths: [] };
  }

  private seedCategories(): void {
    const defaults: Array<[string, string, string[]]> = [
      ['IMAGE', '图片', ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']],
      ['AUDIO', '音频', ['.mp3', '.wav', '.flac', '.aac', '.m4a']],
      ['VIDEO', '视频', ['.mp4', '.mov', '.avi', '.mkv', '.wmv']],
      ['SURVEY', '测绘', ['.dwg', '.dxf', '.shp', '.kml', '.geojson', '.las']],
      [
        'DOCUMENT',
        '文档',
        ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.txt', '.csv'],
      ],
      ['OTHER', '其他', ['.zip', '.rar', '.7z']],
    ];

    for (const [code, name, extensions] of defaults) {
      const category: StoreCategory = {
        categoryId: randomUUID(),
        categoryCode: code,
        categoryName: name,
        extensions,
        isSystem: true,
      };
      this.categories.set(category.categoryId, category);
    }
  }

  private seed(): void {
    this.seedCategories();
    const leader = this.seedUser('leader', 'leader123', '领队', 'LEADER');
    const deputy = this.seedUser('deputy', 'deputy123', '执行领队', 'DEPUTY_LEADER');
    const member = this.seedUser('member', 'member123', '队员', 'MEMBER');

    const project = this.createProjectSync({ projectCode: 'DEMO-001', projectName: '示例项目' });
    const privateProject = this.createProjectSync({
      projectCode: 'DEMO-002',
      projectName: '仅领队可见项目',
    });

    this.members.set(`${project.projectId}:${deputy.userId}`, {
      projectId: project.projectId,
      userId: deputy.userId,
      memberRole: 'DEPUTY_LEADER',
      joinedAt: new Date().toISOString(),
    });
    this.members.set(`${project.projectId}:${member.userId}`, {
      projectId: project.projectId,
      userId: member.userId,
      memberRole: 'MEMBER',
      joinedAt: new Date().toISOString(),
    });

    const folder = this.createFolderSync(project.projectId, '原始资料');
    this.createFolderSync(privateProject.projectId, '内部资料');

    this.addFileSync({
      projectId: project.projectId,
      folderId: folder.folderId,
      fileName: '现场照片-说明.txt',
      sizeBytes: 2048,
      contentType: 'text/plain',
      uploaderId: leader.userId,
      sha256: '',
      objectPath: '',
    });
    this.addFileSync({
      projectId: project.projectId,
      folderId: folder.folderId,
      fileName: '测绘成果-示例.csv',
      sizeBytes: 8192,
      contentType: 'text/csv',
      uploaderId: leader.userId,
      sha256: '',
      objectPath: '',
    });
    this.addFileSync({
      projectId: project.projectId,
      folderId: folder.folderId,
      fileName: '队员上传-交接记录.txt',
      sizeBytes: 1024,
      contentType: 'text/plain',
      uploaderId: member.userId,
      sha256: '',
      objectPath: '',
    });
  }

  private seedUser(
    username: string,
    password: string,
    displayName: string,
    role: StoreUser['role'],
  ): UserRecord {
    const record: UserRecord = {
      userId: randomUUID(),
      username,
      password,
      displayName,
      role,
      status: 'active',
      mfaSecret: null,
      mfaEnabledAt: null,
    };
    this.users.set(record.userId, record);
    return record;
  }

  private createProjectSync(input: CreateProjectInput): StoreProject {
    const project: StoreProject = {
      projectId: randomUUID(),
      projectCode: input.projectCode,
      projectName: input.projectName,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.projectId, project);
    return project;
  }

  private createFolderSync(projectId: string, folderName: string): StoreFolder {
    const folder: StoreFolder = {
      folderId: randomUUID(),
      projectId,
      folderName,
      parentId: null,
      createdAt: new Date().toISOString(),
    };
    this.folders.set(folder.folderId, folder);
    return folder;
  }

  private addFileSync(input: AddFileInput): StoreFile {
    const file: StoreFile = {
      fileId: randomUUID(),
      projectId: input.projectId,
      folderId: input.folderId,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      uploaderId: input.uploaderId,
      sha256: input.sha256,
      objectPath: input.objectPath,
      status: 'active',
      trashedAt: null,
      expireAt: null,
      createdAt: new Date().toISOString(),
    };
    this.files.set(file.fileId, file);
    return file;
  }
}

export const memoryStore = new MemoryStore();
