<template>
  <a-config-provider :theme="theme">
    <a-layout class="vd-shell">
      <a-layout-sider
        v-if="session.user"
        v-model:collapsed="collapsed"
        :width="216"
        :collapsed-width="60"
        collapsible
        :trigger="null"
        :theme="isDark ? 'dark' : 'light'"
        class="vd-sider"
      >
        <div class="vd-brand">
          <span class="vd-brand-mark">V</span>
          <div v-if="!collapsed" class="vd-brand-text">
            <strong>VaultDeck</strong>
            <em>ARCHIVE DESK</em>
          </div>
        </div>

        <nav class="vd-nav-wrap">
          <a-menu
            mode="inline"
            :theme="isDark ? 'dark' : 'light'"
            :inline-collapsed="collapsed"
            :selected-keys="[activePath]"
            class="vd-menu"
            @click="onMenuClick"
          >
            <a-menu-item key="/projects">
              <template #icon><ProjectOutlined /></template>
              <span class="vd-nav-item"><span class="vd-nav-index">01</span>项目</span>
            </a-menu-item>
            <a-menu-item v-if="isLeaderOrDeputy" key="/stats">
              <template #icon><BarChartOutlined /></template>
              <span class="vd-nav-item"><span class="vd-nav-index">02</span>统计</span>
            </a-menu-item>
            <a-menu-item v-if="isLeader" key="/categories">
              <template #icon><TagsOutlined /></template>
              <span class="vd-nav-item"><span class="vd-nav-index">03</span>分类</span>
            </a-menu-item>
            <a-menu-item key="/trash">
              <template #icon><DeleteOutlined /></template>
              <span class="vd-nav-item"><span class="vd-nav-index">04</span>回收站</span>
            </a-menu-item>
            <a-menu-item v-if="isLeaderOrDeputy" key="/audit">
              <template #icon><HistoryOutlined /></template>
              <span class="vd-nav-item"><span class="vd-nav-index">05</span>操作日志</span>
            </a-menu-item>
            <a-menu-item v-if="isLeader" key="/settings">
              <template #icon><SettingOutlined /></template>
              <span class="vd-nav-item"><span class="vd-nav-index">06</span>设置</span>
            </a-menu-item>
            <a-menu-item v-if="isLeader" key="/admin">
              <template #icon><TeamOutlined /></template>
              <span class="vd-nav-item"><span class="vd-nav-index">07</span>后台</span>
            </a-menu-item>
          </a-menu>
        </nav>

        <div v-if="!collapsed" class="vd-sider-watermark" aria-hidden="true">
          <span>VD</span>
          <em>ARCHIVE · NO.2026</em>
        </div>

        <div class="vd-sider-footer">
          <a-dropdown placement="topLeft" :trigger="['click']">
            <div class="vd-user-trigger">
              <a-avatar :size="32" :src="session.avatarBlobUrl || undefined" class="vd-avatar">
                {{ initials }}
              </a-avatar>
              <div v-if="!collapsed" class="vd-user-meta">
                <div class="vd-user-name">{{ session.user.displayName }}</div>
                <div class="vd-user-role">{{ roleLabel }}</div>
              </div>
            </div>
            <template #overlay>
              <a-menu class="vd-user-menu" @click="onUserMenu">
                <a-menu-item key="profile">个人资料</a-menu-item>
                <a-menu-item key="logout">退出登录</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-button type="text" class="collapse-btn" @click="toggleCollapsed">
            <MenuFoldOutlined v-if="!collapsed" />
            <MenuUnfoldOutlined v-else />
          </a-button>
        </div>
      </a-layout-sider>

      <a-layout class="vd-main">
        <a-layout-header v-if="session.user" class="vd-header">
          <div class="vd-header-left">
            <a-input-search
              v-model:value="searchKeyword"
              placeholder="检索文件名，回车搜索"
              class="vd-search"
              allow-clear
              @search="onSearch"
            />
          </div>
          <div class="vd-header-right">
            <span class="vd-clock vd-mono">{{ clock }}</span>
            <a-tooltip :title="isDark ? '切换到浅色主题' : '切换到深色主题'">
              <a-button type="text" class="theme-btn" @click="toggleTheme">
                <BulbOutlined />
                <span class="theme-btn-label">{{ isDark ? '深色' : '浅色' }}</span>
              </a-button>
            </a-tooltip>
            <span class="vd-header-divider" />
            <a-dropdown placement="bottomRight" :trigger="['click']">
              <button type="button" class="vd-avatar-btn">
                <a-avatar :size="28" :src="session.avatarBlobUrl || undefined" class="vd-avatar">
                  {{ initials }}
                </a-avatar>
                <span class="vd-avatar-name">{{ session.user.displayName }}</span>
              </button>
              <template #overlay>
                <a-menu class="vd-user-menu" @click="onUserMenu">
                  <a-menu-item key="profile">个人资料</a-menu-item>
                  <a-menu-item key="logout">退出登录</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </a-layout-header>

        <a-layout-content :class="session.user ? 'vd-content' : 'vd-content-full'">
          <router-view :key="route.fullPath" />
        </a-layout-content>

        <a-layout-footer v-if="session.user" class="vd-footer">
          <span class="vd-mono">VAULTDECK · LOCAL ARCHIVE</span>
          <span>技术支持：内部团队</span>
        </a-layout-footer>
      </a-layout>

      <ProfileDialog v-model="profileVisible" />
    </a-layout>
  </a-config-provider>
</template>

<script setup lang="ts">
import {
  BarChartOutlined,
  BulbOutlined,
  DeleteOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProjectOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue';
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ProfileDialog from '@/features/profile/ProfileDialog.vue';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

type ThemeMode = 'dark' | 'light';

const stored = localStorage.getItem('vd_theme');
const themeMode = ref<ThemeMode>(stored === 'light' ? 'light' : 'dark');
const isDark = computed(() => themeMode.value === 'dark');

watchEffect(() => {
  document.documentElement.dataset.theme = themeMode.value;
  localStorage.setItem('vd_theme', themeMode.value);
});

function toggleTheme(): void {
  themeMode.value = isDark.value ? 'light' : 'dark';
}

function buildTheme(mode: ThemeMode) {
  const light = mode === 'light';
  return {
    token: {
      colorPrimary: '#b4482c',
      colorInfo: '#b4482c',
      colorLink: '#b4482c',
      colorLinkHover: '#8f3620',
      colorSuccess: '#4f7a52',
      colorWarning: '#c8922f',
      colorError: '#b3261e',
      colorBgLayout: light ? '#fbf7ef' : '#f4efe6',
      colorBgContainer: light ? '#fffdf9' : '#fffcf6',
      colorBgElevated: light ? '#fffdf9' : '#fffcf6',
      colorBgSpotlight: '#2b2520',
      colorText: '#241f1a',
      colorTextSecondary: '#7a6e60',
      colorTextTertiary: '#9c8f7e',
      colorTextQuaternary: '#bdb0a0',
      colorBorder: light ? '#e6dccb' : '#e2d8c8',
      colorBorderSecondary: light ? '#f0e7d8' : '#ebe2d4',
      colorFillSecondary: light ? '#f5eddf' : '#f0e8da',
      colorFillTertiary: light ? '#f8f1e6' : '#f4ecdf',
      colorFillQuaternary: light ? '#fbf6ec' : '#f8f3e9',
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 4,
      controlHeight: 36,
      fontFamily:
        '-apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: 13,
    },
    components: {
      Layout: {
        siderBg: light ? '#efe6d6' : '#1e1a16',
        headerBg: light ? '#fbf7ef' : '#f4efe6',
        bodyBg: light ? '#fbf7ef' : '#f4efe6',
        footerBg: 'transparent',
      },
      Menu: light
        ? {
            itemBg: 'transparent',
            itemColor: 'rgba(36, 31, 26, 0.66)',
            itemHoverBg: 'rgba(180, 72, 44, 0.1)',
            itemHoverColor: '#241f1a',
            itemSelectedBg: '#b4482c',
            itemSelectedColor: '#fffaf2',
            itemHeight: 38,
            itemMarginInline: 6,
            itemBorderRadius: 6,
            iconSize: 16,
            collapsedIconSize: 18,
          }
        : {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemColor: 'rgba(246, 241, 231, 0.7)',
            darkItemHoverBg: 'rgba(180, 72, 44, 0.22)',
            darkItemHoverColor: '#fffaf2',
            darkItemSelectedBg: '#b4482c',
            darkItemSelectedColor: '#fffaf2',
            itemHeight: 38,
            itemMarginInline: 6,
            itemBorderRadius: 6,
            iconSize: 16,
            collapsedIconSize: 18,
          },
      Table: {
        headerBg: light ? '#f3ebdd' : '#efe7d8',
        headerColor: '#7a6e60',
        headerSplitColor: 'transparent',
        rowHoverBg: light ? '#fbf6ec' : '#fbf6ec',
        borderColor: light ? '#f0e7d8' : '#ebe2d4',
        cellPaddingBlock: 9,
        cellPaddingInline: 12,
      },
      Tabs: {
        itemColor: '#7a6e60',
        itemSelectedColor: '#241f1a',
        itemHoverColor: '#b4482c',
        inkBarColor: '#b4482c',
        titleFontSize: 13,
      },
      Tree: {
        nodeSelectedBg: '#f6ecd7',
        nodeHoverBg: 'rgba(180, 72, 44, 0.08)',
        titleHeight: 28,
      },
      Segmented: {
        trackBg: light ? '#f3ebdd' : '#efe7d8',
        itemSelectedBg: light ? '#fffdf9' : '#fffcf6',
        itemSelectedColor: '#241f1a',
      },
      Pagination: {
        itemActiveBg: '#f6ecd7',
      },
      Button: {
        fontWeight: 500,
        defaultShadow: '0 1px 0 rgba(58, 43, 28, 0.04)',
        primaryShadow: '0 1px 0 rgba(58, 43, 28, 0.08)',
      },
      Modal: {
        contentBg: light ? '#fffdf9' : '#fffcf6',
        headerBg: light ? '#fffdf9' : '#fffcf6',
        titleColor: '#241f1a',
      },
      Dropdown: {
        controlItemBgHover: '#f6ecd7',
      },
      Select: {
        optionSelectedBg: '#f6ecd7',
      },
      Input: {
        activeBorderColor: '#b4482c',
        hoverBorderColor: '#c8922f',
        activeShadow: '0 0 0 2px rgba(180, 72, 44, 0.12)',
      },
      Divider: {
        colorSplit: '#e2d8c8',
      },
    },
  };
}

const theme = computed(() => buildTheme(themeMode.value));

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
  const now = new Date();
  clock.value = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

onMounted(() => {
  tickClock();
  clockTimer = setInterval(tickClock, 30000);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});

const collapsed = ref(localStorage.getItem('vd_sider_collapsed') === '1');
const profileVisible = ref(false);

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value;
  localStorage.setItem('vd_sider_collapsed', collapsed.value ? '1' : '0');
}

function onUserMenu({ key }: { key: string }): void {
  if (key === 'profile') {
    profileVisible.value = true;
    return;
  }
  if (key === 'logout') void onLogout();
}

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

.vd-sider,
.vd-sider.ant-layout-sider-light {
  position: relative;
  background: var(--vd-sider-bg) !important;
  border-right: 1px solid var(--vd-sider-rule);
  overflow: hidden;
}

.vd-sider :deep(.ant-layout-sider-children) {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

.vd-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 58px;
  padding: 0 14px;
  border-bottom: 1px solid var(--vd-sider-rule);
  position: relative;
  z-index: 1;
}

.vd-brand-mark {
  display: flex;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 5px;
  background: var(--vd-accent);
  color: #fffaf2;
  font-family: var(--vd-font-display);
  font-size: 18px;
  font-weight: 700;
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.18);
}

.vd-brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.vd-brand-text strong {
  color: var(--vd-sider-strong);
  font-family: var(--vd-font-display);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.vd-brand-text em {
  margin-top: 3px;
  color: var(--vd-sider-text-dim);
  font-family: var(--vd-font-mono);
  font-size: 8px;
  font-style: normal;
  letter-spacing: 0.2em;
}

.vd-nav-wrap {
  position: relative;
  z-index: 1;
  flex: 1;
  padding-top: 4px;
  overflow-y: auto;
}

.vd-menu {
  border-inline-end: none !important;
  background: transparent;
}

/* 悬停与选中统一走砖红系，避免 antd 默认的白色/浅灰雾层 */
.vd-sider :deep(.ant-menu-item) {
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.vd-sider :deep(.ant-menu-item:hover) {
  background: var(--vd-sider-hover) !important;
  color: var(--vd-sider-hover-text) !important;
}

.vd-sider :deep(.ant-menu-item:hover .vd-nav-index),
.vd-sider :deep(.ant-menu-item-selected .vd-nav-index) {
  color: rgba(255, 250, 242, 0.55) !important;
}

.vd-sider :deep(.ant-menu-item-selected) {
  background: var(--vd-accent) !important;
  color: #fffaf2 !important;
}

.vd-sider :deep(.ant-menu-item::after) {
  display: none !important;
}

.vd-nav-item {
  display: inline-flex;
  align-items: baseline;
  gap: 9px;
  font-size: 13px;
  letter-spacing: 0.02em;
}

.vd-nav-index {
  color: var(--vd-sider-text-dim);
  font-family: var(--vd-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.vd-sider-watermark {
  position: absolute;
  right: 12px;
  bottom: 52px;
  left: 12px;
  z-index: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  color: var(--vd-sider-watermark);
  pointer-events: none;
  user-select: none;
}

.vd-sider-watermark span {
  font-family: var(--vd-font-display);
  font-size: 62px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 0.85;
}

.vd-sider-watermark em {
  font-family: var(--vd-font-mono);
  font-size: 8px;
  font-style: normal;
  letter-spacing: 0.22em;
}

.vd-sider-footer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 11px;
  border-top: 1px solid var(--vd-sider-rule);
  background: var(--vd-sider-bg);
}

.vd-user-trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  cursor: pointer;
}

.vd-avatar {
  background: var(--vd-ochre);
  color: #2b2520;
  font-weight: 600;
}

.vd-user-meta {
  min-width: 0;
}

.vd-user-name {
  overflow: hidden;
  color: var(--vd-sider-strong);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vd-user-role {
  color: var(--vd-sider-text-dim);
  font-family: var(--vd-font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
}

.collapse-btn {
  margin-left: auto;
  color: var(--vd-sider-text);
}

.collapse-btn:hover {
  color: var(--vd-sider-hover-text) !important;
  background: var(--vd-sider-hover) !important;
}

.vd-main {
  min-width: 0;
}

.vd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 62px;
  padding: 0 26px;
  border-bottom: 1px solid var(--vd-border);
  background: var(--vd-paper);
}

.vd-header-left {
  flex: 1;
  max-width: 360px;
}

.vd-search {
  width: 100%;
}

.vd-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.vd-header-divider {
  width: 1px;
  height: 18px;
  background: var(--vd-border);
}

.vd-clock {
  color: var(--vd-text-secondary);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  color: var(--vd-text-secondary);
  font-size: 11px;
}

.theme-btn:hover {
  color: var(--vd-accent) !important;
  background: var(--vd-accent-soft) !important;
}

.theme-btn-label {
  font-family: var(--vd-font-mono);
  letter-spacing: 0.06em;
}

.vd-avatar-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 7px 3px 3px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  transition: border-color 0.18s ease;
}

.vd-avatar-btn:hover {
  border-color: var(--vd-border-strong);
}

.vd-avatar-name {
  color: var(--vd-text);
  font-size: 12px;
  font-weight: 500;
}

/* 账本横线：极淡的纸纹，只在留白处可见 */
.vd-content {
  padding: 20px 26px 36px;
  background-image: repeating-linear-gradient(
    180deg,
    transparent 0 31px,
    var(--vd-paper-line) 31px 32px
  );
  background-attachment: local;
}

.vd-content-full {
  padding: 0;
  background-image: none;
}

.vd-footer {
  display: flex;
  justify-content: space-between;
  padding: 10px 26px;
  border-top: 1px solid var(--vd-border);
  color: var(--vd-text-secondary);
  font-size: 10px;
  letter-spacing: 0.04em;
}

@media (max-width: 900px) {
  .vd-header {
    padding: 0 16px;
  }

  .vd-content {
    padding: 16px 16px 28px;
  }

  .vd-avatar-name,
  .theme-btn-label {
    display: none;
  }
}
</style>
