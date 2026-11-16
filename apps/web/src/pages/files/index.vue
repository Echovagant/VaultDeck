<template>
  <section>
    <el-page-header @back="goBack">
      <template #content>
        <span class="title">{{ projectName || '项目资料' }}</span>
      </template>
    </el-page-header>

    <div class="toolbar">
      <el-select v-model="folderId" placeholder="全部文件夹" clearable @change="loadFiles">
        <el-option
          v-for="folder in folders"
          :key="folder.folderId"
          :label="folder.folderName"
          :value="folder.folderId"
        />
      </el-select>
      <el-button @click="loadAll">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="files">
      <el-table-column prop="fileName" label="文件名" />
      <el-table-column label="大小" width="120">
        <template #default="scope">{{ formatBytes(scope.row.sizeBytes) }}</template>
      </el-table-column>
      <el-table-column prop="contentType" label="类型" width="180" />
      <el-table-column label="上传时间" width="190">
        <template #default="scope">
          {{ new Date(scope.row.createdAt).toLocaleString() }}
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  ApiError,
  api,
  formatBytes,
  type FileItem,
  type FolderItem,
  type ProjectSummary,
} from '@/api/client';

const route = useRoute();
const router = useRouter();
const projectId = String(route.params.projectId ?? '');

const projectName = ref('');
const folders = ref<FolderItem[]>([]);
const files = ref<FileItem[]>([]);
const folderId = ref<string>('');
const loading = ref(false);

async function loadProject(): Promise<void> {
  try {
    const result = await api<{ items: ProjectSummary[] }>('/projects');
    const found = result.items.find((item) => item.projectId === projectId);
    projectName.value = found?.projectName ?? '';
  } catch {
    projectName.value = '';
  }
}

async function loadFolders(): Promise<void> {
  const result = await api<{ items: FolderItem[] }>(
    `/folders?projectId=${encodeURIComponent(projectId)}`,
  );
  folders.value = result.items;
}

async function loadFiles(): Promise<void> {
  loading.value = true;
  try {
    const query = new URLSearchParams({ projectId });
    if (folderId.value) query.set('folderId', folderId.value);
    const result = await api<{ items: FileItem[] }>(`/files?${query.toString()}`);
    files.value = result.items;
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '加载文件失败');
  } finally {
    loading.value = false;
  }
}

async function loadAll(): Promise<void> {
  await loadFolders();
  await loadFiles();
}

function goBack(): void {
  void router.push('/projects');
}

onMounted(async () => {
  await loadProject();
  await loadAll();
});
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
}

.title {
  font-size: 16px;
  font-weight: 600;
}
</style>
