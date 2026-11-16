<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <h2>VaultDeck</h2>
      <p class="hint">本地部署 · 团队资料管理</p>
      <el-form :model="form" label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" autocomplete="username" />
        </el-form-item>
        <el-form-item label="口令">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            autocomplete="current-password"
          />
        </el-form-item>
        <el-button type="primary" class="submit" :loading="loading" @click="onSubmit">
          登录
        </el-button>
      </el-form>
      <div class="dev-hint">
        <div>开发期演示账号</div>
        <div>领队：leader / leader123</div>
        <div>执行领队：deputy / deputy123</div>
        <div>队员：member / member123</div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { ApiError } from '@/api/client';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const router = useRouter();

const form = reactive({ username: 'leader', password: 'leader123' });
const loading = ref(false);

async function onSubmit(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    await session.login(form.username.trim(), form.password);
    await router.push('/projects');
  } catch (error) {
    const message = error instanceof ApiError ? error.message : '登录失败';
    ElMessage.error(message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
}

.login-card {
  width: 360px;
}

.hint {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
}

.submit {
  width: 100%;
}

.dev-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>
