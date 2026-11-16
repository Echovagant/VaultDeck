<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">06 / SETTINGS</p>
        <h1 class="vd-page-title">系统设置</h1>
        <p class="vd-page-sub">上传、回收站与运行状态；修改后立即生效</p>
      </div>
    </header>

    <div class="settings-grid">
      <div class="settings-panel">
        <h2 class="settings-title">上传与存储</h2>
        <a-form layout="vertical" :model="form">
          <a-form-item label="单文件上传上限（GB）">
            <a-input-number
              v-model:value="form.maxUploadGb"
              :min="0.1"
              :max="200"
              :step="0.5"
              style="width: 100%"
            />
            <p class="settings-hint">超过上限的文件会在预检阶段被拒绝。</p>
          </a-form-item>
          <a-form-item label="分片大小（MB）">
            <a-input-number
              v-model:value="form.chunkSizeMb"
              :min="1"
              :max="64"
              :step="1"
              style="width: 100%"
            />
            <p class="settings-hint">只影响之后新建的上传会话。</p>
          </a-form-item>
          <a-form-item label="启用秒传">
            <a-switch v-model:checked="form.instantUploadEnabled" />
            <p class="settings-hint">关闭后同哈希文件也会重新上传，不再命中已有内容。</p>
          </a-form-item>
        </a-form>
      </div>

      <div class="settings-panel">
        <h2 class="settings-title">回收站</h2>
        <a-form layout="vertical" :model="form">
          <a-form-item label="保留天数">
            <a-input-number
              v-model:value="form.trashRetentionDays"
              :min="1"
              :max="365"
              style="width: 100%"
            />
          </a-form-item>
        </a-form>

        <ul class="settings-notes">
          <li>天数只影响之后删除的文件，已删除文件的到期时间不会回溯调整。</li>
          <li>到期后由系统清除对象与记录，清除后不可恢复。</li>
          <li>回收站内文件仍占用容量，不计入项目目录统计。</li>
        </ul>
      </div>

      <div class="settings-panel">
        <h2 class="settings-title">系统状态</h2>
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">服务状态</span>
            <span class="status-value status-ok">{{ health ? '运行中' : '读取中' }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">持续运行</span>
            <span class="status-value">{{ uptimeText }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">活跃会话</span>
            <span class="status-value">{{ health?.activeSessions ?? '—' }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">存储卷剩余</span>
            <span class="status-value">{{ freeSpaceText }}</span>
          </div>
        </div>
        <p class="settings-hint">状态为只读，刷新页面重新采集；会话数包含所有已登录设备。</p>
      </div>
    </div>

    <div class="settings-actions">
      <a-button type="primary" :loading="saving" @click="save">保存设置</a-button>
      <a-button :loading="loading" @click="load">放弃修改</a-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, onMounted, reactive, ref } from 'vue';

import { ApiError, api, formatBytes } from '@/api/client';

interface SettingsResponse {
  maxUploadBytes: number;
  chunkSizeBytes: number;
  trashRetentionDays: number;
  instantUploadEnabled: boolean;
}

interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  storageVolumeFreeBytes?: number;
  activeSessions?: number;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const loading = ref(false);
const saving = ref(false);
const health = ref<HealthResponse | null>(null);
const form = reactive({
  maxUploadGb: 20,
  chunkSizeMb: 8,
  trashRetentionDays: 10,
  instantUploadEnabled: true,
});

const uptimeText = computed(() => formatDuration(health.value?.uptimeSeconds ?? 0));
const freeSpaceText = computed(() =>
  health.value?.storageVolumeFreeBytes === undefined
    ? '—'
    : formatBytes(health.value.storageVolumeFreeBytes),
);

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [settings, status] = await Promise.all([
      api<SettingsResponse>('/system/settings'),
      api<HealthResponse>('/system/health'),
    ]);
    form.maxUploadGb = Number((settings.maxUploadBytes / GB).toFixed(1));
    form.chunkSizeMb = Math.round(settings.chunkSizeBytes / MB);
    form.trashRetentionDays = settings.trashRetentionDays;
    form.instantUploadEnabled = settings.instantUploadEnabled;
    health.value = status;
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载设置失败');
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    await api('/system/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        maxUploadBytes: Math.round(form.maxUploadGb * GB),
        chunkSizeBytes: Math.round(form.chunkSizeMb * MB),
        trashRetentionDays: form.trashRetentionDays,
        instantUploadEnabled: form.instantUploadEnabled,
      }),
    });
    message.success('设置已保存');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 14px;
  align-items: stretch;
}

.settings-panel {
  padding: 16px 18px 18px;
  background: var(--vd-surface);
  border: 1px solid var(--vd-border);
  border-radius: var(--vd-radius);
}

.settings-title {
  margin: 0 0 12px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--vd-border);
  font-family: var(--vd-font-display);
  font-size: 15px;
  font-weight: 600;
}

.settings-hint {
  margin: 6px 0 0;
  color: var(--vd-text-secondary);
  font-size: 11px;
  line-height: 1.7;
}

.settings-notes {
  margin: 4px 0 0;
  padding-left: 16px;
  color: var(--vd-text-secondary);
  font-size: 12px;
  line-height: 1.9;
}

.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 12px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.status-label {
  color: var(--vd-text-secondary);
  font-family: var(--vd-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.status-value {
  font-family: var(--vd-font-mono);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.status-ok {
  color: #4f7a52;
}

.settings-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

@media (max-width: 760px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
