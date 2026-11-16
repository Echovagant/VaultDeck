<template>
  <section>
    <h1 class="vd-page-title">系统设置</h1>
    <p class="vd-page-sub">修改后立即生效；回收站天数只影响之后删除的文件</p>

    <div class="vd-card settings-card">
      <a-form layout="vertical" :model="form">
        <a-form-item label="单文件上传上限（GB）">
          <a-input-number
            v-model:value="form.maxUploadGb"
            :min="0.1"
            :max="200"
            :step="0.5"
            style="width: 220px"
          />
        </a-form-item>
        <a-form-item label="分片大小（MB）">
          <a-input-number
            v-model:value="form.chunkSizeMb"
            :min="1"
            :max="64"
            :step="1"
            style="width: 220px"
          />
        </a-form-item>
        <a-form-item label="回收站保留天数">
          <a-input-number
            v-model:value="form.trashRetentionDays"
            :min="1"
            :max="365"
            style="width: 220px"
          />
        </a-form-item>
        <a-form-item label="启用秒传">
          <a-switch v-model:checked="form.instantUploadEnabled" />
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary" :loading="saving" @click="save">保存</a-button>
            <a-button @click="load">重置</a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { onMounted, reactive, ref } from 'vue';

import { ApiError, api } from '@/api/client';

interface SettingsResponse {
  maxUploadBytes: number;
  chunkSizeBytes: number;
  trashRetentionDays: number;
  instantUploadEnabled: boolean;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const loading = ref(false);
const saving = ref(false);
const form = reactive({
  maxUploadGb: 20,
  chunkSizeMb: 8,
  trashRetentionDays: 10,
  instantUploadEnabled: true,
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api<SettingsResponse>('/system/settings');
    form.maxUploadGb = Number((result.maxUploadBytes / GB).toFixed(1));
    form.chunkSizeMb = Math.round(result.chunkSizeBytes / MB);
    form.trashRetentionDays = result.trashRetentionDays;
    form.instantUploadEnabled = result.instantUploadEnabled;
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
.settings-card {
  max-width: 520px;
  padding: 24px;
  margin-top: 20px;
}
</style>
