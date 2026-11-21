import { message } from 'ant-design-vue';
import { createRouter, createWebHistory } from 'vue-router';

import { useSessionStore } from '@/stores/session';

type Role = 'LEADER' | 'DEPUTY_LEADER' | 'MEMBER';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/login/index.vue'),
  },
  {
    path: '/',
    redirect: '/projects',
  },
  {
    path: '/projects',
    name: 'projects',
    component: () => import('@/pages/projects/index.vue'),
  },
  {
    path: '/projects/:projectId/files',
    name: 'files',
    component: () => import('@/pages/files/index.vue'),
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/pages/search/index.vue'),
  },
  {
    path: '/stats',
    name: 'stats',
    component: () => import('@/pages/stats/index.vue'),
    meta: { roles: ['LEADER', 'DEPUTY_LEADER'] satisfies Role[] },
  },
  {
    path: '/categories',
    name: 'categories',
    component: () => import('@/pages/categories/index.vue'),
    meta: { roles: ['LEADER'] satisfies Role[] },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/pages/settings/index.vue'),
    meta: { roles: ['LEADER'] satisfies Role[] },
  },
  {
    path: '/trash',
    name: 'trash',
    component: () => import('@/pages/trash/index.vue'),
  },
  {
    path: '/audit',
    name: 'audit',
    component: () => import('@/pages/audit/index.vue'),
    meta: { roles: ['LEADER', 'DEPUTY_LEADER'] satisfies Role[] },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/pages/admin/index.vue'),
    // 全角色可进：账号管理面板仅领队可见，Agent 接入各角色按权限差异化
    meta: { roles: ['LEADER', 'DEPUTY_LEADER', 'MEMBER'] satisfies Role[] },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.ready) await session.restore();

  if (to.path !== '/login' && !session.user) {
    return { path: '/login' };
  }
  if (to.path === '/login' && session.user) {
    return { path: '/projects' };
  }

  const roles = to.meta['roles'] as Role[] | undefined;
  if (roles && session.user && !roles.includes(session.user.role as Role)) {
    message.warning('当前账号无权访问该页面');
    return { path: '/projects' };
  }

  return true;
});
