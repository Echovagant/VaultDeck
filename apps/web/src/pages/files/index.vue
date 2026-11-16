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
      <el-button type="primary" :disabled="folders.length === 0" @click="pickFiles"
        >上传文件</el-button
      >
      <el-button type="success" :disabled="selectedFiles.length === 0" @click="bundleDownload">
        打包下载
      </el-button>
      <el-button @click="folderManagerVisible = true">文件夹管理</el-button>
      <el-button :disabled="folders.length === 0" @click="pickDirectory">导入目录</el-button>
      <el-button @click="loadAll">刷新</el-button>
      <input ref="fileInput" type="file" multiple hidden @change="onFilesPicked" />
      <input ref="dirInput" type="file" webkitdirectory multiple hidden @change="onDirPicked" />
    </div>

    <el-alert
      v-if="folders.length === 0"
      type="info"
      :closable="false"
      title="当前项目还没有文件夹，请先在项目页创建文件夹后再上传"
    />

    <div v-if="uploading" class="progress">
      <el-progress :percentage="percent" :text-inside="true" :stroke-width="18" />
      <p class="phase">{{ currentFileName }} · {{ phase }}</p>
    </div>

    <el-table v-loading="loading" :data="files" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
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
      <el-table-column label="操作" width="210">
        <template #default="scope">
          <el-button link type="primary" @click="openPreview(scope.row)">预览</el-button>
          <el-button link type="primary" @click="download(scope.row)">下载</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <FolderManagerDialog
      v-model="folderManagerVisible"
      :project-id="projectId"
      @changed="loadAll"
    />

    <FilePreviewDialog v-model="previewVisible" :file="previewFile" />

    <el-dialog v-model="importVisible" title="导入结果" width="680px">
      <p class="import-summary">
        成功 {{ importSummary.success }} · 跳过 {{ importSummary.skipped }} · 失败
        {{ importSummary.failed }}
      </p>
      <el-table :data="importResults" max-height="420">
        <el-table-column prop="fileName" label="文件" />
        <el-table-column prop="status" label="结果" width="90">
          <template #default="scope">
            <el-tag
              :type="
                scope.row.status === 'success'
                  ? 'success'
                  : scope.row.status === 'skipped'
                    ? 'info'
                    : 'danger'
              "
              size="small"
            >
              {{
                scope.row.status === 'success'
                  ? '成功'
                  : scope.row.status === 'skipped'
                    ? '跳过'
                    : '失败'
              }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="说明" />
      </el-table>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
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
const folderId = ref<string>('');
const loading = ref(false);

const folderManagerVisible = ref(false);
const previewVisible = ref(false);
const previewFile = ref<FileItem | null>(null);
const selectedFiles = ref<FileItem[]>([]);

function onSelectionChange(rows: FileItem[]): void {
  selectedFiles.value = rows;
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
    ElMessage.error(error instanceof Error ? error.message : '打包下载失败');
  }
}

function openPreview(file: FileItem): void {
  previewFile.value = file;
  previewVisible.value = true;
}

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const percent = ref(0);
const phase = ref('');
const currentFileName = ref('');

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
    folderId.value = result.items[0]?.folderId ?? '';
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
    ElMessage.error(error instanceof ApiError ? error.message : '加载文件失败');
  } finally {
    loading.value = false;
  }
}

async function loadAll(): Promise<void> {
  await loadFolders();
  await loadFiles();
}

const dirInput = ref<HTMLInputElement | null>(null);
const importVisible = ref(false);
const importResults = ref<ImportResult[]>([]);
const importSummary = reactive({ success: 0, skipped: 0, failed: 0 });

function pickDirectory(): void {
  if (folders.value.length === 0) {
    ElMessage.warning('请先创建文件夹');
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
    ElMessage.warning('请选择目标文件夹');
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
    if (importSummary.failed === 0) ElMessage.success('目录导入完成');
    else ElMessage.warning(`导入完成，${importSummary.failed} 个文件失败`);
    await loadFiles();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败');
  } finally {
    uploading.value = false;
    currentFileName.value = '';
    phase.value = '';
    percent.value = 0;
  }
}

function pickFiles(): void {
  if (folders.value.length === 0) {
    ElMessage.warning('请先创建文件夹');
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
    ElMessage.warning('请选择目标文件夹');
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
      ElMessage.success(`${file.name} 上传完成`);
    }
    await loadFiles();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传失败');
  } finally {
    uploading.value = false;
    currentFileName.value = '';
    phase.value = '';
    percent.value = 0;
  }
}

async function download(file: FileItem): Promise<void> {
  try {
    const token = getToken();
    const response = await fetch(`/api/v1/files/${file.fileId}/content`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      throw new Error('下载失败');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下载失败');
  }
}

async function remove(file: FileItem): Promise<void> {
  try {
    await api(`/files/${file.fileId}`, { method: 'DELETE' });
    ElMessage.success('已移入回收站');
    await loadFiles();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '删除失败');
  }
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

.progress {
  margin-bottom: 12px;
}

.phase {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
