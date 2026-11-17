import { defineStore } from 'pinia';
import { ref } from 'vue';

import {
  ApiError,
  api,
  type LoginResponse,
  type MfaChallengeResponse,
  type MfaSetup,
  type MfaStatus,
  type SessionUser,
} from '@/api/client';

function isMfaChallenge(
  result: LoginResponse | MfaChallengeResponse,
): result is MfaChallengeResponse {
  return 'challengeToken' in result;
}

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

  async function login(username: string, password: string): Promise<MfaChallengeResponse | null> {
    const result = await api<LoginResponse | MfaChallengeResponse>('/auth/login', {
      method: 'POST',
      headers: { 'x-auth-mode': 'cookie' },
      body: JSON.stringify({ username, password }),
    });
    if (isMfaChallenge(result)) {
      return result;
    }
    await applyUser({
      userId: result.userId,
      username: result.username,
      displayName: result.displayName,
      role: result.role,
      avatarUrl: result.avatarUrl,
    });
    return null;
  }

  async function verifyMfa(challengeToken: string, code: string): Promise<void> {
    const result = await api<LoginResponse>('/auth/mfa/verify', {
      method: 'POST',
      headers: { 'x-auth-mode': 'cookie' },
      body: JSON.stringify({ challengeToken, code }),
    });
    await applyUser({
      userId: result.userId,
      username: result.username,
      displayName: result.displayName,
      role: result.role,
      avatarUrl: result.avatarUrl,
    });
  }

  async function mfaStatus(): Promise<MfaStatus> {
    return api<MfaStatus>('/auth/mfa');
  }

  async function setupMfa(): Promise<MfaSetup> {
    return api<MfaSetup>('/auth/mfa/setup', { method: 'POST' });
  }

  async function enableMfa(code: string): Promise<void> {
    await api('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) });
  }

  async function disableMfa(password: string, code: string): Promise<void> {
    await api('/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ password, code }),
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
    verifyMfa,
    mfaStatus,
    setupMfa,
    enableMfa,
    disableMfa,
    restore,
    logout,
    updateProfile,
    uploadAvatar,
    removeAvatar,
    changePassword,
    refresh,
  };
});
