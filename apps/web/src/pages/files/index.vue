<template>
  <div class="files-layout" :class="{ 'aside-collapsed': asideCollapsed }">
    <aside v-show="!asideCollapsed" class="files-aside">
      <div class="aside-head">
        <span class="vd-eyebrow">INDEX</span>
        <span class="aside-head-label">目录</span>
      </div>

      <div class="aside-search">
        <a-input
          v-model:value="folderSearch"
          placeholder="搜索文件夹或文件名"
          allow-clear
          @press-enter="searchFolders"
        />
        <a-button type="primary" :loading="searching" @click="searchFolders">查询</a-button>
      </div>

      <div class="aside-tree">
        <div v-if="folderHits.length > 0" class="hit-list">
          <div class="hit-head">
            <span>搜索结果 {{ folderHits.length }} 个</span>
            <a-button type="link" size="small" @click="clearFolderSearch">返回目录</a-button>
          </div>
          <div v-for="hit in folderHits" :key="hit.folderId" class="hit-item" @click="openHit(hit)">
            <div class="hit-name">{{ hit.folderName }}</div>
            <div class="hit-path">{{ hit.projectName }} · {{ hit.path }}</div>
          </div>
        </div>

        <FolderTree
          v-else
          :folders="folders"
          :selected-id="folderId ?? null"
          @select="onTreeSelect"
        />
      </div>
    </aside>

    <main class="files-main">
      <section class="files-panel">
        <a-tabs
          v-model:active-key="activeTab"
          type="editable-card"
          hide-add
          size="small"
          @change="onTabChange"
          @edit="onTabEdit"
        >
          <a-tab-pane v-for="tab in tabsStore.tabs" :key="tab.projectId" :tab="tab.projectName" />
          <template #tabBarExtraContent>
            <a-button size="small" type="text" @click="clearTabs">清除</a-button>
          </template>
        </a-tabs>

        <div class="files-toolbar">
          <div class="toolbar-row">
            <a-button
              type="text"
              class="aside-toggle"
              :title="asideCollapsed ? '展开目录' : '收起目录'"
              @click="toggleAside"
            >
              <MenuUnfoldOutlined v-if="asideCollapsed" />
              <MenuFoldOutlined v-else />
            </a-button>
            <h2 class="files-title">{{ currentFolderName || projectName || '项目资料' }}</h2>
            <a-dropdown>
              <a-button type="primary">
                上传
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="onUploadMenu">
                  <a-menu-item key="files">上传文件</a-menu-item>
                  <a-menu-item key="dir">导入目录</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
            <a-dropdown>
              <a-button>
                新建
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="onCreateMenu">
                  <a-menu-item key="folder">新建文件夹</a-menu-item>
                  <a-menu-item v-if="session.user?.role === 'LEADER'" key="project">
                    新建项目
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
            <div class="toolbar-spacer" />
            <a-segmented v-model:value="viewMode" :options="viewOptions" />
            <a-button type="text" title="文件夹管理" @click="folderManagerVisible = true">
              <SettingOutlined />
            </a-button>
          </div>

          <div class="toolbar-row toolbar-row-filter">
            <a-input
              v-model:value="folderFilter"
              placeholder="请输入文件夹名称"
              allow-clear
              class="folder-filter"
              style="width: 180px"
            />
            <a-select v-model:value="typeFilter" style="width: 130px" :options="typeOptions" />
            <a-button @click="resetFilter">重置</a-button>
            <a-button type="primary" @click="applyFilter">搜索</a-button>
            <span class="files-count">
              文件夹 {{ visibleFolders.length }} 个 · 文件 {{ visibleFiles.length }} 个
            </span>
          </div>
        </div>

        <a-breadcrumb class="files-crumb">
          <a-breadcrumb-item>
            <a @click="onTreeSelect(null)">全部</a>
          </a-breadcrumb-item>
          <a-breadcrumb-item>{{ projectName || '项目资料' }}</a-breadcrumb-item>
          <a-breadcrumb-item v-for="node in breadcrumb" :key="node.folderId">
            <a @click="onTreeSelect(node.folderId)">{{ node.folderName }}</a>
          </a-breadcrumb-item>
        </a-breadcrumb>
      </section>

      <div class="files-body">
        <div v-if="uploading" class="progress-box">
          <a-progress :percent="percent" :status="percent === 100 ? 'success' : 'active'" />
          <p class="phase">{{ currentFileName }} · {{ phase }}</p>
        </div>

        <div v-if="viewMode === 'grid'" class="grid-area">
          <div
            v-for="folder in visibleFolders"
            :key="folder.folderId"
            class="grid-card grid-folder"
            @dblclick="onTreeSelect(folder.folderId)"
          >
            <FolderFilled class="folder-icon" />
            <span class="grid-name" :title="folder.folderName">{{ folder.folderName }}</span>
            <span class="grid-meta vd-mono">FOLDER</span>
          </div>
          <div
            v-for="file in visibleFiles"
            :key="file.fileId"
            class="grid-card"
            @click="onFileClick(file)"
          >
            <FileOutlined class="file-icon" :style="{ color: fileTone(file.fileName) }" />
            <span class="grid-name" :title="file.fileName">{{ file.fileName }}</span>
            <span class="grid-meta vd-mono">{{ formatBytes(file.sizeBytes) }}</span>
            <span v-if="file.hasContent === false" class="sample-badge">示例</span>
          </div>
          <a-empty
            v-if="visibleFolders.length === 0 && visibleFiles.length === 0"
            description="暂无资料"
            class="empty-block"
          />
        </div>

        <div v-else-if="isNarrow" class="file-cards">
          <article v-for="file in visibleFiles" :key="file.fileId" class="file-card">
            <div class="file-card-main" @click="onFileClick(file)">
              <FileOutlined class="file-card-icon" :style="{ color: fileTone(file.fileName) }" />
              <div class="file-card-text">
                <span class="file-card-name" :title="file.fileName">{{ file.fileName }}</span>
                <span class="file-card-meta vd-mono">{{ formatBytes(file.sizeBytes) }}</span>
              </div>
              <span v-if="file.hasContent === false" class="sample-badge">示例</span>
            </div>
            <div class="file-card-actions">
              <a-button
                type="link"
                size="small"
                :disabled="file.hasContent === false"
                @click="openPreview(file)"
              >
                预览
              </a-button>
              <a-button
                type="link"
                size="small"
                :disabled="file.hasContent === false"
                @click="download(file)"
              >
                下载
              </a-button>
              <a-button type="link" size="small" danger @click="remove(file)">删除</a-button>
            </div>
          </article>
        </div>

        <a-table
          v-else
          :columns="columns"
          :data-source="visibleFiles"
          :loading="loading"
          :pagination="false"
          row-key="fileId"
          :row-selection="rowSelection"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'sizeBytes'">
              {{ formatBytes(record.sizeBytes) }}
            </template>
            <template v-else-if="column.key === 'createdAt'">
              {{ new Date(record.createdAt).toLocaleString() }}
            </template>
            <template v-else-if="column.key === 'extension'">
              <span class="file-type">{{ fileExtension(record.fileName) }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <div class="row-actions">
                <a-button
                  type="link"
                  :disabled="record.hasContent === false"
                  @click="openPreview(record)"
                >
                  预览
                </a-button>
                <a-button
                  type="link"
                  :disabled="record.hasContent === false"
                  @click="download(record)"
                >
                  下载
                </a-button>
                <a-button type="link" danger @click="remove(record)">删除</a-button>
              </div>
            </template>
          </template>
        </a-table>
      </div>

      <div class="files-bottom">
        <a-button :disabled="selectedFiles.length === 0" @click="bundleDownload">
          打包下载{{ selectedFiles.length > 0 ? `（${selectedFiles.length}）` : '' }}
        </a-button>
        <span class="files-count">
          文件夹 {{ visibleFolders.length }} 个 · 文件 {{ visibleFiles.length }} 个
        </span>
      </div>

      <input ref="fileInput" type="file" multiple hidden @change="onFilesPicked" />
      <input ref="dirInput" type="file" webkitdirectory multiple hidden @change="onDirPicked" />

      <FolderManagerDialog
        v-model="folderManagerVisible"
        :project-id="projectId"
        @changed="loadAll"
      />

      <FilePreviewDialog v-model="previewVisible" :file="previewFile" />

      <a-modal
        v-model:open="createProjectVisible"
        title="新建项目"
        :confirm-loading="creatingProject"
        ok-text="创建并打开"
        cancel-text="取消"
        @ok="createProject"
      >
        <a-form layout="vertical">
          <a-form-item label="项目编码">
            <a-input v-model:value="projectForm.projectCode" placeholder="例如 ARCH-2026-001" />
          </a-form-item>
          <a-form-item label="项目名称">
            <a-input v-model:value="projectForm.projectName" />
          </a-form-item>
        </a-form>
      </a-modal>

      <a-modal v-model:open="importVisible" title="导入结果" :footer="null" width="720px">
        <a-alert
          type="info"
          show-icon
          :message="`成功 ${importSummary.success} · 跳过 ${importSummary.skipped} · 失败 ${importSummary.failed}`"
          style="margin-bottom: 12px"
        />
        <a-table
          :columns="importColumns"
          :data-source="importResults"
          :pagination="false"
          row-key="fileName"
          size="small"
          :scroll="{ y: 360 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-tag
                :color="
                  record.status === 'success'
                    ? 'success'
                    : record.status === 'skipped'
                      ? 'default'
                      : 'error'
                "
              >
                {{
                  record.status === 'success'
                    ? '成功'
                    : record.status === 'skipped'
                      ? '跳过'
                      : '失败'
                }}
              </a-tag>
            </template>
          </template>
        </a-table>
      </a-modal>
    </main>
  </div>
</template>

<script setup lang="ts">
import {
  DownOutlined,
  FileOutlined,
  FolderFilled,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  ApiError,
  api,
  formatBytes,
  getToken,
  type FileItem,
  type FolderItem,
  type ProjectSummary,
} from '@/api/client';
import { useMediaQuery } from '@/composables/useMediaQuery';
import FolderManagerDialog from '@/features/folders/FolderManagerDialog.vue';
import FolderTree from '@/features/folders/FolderTree.vue';
import FilePreviewDialog from '@/features/preview/FilePreviewDialog.vue';
import { importDirectory, type ImportResult } from '@/features/upload/directory-importer';
import { uploadFile } from '@/features/upload/uploader';
import { useSessionStore } from '@/stores/session';
import { useTabsStore } from '@/stores/tabs';

const TYPE_TONE: Record<string, string> = {
  doc: '#8f3620',
  docx: '#8f3620',
  rtf: '#8f3620',
  odt: '#8f3620',
  pdf: '#b4482c',
  xls: '#4f7a52',
  xlsx: '#4f7a52',
  csv: '#4f7a52',
  ods: '#4f7a52',
  ppt: '#c8922f',
  pptx: '#c8922f',
  odp: '#c8922f',
  png: '#6b4a6b',
  jpg: '#6b4a6b',
  jpeg: '#6b4a6b',
  gif: '#6b4a6b',
  webp: '#6b4a6b',
  svg: '#6b4a6b',
  zip: '#7a6e60',
  rar: '#7a6e60',
  '7z': '#7a6e60',
};

function fileTone(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_TONE[ext] ?? '#7a6e60';
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return '—';
  return fileName.slice(dot + 1).toUpperCase();
}

interface FolderHit {
  folderId: string;
  folderName: string;
  projectId: string;
  projectName: string;
  path: string;
}

interface CategoryItem {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  extensions: string[];
  isSystem: boolean;
}

const route = useRoute();
const router = useRouter();
const tabsStore = useTabsStore();
const isNarrow = useMediaQuery('(max-width: 760px)');
const session = useSessionStore();
const projectId = String(route.params.projectId ?? '');

const projectName = ref('');
const folders = ref<FolderItem[]>([]);
const files = ref<FileItem[]>([]);
const folderId = ref<string | undefined>(undefined);
const loading = ref(false);
const activeTab = ref(projectId);

const folderSearch = ref('');
const folderHits = ref<FolderHit[]>([]);
const searching = ref(false);

const folderFilter = ref('');
const typeFilter = ref('all');
const appliedFolderFilter = ref('');
const appliedTypeFilter = ref('all');
const viewMode = ref<'grid' | 'list'>('grid');
const asideCollapsed = ref(localStorage.getItem('vd_aside_collapsed') === '1');

function toggleAside(): void {
  asideCollapsed.value = !asideCollapsed.value;
  localStorage.setItem('vd_aside_collapsed', asideCollapsed.value ? '1' : '0');
}
const categories = ref<CategoryItem[]>([]);

const folderManagerVisible = ref(false);
const previewVisible = ref(false);
const previewFile = ref<FileItem | null>(null);
const selectedFiles = ref<FileItem[]>([]);
const selectedRowKeys = ref<string[]>([]);

const fileInput = ref<HTMLInputElement | null>(null);
const dirInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const percent = ref(0);
const phase = ref('');
const currentFileName = ref('');

const importVisible = ref(false);
const importResults = ref<ImportResult[]>([]);
const importSummary = reactive({ success: 0, skipped: 0, failed: 0 });

const createProjectVisible = ref(false);
const creatingProject = ref(false);
const projectForm = reactive({ projectCode: '', projectName: '' });

const FALLBACK_TYPE_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '图片', value: 'image' },
  { label: '音频', value: 'audio' },
  { label: '视频', value: 'video' },
  { label: '测绘', value: 'survey' },
  { label: '文档', value: 'document' },
  { label: '其他', value: 'other' },
];

const FALLBACK_EXTENSIONS: Record<string, string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.m4a'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.wmv'],
  survey: ['.dwg', '.dxf', '.shp', '.kml', '.geojson', '.las'],
  document: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.txt', '.csv'],
};

const viewOptions = [
  { label: '网格', value: 'grid' },
  { label: '列表', value: 'list' },
];

const columns = [
  { title: '文件名', dataIndex: 'fileName', key: 'fileName' },
  { title: '大小', key: 'sizeBytes', width: 120 },
  { title: '类型', key: 'extension', width: 110 },
  { title: '上传时间', key: 'createdAt', width: 190 },
  { title: '操作', key: 'actions', width: 200 },
];

const importColumns = [
  { title: '文件', dataIndex: 'fileName', key: 'fileName' },
  { title: '结果', key: 'status', width: 100 },
  { title: '说明', dataIndex: 'message', key: 'message' },
];

const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys: string[], rows: FileItem[]) => {
    selectedRowKeys.value = keys;
    selectedFiles.value = rows;
  },
}));

const typeOptions = computed(() =>
  categories.value.length > 0
    ? [
        { label: '全部', value: 'all' },
        ...categories.value.map((category) => ({
          label: category.categoryName,
          value: category.categoryId,
        })),
      ]
    : FALLBACK_TYPE_OPTIONS,
);

function extensionOf(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]?.toLowerCase() ?? ''}` : '';
}

function matchesType(name: string): boolean {
  if (appliedTypeFilter.value === 'all') return true;

  const extension = extensionOf(name);

  if (categories.value.length > 0) {
    const category = categories.value.find((item) => item.categoryId === appliedTypeFilter.value);
    if (!category) return true;
    if (category.categoryCode === 'OTHER') {
      return !categories.value.some(
        (item) => item.categoryCode !== 'OTHER' && item.extensions.includes(extension),
      );
    }
    return category.extensions.includes(extension);
  }

  if (appliedTypeFilter.value === 'other') {
    return !Object.values(FALLBACK_EXTENSIONS).some((list) => list.includes(extension));
  }
  return (FALLBACK_EXTENSIONS[appliedTypeFilter.value] ?? []).includes(extension);
}

const visibleFolders = computed(() =>
  folders.value.filter(
    (folder) =>
      folder.parentId === (folderId.value ?? null) &&
      (appliedFolderFilter.value.trim().length === 0 ||
        folder.folderName.toLowerCase().includes(appliedFolderFilter.value.trim().toLowerCase())),
  ),
);

const visibleFiles = computed(() =>
  files.value.filter(
    (file) =>
      (folderSearch.value.trim().length === 0 ||
        file.fileName.toLowerCase().includes(folderSearch.value.trim().toLowerCase())) &&
      matchesType(file.fileName),
  ),
);

const currentFolderName = computed(
  () => folders.value.find((folder) => folder.folderId === folderId.value)?.folderName ?? '',
);

const breadcrumb = computed(() => {
  const chain: FolderItem[] = [];
  let current = folders.value.find((folder) => folder.folderId === folderId.value);
  let guard = 0;
  while (current && guard < 20) {
    chain.unshift(current);
    current = folders.value.find((folder) => folder.folderId === current?.parentId);
    guard += 1;
  }
  return chain;
});

function applyFilter(): void {
  appliedFolderFilter.value = folderFilter.value;
  appliedTypeFilter.value = typeFilter.value;
}

function resetFilter(): void {
  folderFilter.value = '';
  typeFilter.value = 'all';
  appliedFolderFilter.value = '';
  appliedTypeFilter.value = 'all';
}

function onTreeSelect(id: string | null): void {
  folderId.value = id ?? undefined;
  void loadFiles();
}

async function searchFolders(): Promise<void> {
  const keyword = folderSearch.value.trim();
  if (keyword.length === 0) {
    folderHits.value = [];
    return;
  }

  searching.value = true;
  try {
    const result = await api<{ items: FolderHit[] }>(
      `/folders/search?q=${encodeURIComponent(keyword)}`,
    );
    folderHits.value = result.items;
    if (result.items.length === 0) message.info('没有匹配的文件夹');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '搜索失败');
  } finally {
    searching.value = false;
  }
}

function clearFolderSearch(): void {
  folderSearch.value = '';
  folderHits.value = [];
}

function openHit(hit: FolderHit): void {
  void router.push({
    path: `/projects/${hit.projectId}/files`,
    query: { folderId: hit.folderId },
  });
}

function onTabChange(key: string | number): void {
  const targetId = String(key);
  if (targetId !== projectId) {
    void router.push(`/projects/${targetId}/files`);
  }
}

function onTabEdit(key: unknown, action: string): void {
  if (action !== 'remove') return;
  const removedId = String(key);
  tabsStore.remove(removedId);
  if (removedId !== projectId) return;

  const next = tabsStore.tabs[0];
  if (next) void router.push(`/projects/${next.projectId}/files`);
  else void router.push('/projects');
}

function clearTabs(): void {
  tabsStore.clear();
  void router.push('/projects');
}

async function loadProject(): Promise<boolean> {
  try {
    const result = await api<{ items: ProjectSummary[] }>('/projects');
    const found = result.items.find((item) => item.projectId === projectId);
    projectName.value = found?.projectName ?? '';
    return Boolean(found);
  } catch {
    projectName.value = '';
    return false;
  }
}

async function loadCategories(): Promise<void> {
  try {
    categories.value = await api<CategoryItem[]>('/categories');
  } catch {
    categories.value = [];
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
    message.error(error instanceof ApiError ? error.message : '加载文件失败');
  } finally {
    loading.value = false;
  }
}

async function loadAll(): Promise<void> {
  await loadFolders();
  await loadFiles();
}

function onUploadMenu({ key }: { key: string }): void {
  if (key === 'files') pickFiles();
  else pickDirectory();
}

function onCreateMenu({ key }: { key: string }): void {
  if (key === 'folder') {
    folderManagerVisible.value = true;
    return;
  }
  projectForm.projectCode = '';
  projectForm.projectName = '';
  createProjectVisible.value = true;
}

async function createProject(): Promise<void> {
  if (!projectForm.projectCode.trim() || !projectForm.projectName.trim()) {
    message.warning('项目编码与名称不能为空');
    return;
  }

  creatingProject.value = true;
  try {
    const created = await api<{ projectId: string; projectName: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectCode: projectForm.projectCode.trim(),
        projectName: projectForm.projectName.trim(),
      }),
    });
    tabsStore.add(created.projectId, created.projectName);
    createProjectVisible.value = false;
    message.success('项目已创建');
    await router.push(`/projects/${created.projectId}/files`);
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '创建失败');
  } finally {
    creatingProject.value = false;
  }
}

function pickFiles(): void {
  if (folders.value.length === 0) {
    message.warning('请先创建文件夹');
    return;
  }
  fileInput.value?.click();
}

async function onFilesPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const picked = Array.from(input.files ?? []);
  input.value = '';
  if (picked.length === 0) return;

  const targetFolder = folderId.value || folders.value[0]?.folderId;
  if (!targetFolder) {
    message.warning('请选择目标文件夹');
    return;
  }

  uploading.value = true;
  try {
    for (const file of picked) {
      currentFileName.value = file.name;
      percent.value = 0;
      phase.value = '准备中';
      await uploadFile(file, projectId, targetFolder, (progress) => {
        percent.value = progress.percent;
        phase.value = progress.phase;
      });
      message.success(`${file.name} 上传完成`);
    }
    await loadFiles();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '上传失败');
  } finally {
    uploading.value = false;
    currentFileName.value = '';
    phase.value = '';
    percent.value = 0;
  }
}

function pickDirectory(): void {
  if (folders.value.length === 0) {
    message.warning('请先创建文件夹');
    return;
  }
  dirInput.value?.click();
}

async function onDirPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const picked = Array.from(input.files ?? []);
  input.value = '';
  if (picked.length === 0) return;

  const targetFolder = folderId.value || folders.value[0]?.folderId;
  if (!targetFolder) {
    message.warning('请选择目标文件夹');
    return;
  }

  uploading.value = true;
  importResults.value = [];
  importSummary.success = 0;
  importSummary.skipped = 0;
  importSummary.failed = 0;

  try {
    const results = await importDirectory({
      files: picked,
      projectId,
      folderId: targetFolder,
      concurrency: 2,
      onProgress: (done, total, current) => {
        percent.value = Math.round((done / total) * 100);
        phase.value = `导入 ${done}/${total}`;
        currentFileName.value = current;
      },
    });

    importResults.value = results;
    for (const item of results) {
      if (item.status === 'success') importSummary.success += 1;
      else if (item.status === 'skipped') importSummary.skipped += 1;
      else importSummary.failed += 1;
    }
    importVisible.value = true;
    if (importSummary.failed === 0) message.success('目录导入完成');
    else message.warning(`导入完成，${importSummary.failed} 个文件失败`);
    await loadFiles();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导入失败');
  } finally {
    uploading.value = false;
    currentFileName.value = '';
    phase.value = '';
    percent.value = 0;
  }
}

async function bundleDownload(): Promise<void> {
  const ready = selectedFiles.value.filter((file) => file.hasContent !== false);
  if (ready.length === 0) {
    message.warning('所选文件没有实际内容，无法打包');
    return;
  }
  try {
    const result = await api<{ bundleId: string }>('/bundles', {
      method: 'POST',
      body: JSON.stringify({ fileIds: ready.map((file) => file.fileId) }),
    });
    const token = getToken();
    const response = await fetch(`/api/v1/bundles/${result.bundleId}/content`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error('打包下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'vaultdeck-bundle.zip';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '打包下载失败');
  }
}

async function download(file: FileItem): Promise<void> {
  try {
    const token = getToken();
    const response = await fetch(`/api/v1/files/${file.fileId}/content`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error('下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '下载失败');
  }
}

async function remove(file: FileItem): Promise<void> {
  try {
    await api(`/files/${file.fileId}`, { method: 'DELETE' });
    message.success('已移入回收站');
    await loadFiles();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除失败');
  }
}

function onFileClick(file: FileItem): void {
  if (file.hasContent === false) {
    message.info('示例文件没有实际内容，无法预览');
    return;
  }
  openPreview(file);
}

function openPreview(file: FileItem): void {
  previewFile.value = file;
  previewVisible.value = true;
}

async function onMountedLoad(): Promise<void> {
  const exists = await loadProject();
  if (!exists) {
    tabsStore.remove(projectId);
    message.warning('项目不存在或无权访问');
    await router.replace('/projects');
    return;
  }

  tabsStore.add(projectId, projectName.value || '项目资料');
  await loadCategories();
  await loadAll();
}

onMounted(async () => {
  const queryFolderId = route.query.folderId;
  if (typeof queryFolderId === 'string' && queryFolderId.length > 0) {
    folderId.value = queryFolderId;
  }
  await onMountedLoad();
});
</script>

<style scoped>
.files-layout {
  display: flex;
  flex: 1;
  gap: 12px;
  min-height: 0;
  align-items: stretch;
}

.files-aside {
  display: flex;
  flex: 0 0 264px;
  flex-direction: column;
  width: 264px;
  height: 100%;
  padding: 14px 12px;
  overflow: hidden;
  background: var(--vd-surface);
  border: 1px solid var(--vd-border);
  border-radius: var(--vd-radius);
}

.aside-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.aside-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 9px;
  margin-bottom: 11px;
  border-bottom: 1px solid var(--vd-border);
}

.aside-head-label {
  color: var(--vd-text-secondary);
  font-family: var(--vd-font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
}

.aside-search {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.hit-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 520px;
  overflow: auto;
}

.hit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--vd-text-secondary);
  font-size: 12px;
}

.hit-item {
  padding: 10px 12px;
  border: 1px solid var(--vd-border);
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}

.hit-item:hover {
  border-color: var(--vd-border-strong);
  background: #fbf6ec;
}

.hit-name {
  font-size: 13px;
  font-weight: 600;
}

.hit-path {
  margin-top: 2px;
  color: var(--vd-text-secondary);
  font-size: 12px;
  word-break: break-all;
}

.files-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.files-panel {
  flex: 0 0 auto;
  margin-bottom: 12px;
  padding-top: 4px;
  background: var(--vd-surface);
  border: 1px solid var(--vd-border);
  border-radius: var(--vd-radius);
  overflow: hidden;
}

.files-body {
  flex: 1;
  min-height: 0;
  padding-right: 4px;
  overflow-y: auto;
}

.files-body :deep(.ant-table-wrapper) {
  min-height: 100%;
}

.files-panel :deep(.ant-tabs-nav) {
  margin: 0;
  padding: 0 14px;
}

.files-toolbar {
  padding: 10px 16px 12px;
  margin: 0;
  border-top: 1px solid var(--vd-border);
}

.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.toolbar-row-filter {
  margin-top: 10px;
}

.toolbar-spacer {
  flex: 1;
}

.aside-toggle {
  padding-left: 0;
}

.files-layout.aside-collapsed .files-aside {
  display: none;
}

.files-title {
  margin: 0 8px 0 0;
  font-family: var(--vd-font-display);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.files-crumb {
  padding: 9px 16px 11px;
  border-top: 1px solid var(--vd-border);
}

.grid-area {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
  min-height: 0;
}

.grid-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 104px;
  padding: 12px 10px 10px;
  background: var(--vd-surface);
  border: 1px solid var(--vd-border);
  border-radius: var(--vd-radius);
  cursor: pointer;
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
}

.grid-card:hover {
  border-color: var(--vd-border-strong);
  box-shadow: 0 8px 24px rgba(58, 43, 28, 0.08);
  transform: translateY(-2px);
}

.grid-meta {
  color: var(--vd-text-secondary);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.grid-folder .grid-meta {
  color: var(--vd-ochre);
}

.folder-icon {
  font-size: 32px;
  color: var(--vd-ochre);
}

.file-icon {
  font-size: 30px;
  color: var(--vd-text-secondary);
}

.grid-name {
  max-width: 100%;
  overflow: hidden;
  color: var(--vd-text);
  font-size: 13px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sample-badge {
  padding: 0 6px;
  border-radius: var(--vd-radius-sm);
  background: var(--vd-ochre-soft);
  color: var(--vd-text-secondary);
  font-size: 11px;
}

/* 窄屏列表：一行一个档案卡，替代被压扁的表格 */
.file-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-card {
  overflow: hidden;
  background: var(--vd-surface);
  border: 1px solid var(--vd-border);
  border-radius: var(--vd-radius);
}

.file-card-main {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 10px;
  cursor: pointer;
}

.file-card-icon {
  flex: 0 0 auto;
  font-size: 22px;
}

.file-card-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.file-card-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-card-meta {
  color: var(--vd-text-secondary);
  font-size: 10px;
}

.file-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  padding: 0 8px 6px;
  border-top: 1px solid var(--vd-border);
}

.empty-block {
  grid-column: 1 / -1;
}

.progress-box {
  margin-bottom: 14px;
}

.phase {
  margin: 6px 0 0;
  color: var(--vd-text-secondary);
  font-size: 12px;
}

.files-bottom {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  padding: 10px 2px 0;
  margin-top: 8px;
  background: var(--vd-paper);
  border-top: 1px solid var(--vd-border);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.file-type {
  color: var(--vd-text-secondary);
  font-family: var(--vd-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.files-count {
  color: var(--vd-text-secondary);
  font-size: 13px;
}

@media (max-width: 1180px) {
  .files-aside {
    display: none;
  }

  .aside-toggle {
    display: none;
  }
}

@media (max-width: 680px) {
  .grid-area {
    grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
    gap: 10px;
  }

  .files-toolbar {
    padding: 8px 12px 10px;
  }

  .files-crumb {
    display: none;
  }

  /* 手机上收掉重复信息，把首屏留给内容 */
  .files-title,
  .folder-filter,
  .toolbar-spacer {
    display: none;
  }

  .toolbar-row-filter {
    margin-top: 8px;
  }
}
</style>
