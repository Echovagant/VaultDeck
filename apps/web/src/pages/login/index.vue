<template>
  <div class="login-page">
    <aside class="login-aside">
      <div class="aside-top">
        <span class="aside-mark">V</span>
        <span class="aside-wordmark">VaultDeck</span>
      </div>

      <div class="aside-body">
        <p class="aside-eyebrow">LOCAL ARCHIVE · EST. 2026</p>
        <h1 class="aside-title">
          把团队的<br />
          <em>每一份资料</em><br />
          收进同一个档案库
        </h1>
        <p class="aside-copy">
          本地部署，局域网内使用。分片上传、断点续传、内容寻址去重、版本留痕与回收站保护，
          都在这台主机上完成。
        </p>
      </div>

      <div class="aside-foot">
        <div class="aside-stat">
          <span class="aside-stat-value vd-mono">04</span>
          <span class="aside-stat-label">角色与权限</span>
        </div>
        <div class="aside-stat">
          <span class="aside-stat-value vd-mono">10d</span>
          <span class="aside-stat-label">回收站保留</span>
        </div>
        <div class="aside-stat">
          <span class="aside-stat-value vd-mono">∞</span>
          <span class="aside-stat-label">项目归档</span>
        </div>
      </div>
    </aside>

    <main class="login-main">
      <div class="login-form-wrap">
        <p class="vd-eyebrow">SIGN IN</p>
        <h2 class="login-title">登录资料系统</h2>
        <p class="login-sub">使用内部账号进入档案库</p>

        <a-form layout="vertical" :model="form" class="login-form" @finish="onSubmit">
          <a-form-item
            label="用户名"
            name="username"
            :rules="[{ required: true, message: '请输入用户名' }]"
          >
            <a-input
              v-model:value="form.username"
              size="large"
              autocomplete="username"
              placeholder="leader"
            />
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
              placeholder="••••••••"
            />
          </a-form-item>

          <a-button type="primary" html-type="submit" size="large" block :loading="loading">
            进入档案库
          </a-button>
        </a-form>

        <div class="login-hint">
          <div class="login-hint-title">开发期演示账号</div>
          <div class="login-hint-row"><span>领队</span><code>leader / leader123</code></div>
          <div class="login-hint-row"><span>执行领队</span><code>deputy / deputy123</code></div>
          <div class="login-hint-row"><span>队员</span><code>member / member123</code></div>
        </div>
      </div>

      <footer class="login-footer">
        <span class="vd-mono">VAULTDECK · LOCAL ARCHIVE</span>
        <span>技术支持：内部团队</span>
      </footer>
    </main>
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
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  min-height: 100vh;
  background: var(--vd-paper);
}

.login-aside {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 48px 56px;
  overflow: hidden;
  background:
    radial-gradient(760px 420px at 12% 8%, rgba(180, 72, 44, 0.28) 0%, transparent 62%),
    radial-gradient(640px 380px at 92% 96%, rgba(200, 146, 47, 0.16) 0%, transparent 58%),
    var(--vd-ink);
  color: var(--vd-text-inverse);
}

.login-aside::after {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(246, 241, 231, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(246, 241, 231, 0.05) 1px, transparent 1px);
  background-size: 44px 44px;
  content: '';
  mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%);
  pointer-events: none;
}

.aside-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 11px;
}

.aside-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--vd-accent);
  font-family: var(--vd-font-display);
  font-size: 20px;
  font-weight: 700;
}

.aside-wordmark {
  font-family: var(--vd-font-display);
  font-size: 17px;
  letter-spacing: 0.02em;
}

.aside-body {
  position: relative;
  z-index: 1;
  max-width: 520px;
}

.aside-eyebrow {
  margin: 0 0 20px;
  color: rgba(246, 241, 231, 0.5);
  font-family: var(--vd-font-mono);
  font-size: 11px;
  letter-spacing: 0.24em;
}

.aside-title {
  margin: 0;
  font-family: var(--vd-font-display);
  font-size: 42px;
  font-weight: 600;
  line-height: 1.32;
  letter-spacing: 0.01em;
}

.aside-title em {
  color: var(--vd-ochre);
  font-style: italic;
}

.aside-copy {
  max-width: 430px;
  margin: 22px 0 0;
  color: rgba(246, 241, 231, 0.62);
  font-size: 13px;
  line-height: 1.9;
}

.aside-foot {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 40px;
  padding-top: 22px;
  border-top: 1px solid rgba(246, 241, 231, 0.12);
}

.aside-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aside-stat-value {
  color: var(--vd-text-inverse);
  font-size: 20px;
  font-weight: 500;
}

.aside-stat-label {
  color: rgba(246, 241, 231, 0.44);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.login-main {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px 72px;
}

.login-form-wrap {
  width: 100%;
  max-width: 380px;
  margin: 0 auto;
}

.login-title {
  margin: 10px 0 0;
  font-family: var(--vd-font-display);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.login-sub {
  margin: 8px 0 30px;
  color: var(--vd-text-secondary);
  font-size: 13px;
}

.login-form :deep(.ant-form-item-label > label) {
  color: var(--vd-text-secondary);
  font-family: var(--vd-font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.login-hint {
  margin-top: 30px;
  padding-top: 18px;
  border-top: 1px solid var(--vd-border);
  color: var(--vd-text-secondary);
  font-size: 12px;
}

.login-hint-title {
  margin-bottom: 8px;
  color: var(--vd-text);
  font-family: var(--vd-font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.login-hint-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
}

.login-hint-row code {
  color: var(--vd-accent-deep);
  font-family: var(--vd-font-mono);
  font-size: 11px;
}

.login-footer {
  display: flex;
  justify-content: space-between;
  max-width: 380px;
  width: 100%;
  margin: 40px auto 0;
  color: var(--vd-text-secondary);
  font-size: 10px;
  letter-spacing: 0.08em;
}

@media (max-width: 980px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-aside {
    padding: 28px 24px 32px;
    gap: 24px;
  }

  .aside-title {
    font-size: 28px;
  }

  .aside-copy,
  .aside-foot {
    display: none;
  }

  .login-main {
    padding: 32px 24px 40px;
  }
}
</style>
