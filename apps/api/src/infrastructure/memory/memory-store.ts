import { randomUUID } from 'node:crypto';

export type RoleCode = 'LEADER' | 'DEPUTY_LEADER' | 'MEMBER';
export type FileStatus = 'active' | 'trashed';
export type AuditResult = 'success' | 'denied' | 'failed';

export interface MemoryUser {
  userId: string;
  username: string;
  password: string;
  displayName: string;
  role: RoleCode;
  status: 'active' | 'disabled';
}

export interface MemoryProject {
  projectId: string;
  projectCode: string;
  projectName: string;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface MemoryProjectMember {
  projectId: string;
  userId: string;
  memberRole: 'DEPUTY_LEADER' | 'MEMBER';
  joinedAt: string;
}

export interface MemoryFolder {
  folderId: string;
  projectId: string;
  folderName: string;
  parentId: string | null;
  createdAt: string;
}

export interface MemoryFile {
  fileId: string;
  projectId: string;
  folderId: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  uploaderId: string;
  sha256: string;
  objectPath: string;
  status: FileStatus;
  trashedAt: string | null;
  expireAt: string | null;
  createdAt: string;
}

export interface MemoryAuditEntry {
  auditId: string;
  actorId: string;
  actorName: string;
  action: string;
  objectType: string;
  objectId: string;
  result: AuditResult;
  detail: string;
  occurredAt: string;
}

export const TRASH_RETENTION_DAYS = Number(process.env['VD_TRASH_RETENTION_DAYS'] ?? 10);

class MemoryStore {
  readonly users = new Map<string, MemoryUser>();
  readonly sessions = new Map<string, string>();
  readonly projects = new Map<string, MemoryProject>();
  readonly members = new Map<string, MemoryProjectMember>();
  readonly folders = new Map<string, MemoryFolder>();
  readonly files = new Map<string, MemoryFile>();
  readonly audits: MemoryAuditEntry[] = [];

  constructor() {
    this.seed();
  }

  login(username: string, password: string): { token: string; user: MemoryUser } | null {
    const user = [...this.users.values()].find(
      (item) => item.username === username && item.status === 'active',
    );
    if (!user || user.password !== password) return null;

    const token = randomUUID();
    this.sessions.set(token, user.userId);
    return { token, user };
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  userByToken(token: string): MemoryUser | null {
    const userId = this.sessions.get(token);
    if (!userId) return null;
    return this.users.get(userId) ?? null;
  }

  memberProjectIds(userId: string): string[] {
    return [...this.members.values()]
      .filter((member) => member.userId === userId)
      .map((member) => member.projectId);
  }

  visibleProjectIds(user: MemoryUser): string[] | null {
    if (user.role === 'LEADER') return null;
    return this.memberProjectIds(user.userId);
  }

  canAccessProject(user: MemoryUser, projectId: string): boolean {
    if (user.role === 'LEADER') return true;
    return this.memberProjectIds(user.userId).includes(projectId);
  }

  canReadFile(user: MemoryUser, file: MemoryFile): boolean {
    if (file.status !== 'active') return false;
    if (user.role === 'LEADER') return true;
    if (!this.canAccessProject(user, file.projectId)) return false;
    if (user.role === 'DEPUTY_LEADER') return true;
    return file.uploaderId === user.userId;
  }

  canDeleteFile(user: MemoryUser, file: MemoryFile): boolean {
    if (file.status !== 'active') return false;
    if (user.role === 'LEADER') return true;
    if (!this.canAccessProject(user, file.projectId)) return false;
    if (user.role === 'DEPUTY_LEADER') return true;
    return file.uploaderId === user.userId;
  }

  canViewAudit(user: MemoryUser): boolean {
    return user.role !== 'MEMBER';
  }

  canManageTrashedFile(user: MemoryUser, file: MemoryFile): boolean {
    if (user.role === 'LEADER') return true;
    if (!this.canAccessProject(user, file.projectId)) return false;
    if (user.role === 'DEPUTY_LEADER') return true;
    return file.uploaderId === user.userId;
  }

  recordAudit(input: {
    actor: MemoryUser;
    action: string;
    objectType: string;
    objectId: string;
    result: AuditResult;
    detail: string;
  }): MemoryAuditEntry {
    const entry: MemoryAuditEntry = {
      auditId: randomUUID(),
      actorId: input.actor.userId,
      actorName: input.actor.username,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      result: input.result,
      detail: input.detail,
      occurredAt: new Date().toISOString(),
    };
    this.audits.push(entry);
    return entry;
  }

  createProject(input: { projectCode: string; projectName: string }): MemoryProject {
    const project: MemoryProject = {
      projectId: randomUUID(),
      projectCode: input.projectCode,
      projectName: input.projectName,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.projectId, project);
    return project;
  }

  addMember(input: {
    projectId: string;
    userId: string;
    memberRole: 'DEPUTY_LEADER' | 'MEMBER';
  }): MemoryProjectMember {
    const member: MemoryProjectMember = {
      projectId: input.projectId,
      userId: input.userId,
      memberRole: input.memberRole,
      joinedAt: new Date().toISOString(),
    };
    this.members.set(`${input.projectId}:${input.userId}`, member);
    return member;
  }

  createFolder(input: {
    projectId: string;
    folderName: string;
    parentId: string | null;
  }): MemoryFolder {
    const folder: MemoryFolder = {
      folderId: randomUUID(),
      projectId: input.projectId,
      folderName: input.folderName,
      parentId: input.parentId,
      createdAt: new Date().toISOString(),
    };
    this.folders.set(folder.folderId, folder);
    return folder;
  }

  addFile(input: {
    projectId: string;
    folderId: string;
    fileName: string;
    sizeBytes: number;
    contentType: string;
    uploaderId: string;
    sha256: string;
    objectPath: string;
  }): MemoryFile {
    const file: MemoryFile = {
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

  trashFile(user: MemoryUser, file: MemoryFile): MemoryFile {
    const now = new Date();
    file.status = 'trashed';
    file.trashedAt = now.toISOString();
    file.expireAt = new Date(
      now.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.recordAudit({
      actor: user,
      action: 'file.trash',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
    return file;
  }

  restoreFile(user: MemoryUser, file: MemoryFile): MemoryFile {
    file.status = 'active';
    file.trashedAt = null;
    file.expireAt = null;
    this.recordAudit({
      actor: user,
      action: 'file.restore',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
    return file;
  }

  purgeFile(user: MemoryUser, file: MemoryFile): void {
    this.files.delete(file.fileId);
    this.recordAudit({
      actor: user,
      action: 'file.purge',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
  }

  listTrash(user: MemoryUser): MemoryFile[] {
    this.purgeExpired();
    return [...this.files.values()]
      .filter((file) => file.status === 'trashed')
      .filter((file) => {
        if (user.role === 'LEADER') return true;
        if (!this.canAccessProject(user, file.projectId)) return false;
        if (user.role === 'DEPUTY_LEADER') return true;
        return file.uploaderId === user.userId;
      })
      .sort((left, right) => (right.trashedAt ?? '').localeCompare(left.trashedAt ?? ''));
  }

  listAudit(user: MemoryUser): MemoryAuditEntry[] {
    if (!this.canViewAudit(user)) return [];
    if (user.role === 'LEADER') return [...this.audits].reverse();

    const projectIds = new Set(this.memberProjectIds(user.userId));
    return this.audits
      .filter((entry) => entry.actorId === user.userId || projectIds.has(entry.objectId))
      .reverse();
  }

  purgeExpired(): void {
    const now = Date.now();
    for (const file of this.files.values()) {
      if (file.status !== 'trashed' || !file.expireAt) continue;
      if (new Date(file.expireAt).getTime() <= now) {
        this.files.delete(file.fileId);
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
  }

  private seed(): void {
    const leader: MemoryUser = {
      userId: randomUUID(),
      username: 'leader',
      password: 'leader123',
      displayName: '领队',
      role: 'LEADER',
      status: 'active',
    };
    const deputy: MemoryUser = {
      userId: randomUUID(),
      username: 'deputy',
      password: 'deputy123',
      displayName: '执行领队',
      role: 'DEPUTY_LEADER',
      status: 'active',
    };
    const member: MemoryUser = {
      userId: randomUUID(),
      username: 'member',
      password: 'member123',
      displayName: '队员',
      role: 'MEMBER',
      status: 'active',
    };
    for (const user of [leader, deputy, member]) this.users.set(user.userId, user);

    const project = this.createProject({ projectCode: 'DEMO-001', projectName: '示例项目' });
    const privateProject = this.createProject({
      projectCode: 'DEMO-002',
      projectName: '仅领队可见项目',
    });
    this.addMember({
      projectId: project.projectId,
      userId: deputy.userId,
      memberRole: 'DEPUTY_LEADER',
    });
    this.addMember({ projectId: project.projectId, userId: member.userId, memberRole: 'MEMBER' });

    const folder = this.createFolder({
      projectId: project.projectId,
      folderName: '原始资料',
      parentId: null,
    });
    this.createFolder({
      projectId: privateProject.projectId,
      folderName: '内部资料',
      parentId: null,
    });

    const samples = [
      {
        fileName: '现场照片-说明.txt',
        sizeBytes: 2048,
        contentType: 'text/plain',
        uploaderId: leader.userId,
      },
      {
        fileName: '测绘成果-示例.csv',
        sizeBytes: 8192,
        contentType: 'text/csv',
        uploaderId: leader.userId,
      },
      {
        fileName: '队员上传-交接记录.txt',
        sizeBytes: 1024,
        contentType: 'text/plain',
        uploaderId: member.userId,
      },
    ];
    for (const sample of samples) {
      this.addFile({
        projectId: project.projectId,
        folderId: folder.folderId,
        fileName: sample.fileName,
        sizeBytes: sample.sizeBytes,
        contentType: sample.contentType,
        uploaderId: sample.uploaderId,
        sha256: '',
        objectPath: '',
      });
    }
  }
}

export const memoryStore = new MemoryStore();
