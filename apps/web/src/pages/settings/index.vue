<template>
  <section>
    <h1>系统设置</h1>
    <p class="hint">修改后立即生效；回收站天数只影响之后删除的文件。</p>

    <el-form v-loading="loading" :model="form" label-width="160px" class="settings-form">
      <el-form-item label="单文件上传上限">
        <el-input-number v-model="form.maxUploadGb" :min="0.1" :max="200" :step="0.5" />
        <span class="unit">GB</span>
      </el-form-item>
      <el-form-item label="分片大小">
        <el-input-number v-model="form.chunkSizeMb" :min="1" :max="64" :step="1" />
        <span class="unit">MB</span>
      </el-form-item>
      <el-form-item label="回收站保留天数">
        <el-input-number v-model="form.trashRetentionDays" :min="1" :max="365" />
        <span class="unit">天</span>
      </el-form-item>
      <el-form-item label="启用秒传">
        <el-switch v-model="form.instantUploadEnabled" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        <el-button @click="load">重置</el-button>
      </el-form-item>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
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
    ElMessage.error(error instanceof ApiError ? error.message : '加载设置失败');
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
    ElMessage.success('设置已保存');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.hint {
  margin: 0 0 20px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.settings-form {
  max-width: 520px;
}

.unit {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}
</style>
