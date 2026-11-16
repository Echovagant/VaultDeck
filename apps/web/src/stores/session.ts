import { defineStore } from 'pinia';
import { ref } from 'vue';

import { api, setToken, type LoginResponse, type SessionUser } from '@/api/client';

export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionUser | null>(null);
  const ready = ref(false);

  async function login(username: string, password: string): Promise<void> {
    const result = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(result.token);
    user.value = {
      userId: result.userId,
      username: result.username,
      displayName: result.displayName,
      role: result.role,
    };
  }

  async function restore(): Promise<void> {
    try {
      user.value = await api<SessionUser>('/auth/me');
    } catch {
      user.value = null;
      setToken(null);
    } finally {
      ready.value = true;
    }
  }

  async function logout(): Promise<void> {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setToken(null);
      user.value = null;
    }
  }

  return { user, ready, login, restore, logout };
});
