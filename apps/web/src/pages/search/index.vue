<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">QUERY / FILES</p>
        <h1 class="vd-page-title">搜索</h1>
        <p class="vd-page-sub">按文件名检索你有权查看的资料</p>
      </div>
    </header>

    <div class="vd-toolbar">
      <a-input-search
        v-model:value="keyword"
        placeholder="输入文件名关键词，至少 2 个字符"
        enter-button="搜索"
        :loading="loading"
        style="max-width: 420px"
        @search="search"
      />
    </div>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="fileId"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'sizeBytes'">{{ formatBytes(record.sizeBytes) }}</template>
        <template v-else-if="column.key === 'createdAt'">
          {{ new Date(record.createdAt).toLocaleString() }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-button
            type="link"
            :disabled="record.hasContent === false"
            @click="openPreview(record)"
          >
            预览
          </a-button>
          <a-button type="link" :disabled="record.hasContent === false" @click="download(record)">
            下载
          </a-button>
          <a-button type="link" @click="openProject(record)">进入项目</a-button>
        </template>
      </template>
    </a-table>

    <a-empty v-if="searched && items.length === 0" description="没有匹配的文件" />
    <p v-if="total > items.length" class="hint">
      共 {{ total }} 条，仅显示前 {{ items.length }} 条
    </p>

    <FilePreviewDialog v-model="previewVisible" :file="previewFile" />
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiError, api, formatBytes } from '@/api/client';
import FilePreviewDialog from '@/features/preview/FilePreviewDialog.vue';

interface SearchItem {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  projectId: string;
  projectName: string;
  createdAt: string;
  hasContent?: boolean;
}

const route = useRoute();
const router = useRouter();

const keyword = ref(String(route.query.q ?? ''));
const items = ref<SearchItem[]>([]);
const total = ref(0);
const loading = ref(false);
const searched = ref(false);
const previewVisible = ref(false);
const previewFile = ref<SearchItem | null>(null);

const columns = [
  { title: '文件名', dataIndex: 'fileName', key: 'fileName' },
  { title: '项目', dataIndex: 'projectName', key: 'projectName', width: 190 },
  { title: '大小', key: 'sizeBytes', width: 120 },
  { title: '上传时间', key: 'createdAt', width: 190 },
  { title: '操作', key: 'actions', width: 230 },
];

async function search(): Promise<void> {
  const value = keyword.value.trim();
  if (value.length < 2) {
    message.warning('关键词至少 2 个字符');
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
    message.error(error instanceof ApiError ? error.message : '搜索失败');
  } finally {
    loading.value = false;
  }
}

async function download(item: SearchItem): Promise<void> {
  try {
    const response = await fetch(`/api/v1/files/${item.fileId}/content`);
    if (!response.ok) throw new Error('下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '下载失败');
  }
}

function openPreview(item: SearchItem): void {
  previewFile.value = item;
  previewVisible.value = true;
}

function openProject(item: SearchItem): void {
  void router.push(`/projects/${item.projectId}/files`);
}

onMounted(() => {
  if (keyword.value.trim().length >= 2) void search();
});
</script>

<style scoped>
.hint {
  margin-top: 12px;
  color: var(--vd-text-secondary);
  font-size: 13px;
}
</style>
