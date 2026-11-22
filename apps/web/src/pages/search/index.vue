<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">QUERY / FILES</p>
        <h1 class="vd-page-title">搜索</h1>
        <p class="vd-page-sub">按文件名检索你有权查看的资料；也可以用一句话让 AI 帮你拼条件</p>
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

    <div class="ai-bar">
      <a-input-search
        v-model:value="aiQuery"
        placeholder="用一句话描述要找的文件，例如：上周上传的超过 100MB 的视频"
        enter-button="AI 解析"
        :loading="aiParsing"
        class="ai-bar-input"
        @search="parseWithAi"
      />
      <a-button class="ai-bar-secondary" :loading="semanticLoading" @click="semanticSearch">
        语义搜索
      </a-button>
      <span class="ai-bar-hint">语义搜索按内容主题匹配，需领队先建立索引</span>
    </div>

    <a-modal
      v-model:open="semanticVisible"
      title="语义搜索结果"
      :footer="null"
      width="720px"
      :destroy-on-close="true"
    >
      <a-spin :spinning="semanticLoading">
        <a-alert
          v-if="semanticNotice"
          type="info"
          show-icon
          :message="semanticNotice"
          style="margin-bottom: 12px"
        />
        <a-empty v-if="semanticItems.length === 0" description="没有语义命中的内容" />
        <div v-for="item in semanticItems" :key="`${item.fileId}-${item.chunkIndex}`" class="semantic-item">
          <div class="semantic-head">
            <span class="semantic-name">{{ item.fileName }}</span>
            <span class="semantic-score">相似度 {{ (item.score * 100).toFixed(0) }}%</span>
          </div>
          <p class="semantic-excerpt">{{ item.excerpt.slice(0, 160) }}</p>
          <a-button type="link" size="small" @click="openSemanticPreview(item)">预览该文件</a-button>
        </div>
      </a-spin>
    </a-modal>

    <div v-if="filters" class="filter-chips">
      <a-tag v-if="filters.keyword" closable @close="clearKeyword">{{ filters.keyword }}</a-tag>
      <a-tag v-if="filters.uploadedFrom || filters.uploadedTo" closable @close="clearDates">
        上传：{{ filters.uploadedFrom ?? '…' }} ~ {{ filters.uploadedTo ?? '…' }}
      </a-tag>
      <a-tag v-if="filters.minSizeBytes !== null || filters.maxSizeBytes !== null" closable @close="clearSizes">
        大小：{{ sizeRangeLabel }}
      </a-tag>
      <a-tag
        v-for="ext in filters.extensions ?? []"
        :key="ext"
        closable
        @close="removeExtension(ext)"
      >
        .{{ ext }}
      </a-tag>
      <a-button type="link" size="small" @click="clearFilters">清空条件</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="fileId"
      :scroll="{ x: 620 }"
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
import { computed, onMounted, ref } from 'vue';
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

/** AI 解析出的搜索条件（与契约 ParsedSearchFilters 同构） */
interface ParsedFilters {
  keyword: string | null;
  uploadedFrom: string | null;
  uploadedTo: string | null;
  minSizeBytes: number | null;
  maxSizeBytes: number | null;
  extensions: string[] | null;
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

const aiQuery = ref('');
const aiParsing = ref(false);
const filters = ref<ParsedFilters | null>(null);

// ---------- 语义搜索 ----------

interface SemanticItem {
  fileId: string;
  fileName: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
}

const semanticVisible = ref(false);
const semanticLoading = ref(false);
const semanticItems = ref<SemanticItem[]>([]);
const semanticNotice = ref<string | null>(null);

async function semanticSearch(): Promise<void> {
  const query = aiQuery.value.trim();
  if (!query) {
    message.warning('先在输入框里描述要找的内容主题');
    return;
  }
  semanticVisible.value = true;
  semanticLoading.value = true;
  semanticItems.value = [];
  semanticNotice.value = null;
  try {
    const result = await api<{ items: SemanticItem[]; notice: string | null }>('/ai/semantic-search', {
      method: 'POST',
      body: JSON.stringify({ query: query.slice(0, 300), limit: 10 }),
    });
    semanticItems.value = result.items ?? [];
    semanticNotice.value = result.notice;
  } catch (error) {
    semanticVisible.value = false;
    message.error(error instanceof ApiError ? error.message : '语义搜索失败');
  } finally {
    semanticLoading.value = false;
  }
}

function openSemanticPreview(item: SemanticItem): void {
  previewFile.value = {
    fileId: item.fileId,
    fileName: item.fileName,
    sizeBytes: 0,
    projectId: '',
    projectName: '',
    createdAt: '',
    hasContent: true,
  };
  previewVisible.value = true;
}

const columns = [
  { title: '文件名', dataIndex: 'fileName', key: 'fileName' },
  { title: '项目', dataIndex: 'projectName', key: 'projectName', width: 190 },
  { title: '大小', key: 'sizeBytes', width: 120 },
  { title: '上传时间', key: 'createdAt', width: 190 },
  { title: '操作', key: 'actions', width: 230 },
];

const sizeRangeLabel = computed(() => {
  const f = filters.value;
  if (!f) return '';
  if (f.minSizeBytes !== null && f.maxSizeBytes !== null) {
    return `${formatBytes(f.minSizeBytes)} ~ ${formatBytes(f.maxSizeBytes)}`;
  }
  if (f.minSizeBytes !== null) return `≥ ${formatBytes(f.minSizeBytes)}`;
  if (f.maxSizeBytes !== null) return `≤ ${formatBytes(f.maxSizeBytes)}`;
  return '';
});

function filtersNonEmpty(value: ParsedFilters | null): boolean {
  return Boolean(
    value &&
      (value.keyword ||
        value.uploadedFrom ||
        value.uploadedTo ||
        value.minSizeBytes !== null ||
        value.maxSizeBytes !== null ||
        (value.extensions && value.extensions.length > 0)),
  );
}

async function parseWithAi(): Promise<void> {
  const query = aiQuery.value.trim();
  if (!query) {
    message.warning('先描述一下要找什么');
    return;
  }
  aiParsing.value = true;
  try {
    const result = await api<{ filters: ParsedFilters | null; notice: string | null }>(
      '/ai/parse-search',
      { method: 'POST', body: JSON.stringify({ query }) },
    );
    if (result.notice) message.info(result.notice);
    if (filtersNonEmpty(result.filters)) {
      filters.value = result.filters;
      await search();
    }
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : 'AI 解析失败');
  } finally {
    aiParsing.value = false;
  }
}

async function search(): Promise<void> {
  const value = keyword.value.trim();
  // 手输关键词优先；没有手输时用 AI 解析出的关键词
  const effectiveKeyword = value.length >= 2 ? value : (filters.value?.keyword ?? '');
  if (effectiveKeyword.length > 0 && effectiveKeyword.length < 2) {
    message.warning('关键词至少 2 个字符');
    return;
  }
  if (effectiveKeyword.length < 2 && !filtersNonEmpty(filters.value)) {
    message.warning('请输入关键词，或用 AI 解析出搜索条件');
    return;
  }

  const params = new URLSearchParams();
  if (effectiveKeyword.length >= 2) params.set('q', effectiveKeyword);
  if (filters.value?.uploadedFrom) params.set('uploadedFrom', filters.value.uploadedFrom);
  if (filters.value?.uploadedTo) params.set('uploadedTo', filters.value.uploadedTo);
  if (filters.value?.minSizeBytes !== null && filters.value?.minSizeBytes !== undefined) {
    params.set('minSizeBytes', String(filters.value.minSizeBytes));
  }
  if (filters.value?.maxSizeBytes !== null && filters.value?.maxSizeBytes !== undefined) {
    params.set('maxSizeBytes', String(filters.value.maxSizeBytes));
  }
  if (filters.value?.extensions && filters.value.extensions.length > 0) {
    params.set('extensions', filters.value.extensions.join(','));
  }
  params.set('pageSize', '100');

  loading.value = true;
  try {
    const result = await api<{ items: SearchItem[]; total: number }>(`/search?${params}`);
    items.value = result.items;
    total.value = result.total;
    searched.value = true;
    await router.replace({ path: '/search', query: value.length >= 2 ? { q: value } : {} });
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '搜索失败');
  } finally {
    loading.value = false;
  }
}

function clearKeyword(): void {
  if (filters.value) filters.value.keyword = null;
}

function clearDates(): void {
  if (filters.value) {
    filters.value.uploadedFrom = null;
    filters.value.uploadedTo = null;
  }
}

function clearSizes(): void {
  if (filters.value) {
    filters.value.minSizeBytes = null;
    filters.value.maxSizeBytes = null;
  }
}

function removeExtension(ext: string): void {
  if (!filters.value?.extensions) return;
  filters.value.extensions = filters.value.extensions.filter((item) => item !== ext);
}

function clearFilters(): void {
  filters.value = null;
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
.ai-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  margin-top: 10px;
}

.ai-bar-input {
  flex: 1 1 260px;
  min-width: 200px;
}

@media (max-width: 760px) {
  .ai-bar-hint {
    flex-basis: 100%;
  }
}

.semantic-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--vd-border, #e5e0d5);
}

.semantic-item:last-child {
  border-bottom: none;
}

.semantic-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.semantic-name {
  font-weight: 600;
}

.semantic-score {
  color: var(--vd-accent, #b4482c);
  font-size: 12px;
  white-space: nowrap;
}

.semantic-excerpt {
  margin: 6px 0 4px;
  color: var(--vd-text-secondary, #6b6252);
  font-size: 12px;
  line-height: 1.8;
}

.ai-bar-hint {
  color: var(--vd-text-secondary);
  font-size: 11px;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.hint {
  margin-top: 12px;
  color: var(--vd-text-secondary);
  font-size: 13px;
}
</style>
