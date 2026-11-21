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

export interface StoreCategory {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  extensions: string[];
  isSystem: boolean;
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

export interface StoreMfaState {
  enabled: boolean;
  /** 已加密的 TOTP 密钥；尚未设置时为 null */
  secret: string | null;
}

export interface StoreSettings {
  maxUploadBytes: number;
  chunkSizeBytes: number;
  trashRetentionDays: number;
  instantUploadEnabled: boolean;
}

export interface SettingsPatch {
  maxUploadBytes?: number;
  chunkSizeBytes?: number;
  trashRetentionDays?: number;
  instantUploadEnabled?: boolean;
}

/** 对外可见的 AI 服务设置（永不携带密钥本身，只有 hasApiKey 布尔） */
export interface AiSettingsView {
  providerId: string | null;
  baseUrl: string | null;
  model: string | null;
  effort: string | null;
  hasApiKey: boolean;
}

/** Agent 授权绑定的角色档位：领队档不开放给外部 Agent */
export type AgentGrantRole = 'DEPUTY_LEADER' | 'MEMBER';

/** 对外可见的 Agent 授权（永不包含授权码 / token 明文或其 hash） */
export interface AgentGrantView {
  grantId: string;
  name: string;
  role: AgentGrantRole;
  scopeAll: boolean;
  projectIds: string[];
  readOnly: boolean;
  codeUsed: boolean;
  codeExpiresAt: string | null;
  hasToken: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface CreateAgentGrantInput {
  name: string;
  role: AgentGrantRole;
  scopeAll: boolean;
  projectIds: string[];
  readOnly: boolean;
  createdBy: string;
}

/** 授权码明文只在创建响应里出现一次，库存 hash */
export interface AgentGrantSecret {
  grantId: string;
  code: string;
  expiresAt: string;
}

/** 兑换成功后的签发结果；token 明文只在兑换响应里出现一次 */
export interface AgentTokenIssued {
  grantId: string;
  token: string;
  displayName: string;
  role: AgentGrantRole;
  scopeAll: boolean;
  projectIds: string[];
  readOnly: boolean;
}

/** Agent token 解析出的身份：合成用户 + 所在授权 */
export interface AgentIdentity {
  user: StoreUser;
  grant: AgentGrantView;
}

export interface AiSettingsPatchInput {
  providerId?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  effort?: string | null;
  /** undefined=不动；null=清除；字符串=写入（内存明文，落库前由实现加密） */
  apiKey?: string | null;
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

export interface UpdateFolderInput {
  folderId: string;
  folderName?: string;
  parentId?: string | null;
}

export interface CreateCategoryInput {
  categoryCode: string;
  categoryName: string;
  extensions: string[];
}

export interface UpdateCategoryInput {
  categoryId: string;
  categoryName?: string;
  extensions?: string[];
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

export interface PurgeOutcome {
  purgedFiles: number;
  /** ref_count 归零后删除的存储对象 rel_path，磁盘删除由调用方执行 */
  reclaimedObjectPaths: string[];
}

export interface StoredObjectRecord {
  objectId: string;
  sha256: string;
  sizeBytes: number;
  relPath: string;
}

export interface StorePort {
  login(username: string, password: string): Promise<StoreLoginResult | null>;
  verifyCredentials(username: string, password: string): Promise<StoreUser | null>;
  createSession(userId: string): Promise<string>;
  logout(token: string): Promise<void>;
  userByToken(token: string): Promise<StoreUser | null>;
  countActiveSessions(): Promise<number>;

  mfaState(userId: string): Promise<StoreMfaState>;
  setMfaSecret(userId: string, secret: string | null, enabled: boolean): Promise<void>;

  listUsers(): Promise<StoreUser[]>;
  getUser(userId: string): Promise<StoreUser | null>;
  createUser(input: CreateUserInput): Promise<StoreUser>;
  updateUser(input: UpdateUserInput): Promise<StoreUser>;
  updateProfile(userId: string, displayName: string): Promise<StoreUser>;
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean>;
  revokeOtherSessions(userId: string, keepToken: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;

  getSettings(): Promise<StoreSettings>;
  updateSettings(patch: SettingsPatch): Promise<StoreSettings>;

  getAiSettings(): Promise<AiSettingsView>;
  updateAiSettings(patch: AiSettingsPatchInput): Promise<AiSettingsView>;
  /** 明文 API Key，仅供服务端调用模型适配器，禁止回传前端或写入日志 */
  aiApiKey(): Promise<string | null>;

  createAgentGrant(input: CreateAgentGrantInput): Promise<{
    view: AgentGrantView;
    secret: AgentGrantSecret;
  }>;
  listAgentGrants(): Promise<AgentGrantView[]>;
  revokeAgentGrant(grantId: string): Promise<AgentGrantView | null>;
  /** 一次性授权码换 token；无效 / 已用 / 过期 / 已撤销返回 null */
  exchangeAgentCode(code: string): Promise<AgentTokenIssued | null>;
  /** Agent token → 合成用户身份；无效或已撤销返回 null */
  userByAgentToken(token: string): Promise<AgentIdentity | null>;

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
  getFolder(folderId: string): Promise<StoreFolder | null>;
  createFolder(input: CreateFolderInput): Promise<StoreFolder>;
  updateFolder(input: UpdateFolderInput): Promise<StoreFolder>;
  deleteFolder(folderId: string): Promise<void>;

  listCategories(): Promise<StoreCategory[]>;
  createCategory(input: CreateCategoryInput): Promise<StoreCategory>;
  updateCategory(input: UpdateCategoryInput): Promise<StoreCategory>;
  deleteCategory(categoryId: string): Promise<void>;

  listFiles(projectId: string): Promise<StoreFile[]>;
  getFile(fileId: string): Promise<StoreFile | null>;
  addFile(input: AddFileInput): Promise<StoreFile>;
  trashFile(user: StoreUser, file: StoreFile): Promise<StoreFile>;
  restoreFile(user: StoreUser, file: StoreFile): Promise<StoreFile>;
  purgeFile(user: StoreUser, file: StoreFile): Promise<PurgeOutcome>;
  listTrash(user: StoreUser): Promise<StoreFile[]>;
  purgeExpired(): Promise<PurgeOutcome>;

  /** 完整性巡检（B7）：列出全部存储对象行 */
  listStoredObjects(): Promise<StoredObjectRecord[]>;
}
