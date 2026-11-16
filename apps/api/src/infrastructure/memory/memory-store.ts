import { randomUUID } from 'node:crypto';

export type RoleCode = 'LEADER' | 'DEPUTY_LEADER' | 'MEMBER';

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
  createdAt: string;
}

class MemoryStore {
  readonly users = new Map<string, MemoryUser>();
  readonly sessions = new Map<string, string>();
  readonly projects = new Map<string, MemoryProject>();
  readonly folders = new Map<string, MemoryFolder>();
  readonly files = new Map<string, MemoryFile>();

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

  private seed(): void {
    const leader: MemoryUser = {
      userId: randomUUID(),
      username: 'leader',
      password: 'leader123',
      displayName: '领队',
      role: 'LEADER',
      status: 'active',
    };
    this.users.set(leader.userId, leader);

    const project = this.createProject({ projectCode: 'DEMO-001', projectName: '示例项目' });
    const folder = this.createFolder({
      projectId: project.projectId,
      folderName: '原始资料',
      parentId: null,
    });

    const samples = [
      { fileName: '现场照片-说明.txt', sizeBytes: 2048, contentType: 'text/plain' },
      { fileName: '测绘成果-示例.csv', sizeBytes: 8192, contentType: 'text/csv' },
    ];
    for (const sample of samples) {
      const file: MemoryFile = {
        fileId: randomUUID(),
        projectId: project.projectId,
        folderId: folder.folderId,
        fileName: sample.fileName,
        sizeBytes: sample.sizeBytes,
        contentType: sample.contentType,
        uploaderId: leader.userId,
        createdAt: new Date().toISOString(),
      };
      this.files.set(file.fileId, file);
    }
  }
}

export const memoryStore = new MemoryStore();
