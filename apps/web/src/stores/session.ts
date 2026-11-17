import { defineStore } from 'pinia';
import { ref } from 'vue';

import {
  ApiError,
  api,
  type LoginResponse,
  type SessionUser,
} from '@/api/client';

export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionUser | null>(null);
  const ready = ref(false);
  const avatarBlobUrl = ref('');

  async function loadAvatar(next: SessionUser | null): Promise<void> {
    if (avatarBlobUrl.value) URL.revokeObjectURL(avatarBlobUrl.value);
    avatarBlobUrl.value = '';

    if (!next?.avatarUrl) return;

    try {
      const response = await fetch(next.avatarUrl, { credentials: 'same-origin' });
      if (response.ok) {
        avatarBlobUrl.value = URL.createObjectURL(await response.blob());
      }
    } catch {
      // 头像加载失败不影响登录
    }
  }

  async function applyUser(next: SessionUser | null): Promise<void> {
    user.value = next;
    await loadAvatar(next);
  }

  async function login(username: string, password: string): Promise<void> {
    const result = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      headers: { 'x-auth-mode': 'cookie' },
      body: JSON.stringify({ username, password }),
    });
    await applyUser({
      userId: result.userId,
      username: result.username,
      displayName: result.displayName,
      role: result.role,
      avatarUrl: result.avatarUrl,
    });
  }

  async function restore(): Promise<void> {
    // 清理旧版本遗留的 localStorage token；会话已迁移到 HttpOnly Cookie
    localStorage.removeItem('vd_token');
    try {
      const me = await api<SessionUser>('/auth/me');
      await applyUser(me);
    } catch {
      await applyUser(null);
    } finally {
      ready.value = true;
    }
  }

  async function logout(): Promise<void> {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      await applyUser(null);
    }
  }

  async function updateProfile(displayName: string): Promise<void> {
    const updated = await api<SessionUser>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    });
    await applyUser(updated);
  }

  async function uploadAvatar(blob: Blob): Promise<void> {
    const response = await fetch('/api/v1/auth/avatar', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: blob,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        problem?.code ?? 'VD-SYS-500',
        problem?.detail ?? '头像上传失败',
      );
    }
    const me = await api<SessionUser>('/auth/me');
    await applyUser(me);
  }

  async function removeAvatar(): Promise<void> {
    await api('/auth/avatar', { method: 'DELETE' });
    const me = await api<SessionUser>('/auth/me');
    await applyUser(me);
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async function refresh(): Promise<void> {
    const me = await api<SessionUser>('/auth/me');
    await applyUser(me);
  }

  return {
    user,
    ready,
    avatarBlobUrl,
    login,
    restore,
    logout,
    updateProfile,
    uploadAvatar,
    removeAvatar,
    changePassword,
    refresh,
  };
});
