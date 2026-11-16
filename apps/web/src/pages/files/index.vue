<template>
  <div class="files-layout">
    <aside class="files-aside">
      <div class="aside-search">
        <a-input
          v-model:value="fileSearch"
          placeholder="请输入文件名"
          allow-clear
          @press-enter="applyFilter"
        />
        <a-button type="primary" @click="applyFilter">查询</a-button>
      </div>
      <FolderTree :folders="folders" :selected-id="folderId ?? null" @select="onTreeSelect" />
    </aside>

    <main class="files-main">
      <a-tabs
        v-model:active-key="activeTab"
        type="editable-card"
        hide-add
        size="small"
        @edit="onTabEdit"
      >
        <a-tab-pane :key="projectId" :tab="projectName || '项目资料'" />
        <template #tabBarExtraContent>
          <a-button size="small" type="text" @click="clearTab">清除</a-button>
        </template>
      </a-tabs>

      <div class="files-toolbar">
        <div class="toolbar-left">
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
                <a-menu-item key="project">新建项目</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </div>

        <div class="toolbar-right">
          <a-input
            v-model:value="folderFilter"
            placeholder="请输入文件夹名称"
            allow-clear
            style="width: 180px"
          />
          <a-select v-model:value="typeFilter" style="width: 120px" :options="typeOptions" />
          <a-button @click="resetFilter">重置</a-button>
          <a-button type="primary" @click="applyFilter">搜索</a-button>
          <a-segmented v-model:value="viewMode" :options="viewOptions" />
          <a-button type="text" title="文件夹管理" @click="folderManagerVisible = true">
            <SettingOutlined />
          </a-button>
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

      <div v-if="uploading" class="progress-box">
        <a-progress :percent="percent" :status="percent === 100 ? 'success' : 'active'" />
        <p class="phase">{{ currentFileName }} · {{ phase }}</p>
      </div>

      <div v-if="viewMode === 'grid'" class="grid-area">
        <div
          v-for="folder in visibleFolders"
          :key="folder.folderId"
          class="grid-card"
          @dblclick="onTreeSelect(folder.folderId)"
        >
          <FolderFilled class="folder-icon" />
          <span class="grid-name" :title="folder.folderName">{{ folder.folderName }}</span>
        </div>
        <div
          v-for="file in visibleFiles"
          :key="file.fileId"
          class="grid-card"
          @click="openPreview(file)"
        >
          <FileOutlined class="file-icon" />
          <span class="grid-name" :title="file.fileName">{{ file.fileName }}</span>
        </div>
        <a-empty
          v-if="visibleFolders.length === 0 && visibleFiles.length === 0"
          description="暂无资料"
          class="empty-block"
        />
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
          <template v-else-if="column.key === 'actions'">
            <a-button type="link" @click="openPreview(record)">预览</a-button>
            <a-button type="link" @click="download(record)">下载</a-button>
            <a-button type="link" danger @click="remove(record)">删除</a-button>
          </template>
        </template>
      </a-table>

      <div class="files-bottom">
        <a-button
          type="primary"
          ghost
          :disabled="selectedFiles.length === 0"
          @click="bundleDownload"
        >
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
import { DownOutlined, FileOutlined, FolderFilled, SettingOutlined } from '@ant-design/icons-vue';
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
import FolderManagerDialog from '@/features/folders/FolderManagerDialog.vue';
import FolderTree from '@/features/folders/FolderTree.vue';
import FilePreviewDialog from '@/features/preview/FilePreviewDialog.vue';
import { importDirectory, type ImportResult } from '@/features/upload/directory-importer';
import { uploadFile } from '@/features/upload/uploader';

const route = useRoute();
const router = useRouter();
const projectId = String(route.params.projectId ?? '');

const projectName = ref('');
const folders = ref<FolderItem[]>([]);
const files = ref<FileItem[]>([]);
const folderId = ref<string | undefined>(undefined);
const loading = ref(false);
const activeTab = ref(projectId);

const fileSearch = ref('');
const folderFilter = ref('');
const typeFilter = ref('all');
const viewMode = ref<'grid' | 'list'>('grid');

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

const typeOptions = [
  { label: '全部', value: 'all' },
  { label: '图片', value: 'image' },
  { label: '音频', value: 'audio' },
  { label: '视频', value: 'video' },
  { label: '测绘', value: 'survey' },
  { label: '文档', value: 'document' },
  { label: '其他', value: 'other' },
];

const viewOptions = [
  { label: '网格', value: 'grid' },
  { label: '列表', value: 'list' },
];

const TYPE_EXTENSIONS: Record<string, string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.m4a'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.wmv'],
  survey: ['.dwg', '.dxf', '.shp', '.kml', '.geojson', '.las'],
  document: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.txt', '.csv'],
};

const columns = [
  { title: '文件名', dataIndex: 'fileName', key: 'fileName' },
  { title: '大小', key: 'sizeBytes', width: 120 },
  { title: '类型', dataIndex: 'contentType', key: 'contentType', width: 190 },
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

function extensionOf(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]?.toLowerCase() ?? ''}` : '';
}

function matchesType(name: string): boolean {
  if (typeFilter.value === 'all') return true;
  const ext = extensionOf(name);
  if (typeFilter.value === 'other') {
    return !Object.values(TYPE_EXTENSIONS).some((list) => list.includes(ext));
  }
  return (TYPE_EXTENSIONS[typeFilter.value] ?? []).includes(ext);
}

const visibleFolders = computed(() =>
  folders.value.filter(
    (folder) =>
      folder.parentId === (folderId.value ?? null) &&
      (folderFilter.value.trim().length === 0 ||
        folder.folderName.toLowerCase().includes(folderFilter.value.trim().toLowerCase())),
  ),
);

const visibleFiles = computed(() =>
  files.value.filter(
    (file) =>
      (fileSearch.value.trim().length === 0 ||
        file.fileName.toLowerCase().includes(fileSearch.value.trim().toLowerCase())) &&
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
  // 计算属性响应式生效，这里仅用于统一触发（保留按钮语义）
}

function resetFilter(): void {
  fileSearch.value = '';
  folderFilter.value = '';
  typeFilter.value = 'all';
}

function onTreeSelect(id: string | null): void {
  folderId.value = id ?? undefined;
  void loadFiles();
}

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
  if (key === 'folder') folderManagerVisible.value = true;
  else void router.push('/projects');
}

function onTabEdit(key: unknown, action: string): void {
  if (action === 'remove') void router.push('/projects');
}

function clearTab(): void {
  void router.push('/projects');
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
  if (selectedFiles.value.length === 0) return;
  try {
    const result = await api<{ bundleId: string }>('/bundles', {
      method: 'POST',
      body: JSON.stringify({ fileIds: selectedFiles.value.map((file) => file.fileId) }),
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

function openPreview(file: FileItem): void {
  previewFile.value = file;
  previewVisible.value = true;
}

onMounted(async () => {
  await loadProject();
  await loadAll();
});
</script>

<style scoped>
.files-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.files-aside {
  padding: 16px;
  background: #ffffff;
  border: 1px solid var(--vd-border);
  border-radius: 12px;
}

.aside-search {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.files-main {
  min-width: 0;
}

.files-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0 12px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.files-title {
  margin: 0 8px 0 0;
  font-size: 18px;
  font-weight: 600;
}

.files-crumb {
  margin-bottom: 14px;
}

.grid-area {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
  min-height: 200px;
}

.grid-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 12px;
  background: #ffffff;
  border: 1px solid var(--vd-border);
  border-radius: 12px;
  cursor: pointer;
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

.grid-card:hover {
  border-color: #bcd8fb;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.folder-icon {
  font-size: 40px;
  color: #eab308;
}

.file-icon {
  font-size: 38px;
  color: #6e6e73;
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
  align-items: center;
  gap: 14px;
  margin-top: 18px;
}

.files-count {
  color: var(--vd-text-secondary);
  font-size: 13px;
}
</style>
