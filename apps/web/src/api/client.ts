const BASE_PATH = '/api/v1';
const TOKEN_KEY = 'vd_token';

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

export function setToken(value: string | null): void {
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

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
  token: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
  avatarUrl?: string;
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
