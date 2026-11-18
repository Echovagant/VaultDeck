const BASE_PATH = '/api/v1';

/** 统一的 API 错误类型，携带 HTTP 状态码与业务错误码。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** 封装 fetch：自动处理 JSON、204 空响应与 problem+json 错误。 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');

  const response = await fetch(`${BASE_PATH}${path}`, { ...init, headers });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const problem = body as { code?: string; detail?: string; title?: string } | null;
    throw new ApiError(
      response.status,
      problem?.code ?? 'VD-SYS-500',
      problem?.detail ?? problem?.title ?? '请求失败',
    );
  }

  return body as T;
}

export interface LoginResponse {
  token?: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
  avatarUrl?: string;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
  expiresInSeconds: number;
}

export interface MfaStatus {
  enabled: boolean;
}

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
}

export interface SessionUser {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  avatarUrl?: string;
}

export interface ProjectSummary {
  projectId: string;
  projectCode: string;
  projectName: string;
  status: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
}

export interface FolderItem {
  folderId: string;
  projectId: string;
  folderName: string;
  parentId: string | null;
  createdAt: string;
}

export interface FileItem {
  fileId: string;
  projectId: string;
  folderId: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  uploaderId: string;
  createdAt: string;
  hasContent?: boolean;
}

/** 把字节数格式化为 KB/MB/GB，保留一位小数。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}
