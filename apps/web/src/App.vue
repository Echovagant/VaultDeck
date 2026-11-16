<template>
  <a-config-provider :theme="theme">
    <a-layout class="vd-shell">
      <a-layout-sider v-if="session.user" :width="224" theme="light" class="vd-sider">
        <div class="vd-brand">
          <span class="vd-brand-mark">V</span>
          <span class="vd-brand-text">VaultDeck</span>
        </div>

        <a-menu mode="inline" :selected-keys="[activePath]" class="vd-menu" @click="onMenuClick">
          <a-menu-item key="/projects">
            <template #icon><ProjectOutlined /></template>
            项目
          </a-menu-item>
          <a-menu-item v-if="isLeaderOrDeputy" key="/stats">
            <template #icon><BarChartOutlined /></template>
            统计
          </a-menu-item>
          <a-menu-item v-if="isLeader" key="/categories">
            <template #icon><TagsOutlined /></template>
            分类
          </a-menu-item>
          <a-menu-item key="/trash">
            <template #icon><DeleteOutlined /></template>
            回收站
          </a-menu-item>
          <a-menu-item v-if="isLeaderOrDeputy" key="/audit">
            <template #icon><HistoryOutlined /></template>
            操作日志
          </a-menu-item>
          <a-menu-item v-if="isLeader" key="/settings">
            <template #icon><SettingOutlined /></template>
            设置
          </a-menu-item>
          <a-menu-item key="/admin">
            <template #icon><TeamOutlined /></template>
            后台
          </a-menu-item>
        </a-menu>

        <div class="vd-sider-footer">
          <div class="vd-avatar">{{ initials }}</div>
          <div class="vd-user-meta">
            <div class="vd-user-name">{{ session.user.displayName }}</div>
            <div class="vd-user-role">{{ roleLabel }}</div>
          </div>
        </div>
      </a-layout-sider>

      <a-layout>
        <a-layout-header v-if="session.user" class="vd-header">
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索文件名"
            class="vd-search"
            @search="onSearch"
          />
          <div class="vd-header-right">
            <span class="vd-clock">{{ clock }}</span>
            <span class="vd-header-user">{{ session.user.displayName }}（{{ roleLabel }}）</span>
            <a-button type="text" @click="onLogout">退出登录</a-button>
          </div>
        </a-layout-header>

        <a-layout-content :class="session.user ? 'vd-content' : 'vd-content-full'">
          <router-view />
        </a-layout-content>

        <a-layout-footer v-if="session.user" class="vd-footer">
          <span>Copyright © VaultDeck</span>
          <span>技术支持：内部团队</span>
        </a-layout-footer>
      </a-layout>
    </a-layout>
  </a-config-provider>
</template>

<script setup lang="ts">
import {
  BarChartOutlined,
  DeleteOutlined,
  HistoryOutlined,
  ProjectOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const theme = {
  token: {
    colorPrimary: '#0071e3',
    colorInfo: '#0071e3',
    colorBgLayout: '#f5f5f7',
    colorBgContainer: '#ffffff',
    colorText: '#1d1d1f',
    colorTextSecondary: '#6e6e73',
    colorBorder: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 10,
    controlHeight: 36,
    fontFamily:
      '-apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Menu: {
      itemSelectedBg: '#e8f1fd',
      itemSelectedColor: '#0071e3',
      itemHeight: 42,
    },
    Table: {
      headerBg: '#fafafa',
      rowHoverBg: '#f5f9ff',
      cellPaddingBlock: 9,
      cellPaddingInline: 12,
    },
    Layout: {
      siderBg: '#ffffff',
      headerBg: '#ffffff',
    },
  },
};

const isLeader = computed(() => session.user?.role === 'LEADER');
const isLeaderOrDeputy = computed(() => session.user?.role !== 'MEMBER');

const activePath = computed(() => {
  if (route.path.startsWith('/admin')) return '/admin';
  if (route.path.startsWith('/settings')) return '/settings';
  if (route.path.startsWith('/stats')) return '/stats';
  if (route.path.startsWith('/categories')) return '/categories';
  if (route.path.startsWith('/trash')) return '/trash';
  if (route.path.startsWith('/audit')) return '/audit';
  return '/projects';
});

const roleLabel = computed(() => {
  const labels: Record<string, string> = {
    LEADER: '领队',
    DEPUTY_LEADER: '执行领队',
    MEMBER: '队员',
  };
  return labels[session.user?.role ?? ''] ?? session.user?.role ?? '';
});

const initials = computed(() => session.user?.displayName?.slice(0, 1) ?? 'U');
const searchKeyword = ref('');
const clock = ref('');
let clockTimer: ReturnType<typeof setInterval> | null = null;

function tickClock(): void {
  clock.value = new Date().toLocaleString();
}

onMounted(() => {
  tickClock();
  clockTimer = setInterval(tickClock, 1000);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});

function onMenuClick({ key }: { key: string }): void {
  void router.push(key);
}

function onSearch(): void {
  const keyword = searchKeyword.value.trim();
  if (keyword.length >= 2) {
    void router.push({ path: '/search', query: { q: keyword } });
  }
}

async function onLogout(): Promise<void> {
  await session.logout();
  await router.push('/login');
}
</script>

<style scoped>
.vd-shell {
  min-height: 100vh;
}

.vd-sider {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--vd-border);
}

.vd-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 22px 16px;
}

.vd-brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--vd-accent);
  color: #ffffff;
  font-weight: 700;
}

.vd-brand-text {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.2px;
}

.vd-menu {
  flex: 1;
  border-inline-end: none !important;
  padding: 4px 10px;
}

.vd-sider-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 22px;
  border-top: 1px solid var(--vd-border);
}

.vd-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--vd-accent-soft);
  color: var(--vd-accent);
  font-weight: 600;
}

.vd-user-name {
  font-size: 13px;
  font-weight: 600;
}

.vd-user-role {
  font-size: 12px;
  color: var(--vd-text-secondary);
}

.vd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  padding: 0 28px;
  border-bottom: 1px solid var(--vd-border);
}

.vd-search {
  max-width: 320px;
}

.vd-content {
  padding: 28px 32px 40px;
}

.vd-content-full {
  padding: 0;
}

.vd-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.vd-clock {
  color: var(--vd-text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.vd-header-user {
  color: var(--vd-text-secondary);
  font-size: 13px;
}

.vd-footer {
  display: flex;
  justify-content: space-between;
  padding: 12px 32px;
  background: transparent;
  color: var(--vd-text-secondary);
  font-size: 12px;
}
</style>
