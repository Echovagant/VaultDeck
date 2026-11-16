<template>
  <div class="login-page">
    <div class="login-panel vd-card">
      <div class="login-brand">
        <span class="login-mark">V</span>
        <span class="login-brand-text">VaultDeck</span>
      </div>

      <h1 class="login-title">登录资料系统</h1>
      <p class="login-sub">本地部署 · 局域网内使用</p>

      <a-form layout="vertical" :model="form" class="login-form" @finish="onSubmit">
        <a-form-item
          label="用户名"
          name="username"
          :rules="[{ required: true, message: '请输入用户名' }]"
        >
          <a-input v-model:value="form.username" size="large" autocomplete="username" />
        </a-form-item>

        <a-form-item
          label="口令"
          name="password"
          :rules="[{ required: true, message: '请输入口令' }]"
        >
          <a-input-password
            v-model:value="form.password"
            size="large"
            autocomplete="current-password"
          />
        </a-form-item>

        <a-button type="primary" html-type="submit" size="large" block :loading="loading">
          登录
        </a-button>
      </a-form>

      <div class="login-hint">
        <div class="login-hint-title">开发期演示账号</div>
        <div>领队：leader / leader123</div>
        <div>执行领队：deputy / deputy123</div>
        <div>队员：member / member123</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
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
    message.error(error instanceof ApiError ? error.message : '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background:
    radial-gradient(1200px 600px at 20% -10%, #e8f1fd 0%, transparent 55%),
    radial-gradient(900px 500px at 90% 110%, #f5f0ff 0%, transparent 50%), var(--vd-bg);
}

.login-panel {
  width: 400px;
  padding: 36px 36px 28px;
  border-radius: 20px;
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}

.login-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--vd-accent);
  color: #ffffff;
  font-weight: 700;
}

.login-brand-text {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.2px;
}

.login-title {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.4px;
}

.login-sub {
  margin: 6px 0 26px;
  color: var(--vd-text-secondary);
  font-size: 13px;
}

.login-form :deep(.ant-form-item-label > label) {
  color: var(--vd-text-secondary);
  font-size: 13px;
}

.login-hint {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--vd-border);
  color: var(--vd-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.login-hint-title {
  margin-bottom: 4px;
  color: var(--vd-text);
  font-weight: 600;
}
</style>
