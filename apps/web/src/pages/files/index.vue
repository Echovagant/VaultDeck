<template>
  <section>
    <div class="page-head">
      <div>
        <a-button type="link" class="back" @click="goBack">← 返回项目</a-button>
        <h1 class="vd-page-title">{{ projectName || '项目资料' }}</h1>
      </div>
    </div>

    <div class="vd-toolbar">
      <a-select
        v-model:value="folderId"
        placeholder="全部文件夹"
        allow-clear
        style="width: 200px"
        :options="folderOptions"
        @change="loadFiles"
      />
      <a-button type="primary" :disabled="folders.length === 0" @click="pickFiles">
        上传文件
      </a-button>
      <a-button @click="folderManagerVisible = true">文件夹管理</a-button>
      <a-button :disabled="folders.length === 0" @click="pickDirectory">导入目录</a-button>
      <a-button type="primary" ghost :disabled="selectedFiles.length === 0" @click="bundleDownload">
        打包下载
      </a-button>
      <a-button @click="loadAll">刷新</a-button>
      <input ref="fileInput" type="file" multiple hidden @change="onFilesPicked" />
      <input ref="dirInput" type="file" webkitdirectory multiple hidden @change="onDirPicked" />
    </div>

    <a-alert
      v-if="folders.length === 0"
      type="info"
      show-icon
      message="当前项目还没有文件夹"
      description="请先在「文件夹管理」中创建文件夹，再上传资料"
      style="margin-bottom: 16px"
    />

    <div v-if="uploading" class="progress-box">
      <a-progress :percent="percent" :status="percent === 100 ? 'success' : 'active'" />
      <p class="phase">{{ currentFileName }} · {{ phase }}</p>
    </div>

    <a-table
      :columns="columns"
      :data-source="files"
      :loading="loading"
      :pagination="false"
      row-key="fileId"
      :row-selection="rowSelection"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'sizeBytes'">{{ formatBytes(record.sizeBytes) }}</template>
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
                record.status === 'success' ? '成功' : record.status === 'skipped' ? '跳过' : '失败'
              }}
            </a-tag>
          </template>
        </template>
      </a-table>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
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

const folderOptions = computed(() =>
  folders.value.map((folder) => ({ label: folder.folderName, value: folder.folderId })),
);

const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys: string[], rows: FileItem[]) => {
    selectedRowKeys.value = keys;
    selectedFiles.value = rows;
  },
}));

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
  if (!folderId.value && result.items.length > 0) {
    folderId.value = result.items[0]?.folderId;
  }
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

function goBack(): void {
  void router.push('/projects');
}

onMounted(async () => {
  await loadProject();
  await loadAll();
});
</script>

<style scoped>
.page-head {
  margin-bottom: 12px;
}

.back {
  padding-left: 0;
  color: var(--vd-text-secondary);
}

.progress-box {
  margin-bottom: 16px;
}

.phase {
  margin: 6px 0 0;
  color: var(--vd-text-secondary);
  font-size: 12px;
}
</style>
