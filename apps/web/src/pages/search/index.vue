<template>
  <section>
    <h1>搜索</h1>
    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="输入文件名关键词，至少 2 个字符"
        clearable
        @keyup.enter="search"
      />
      <el-button type="primary" :loading="loading" @click="search">搜索</el-button>
    </div>

    <el-table v-loading="loading" :data="items">
      <el-table-column prop="fileName" label="文件名" />
      <el-table-column prop="projectName" label="项目" width="180" />
      <el-table-column label="大小" width="110">
        <template #default="scope">{{ formatBytes(scope.row.sizeBytes) }}</template>
      </el-table-column>
      <el-table-column label="上传时间" width="180">
        <template #default="scope">{{ new Date(scope.row.createdAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="scope">
          <el-button link type="primary" @click="download(scope.row)">下载</el-button>
          <el-button link type="primary" @click="openProject(scope.row)">进入项目</el-button>
        </template>
      </el-table-column>
    </el-table>

    <p v-if="searched && items.length === 0" class="empty">没有匹配的文件</p>
    <p v-if="total > items.length" class="empty">
      共 {{ total }} 条，仅显示前 {{ items.length }} 条
    </p>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiError, api, formatBytes, getToken } from '@/api/client';

interface SearchItem {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  projectId: string;
  projectName: string;
  createdAt: string;
}

const route = useRoute();
const router = useRouter();

const keyword = ref(String(route.query.q ?? ''));
const items = ref<SearchItem[]>([]);
const total = ref(0);
const loading = ref(false);
const searched = ref(false);

async function search(): Promise<void> {
  const value = keyword.value.trim();
  if (value.length < 2) {
    ElMessage.warning('关键词至少 2 个字符');
    return;
  }

  loading.value = true;
  try {
    const result = await api<{ items: SearchItem[]; total: number }>(
      `/search?q=${encodeURIComponent(value)}&pageSize=100`,
    );
    items.value = result.items;
    total.value = result.total;
    searched.value = true;
    await router.replace({ path: '/search', query: { q: value } });
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '搜索失败');
  } finally {
    loading.value = false;
  }
}

async function download(item: SearchItem): Promise<void> {
  try {
    const token = getToken();
    const response = await fetch(`/api/v1/files/${item.fileId}/content`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error('下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下载失败');
  }
}

function openProject(item: SearchItem): void {
  void router.push(`/projects/${item.projectId}/files`);
}

onMounted(() => {
  if (keyword.value.trim().length >= 2) void search();
});
</script>

<style scoped>
h1 {
  margin: 0 0 12px;
  font-size: 20px;
}

.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.empty {
  margin-top: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
