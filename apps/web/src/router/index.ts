import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/home/index.vue'),
  },
  {
    path: '/projects',
    name: 'projects',
    component: () => import('@/pages/projects/index.vue'),
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
