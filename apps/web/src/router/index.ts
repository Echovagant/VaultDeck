import { createRouter, createWebHistory } from 'vue-router';

import { useSessionStore } from '@/stores/session';

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
  },
  {
    path: '/categories',
    name: 'categories',
    component: () => import('@/pages/categories/index.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/pages/settings/index.vue'),
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
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/pages/admin/index.vue'),
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
  return true;
});
