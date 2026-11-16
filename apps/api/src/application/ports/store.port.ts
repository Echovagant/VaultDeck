export type RoleCode = 'LEADER' | 'DEPUTY_LEADER' | 'MEMBER';
export type FileStatus = 'active' | 'trashed';
export type AuditResult = 'success' | 'denied' | 'failed';

export interface StoreUser {
  userId: string;
  username: string;
  displayName: string;
  role: RoleCode;
  status: 'active' | 'disabled';
}

export interface StoreProject {
  projectId: string;
  projectCode: string;
  projectName: string;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface StoreMember {
  projectId: string;
  userId: string;
  memberRole: 'DEPUTY_LEADER' | 'MEMBER';
  joinedAt: string;
}

export interface StoreFolder {
  folderId: string;
  projectId: string;
  folderName: string;
  parentId: string | null;
  createdAt: string;
}

export interface StoreFile {
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

export interface StoreAuditEntry {
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

export interface StoreLoginResult {
  token: string;
  user: StoreUser;
}

export interface CreateProjectInput {
  projectCode: string;
  projectName: string;
}

export interface AddMemberInput {
  projectId: string;
  userId: string;
  memberRole: 'DEPUTY_LEADER' | 'MEMBER';
}

export interface CreateFolderInput {
  projectId: string;
  folderName: string;
  parentId: string | null;
  createdBy: string;
}

export interface AddFileInput {
  projectId: string;
  folderId: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  uploaderId: string;
  sha256: string;
  objectPath: string;
}

export interface RecordAuditInput {
  actor: StoreUser;
  action: string;
  objectType: string;
  objectId: string;
  result: AuditResult;
  detail: string;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  role: RoleCode;
  password: string;
}

export interface UpdateUserInput {
  userId: string;
  displayName?: string;
  role?: RoleCode;
  status?: 'active' | 'disabled';
  password?: string;
}

export interface StorePort {
  login(username: string, password: string): Promise<StoreLoginResult | null>;
  logout(token: string): Promise<void>;
  userByToken(token: string): Promise<StoreUser | null>;

  listUsers(): Promise<StoreUser[]>;
  getUser(userId: string): Promise<StoreUser | null>;
  createUser(input: CreateUserInput): Promise<StoreUser>;
  updateUser(input: UpdateUserInput): Promise<StoreUser>;

  memberProjectIds(userId: string): Promise<string[]>;
  visibleProjectIds(user: StoreUser): Promise<string[] | null>;
  canAccessProject(user: StoreUser, projectId: string): Promise<boolean>;
  canReadFile(user: StoreUser, file: StoreFile): Promise<boolean>;
  canDeleteFile(user: StoreUser, file: StoreFile): Promise<boolean>;
  canManageTrashedFile(user: StoreUser, file: StoreFile): Promise<boolean>;
  canViewAudit(user: StoreUser): boolean;

  recordAudit(input: RecordAuditInput): Promise<void>;
  listAudit(user: StoreUser): Promise<StoreAuditEntry[]>;

  listProjects(): Promise<StoreProject[]>;
  createProject(input: CreateProjectInput): Promise<StoreProject>;

  listMembers(projectId: string): Promise<StoreMember[]>;
  addMember(input: AddMemberInput): Promise<StoreMember>;

  listFolders(projectId: string): Promise<StoreFolder[]>;
  createFolder(input: CreateFolderInput): Promise<StoreFolder>;

  listFiles(projectId: string): Promise<StoreFile[]>;
  getFile(fileId: string): Promise<StoreFile | null>;
  addFile(input: AddFileInput): Promise<StoreFile>;
  trashFile(user: StoreUser, file: StoreFile): Promise<StoreFile>;
  restoreFile(user: StoreUser, file: StoreFile): Promise<StoreFile>;
  purgeFile(user: StoreUser, file: StoreFile): Promise<void>;
  listTrash(user: StoreUser): Promise<StoreFile[]>;
  purgeExpired(): Promise<void>;
}
