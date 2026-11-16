<template>
  <el-container class="app-shell">
    <el-header v-if="session.user" class="app-header">
      <span class="app-title">VaultDeck</span>
      <el-menu
        mode="horizontal"
        :default-active="activePath"
        :ellipsis="false"
        router
        class="app-menu"
      >
        <el-menu-item index="/projects">项目</el-menu-item>
        <el-menu-item index="/admin">后台</el-menu-item>
      </el-menu>
      <div class="app-user">
        <span>{{ session.user.displayName }}（{{ roleLabel }}）</span>
        <el-button link type="primary" @click="onLogout">退出</el-button>
      </div>
    </el-header>
    <el-main>
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const activePath = computed(() => (route.path.startsWith('/admin') ? '/admin' : '/projects'));
const roleLabel = computed(() => {
  const labels: Record<string, string> = {
    LEADER: '领队',
    DEPUTY_LEADER: '执行领队',
    MEMBER: '队员',
  };
  return labels[session.user?.role ?? ''] ?? session.user?.role ?? '';
});

async function onLogout(): Promise<void> {
  await session.logout();
  await router.push('/login');
}
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid var(--el-border-color);
}

.app-title {
  font-size: 18px;
  font-weight: 600;
}

.app-menu {
  flex: 1;
  border-bottom: none;
}

.app-user {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
}
</style>
