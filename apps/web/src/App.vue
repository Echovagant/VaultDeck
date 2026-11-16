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
        <el-menu-item v-if="session.user.role !== 'MEMBER'" index="/stats">统计</el-menu-item>
        <el-menu-item index="/trash">回收站</el-menu-item>
        <el-menu-item v-if="session.user.role !== 'MEMBER'" index="/audit">操作日志</el-menu-item>
        <el-menu-item index="/admin">后台</el-menu-item>
      </el-menu>
      <el-input
        v-model="searchKeyword"
        class="search-box"
        placeholder="搜索文件名"
        clearable
        @keyup.enter="onSearch"
      />
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
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const activePath = computed(() => {
  if (route.path.startsWith('/admin')) return '/admin';
  if (route.path.startsWith('/stats')) return '/stats';
  if (route.path.startsWith('/trash')) return '/trash';
  if (route.path.startsWith('/audit')) return '/audit';
  if (route.path.startsWith('/search')) return '/search';
  return '/projects';
});

const searchKeyword = ref('');

function onSearch(): void {
  const value = searchKeyword.value.trim();
  if (value.length >= 2) {
    void router.push({ path: '/search', query: { q: value } });
  }
}
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
