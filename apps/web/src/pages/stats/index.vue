<template>
  <section>
    <h1>数据统计</h1>
    <div class="toolbar">
      <el-select v-model="projectId" placeholder="全部项目" clearable @change="load">
        <el-option
          v-for="project in projects"
          :key="project.projectId"
          :label="project.projectName"
          :value="project.projectId"
        />
      </el-select>
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :disabled="items.length === 0" @click="exportCsv">
        导出 CSV
      </el-button>
    </div>

    <el-table v-loading="loading" :data="items">
      <el-table-column prop="projectCode" label="项目编码" width="150" />
      <el-table-column prop="projectName" label="项目名称" />
      <el-table-column prop="totalFiles" label="文件数" width="100" />
      <el-table-column label="容量" width="120">
        <template #default="scope">{{ formatBytes(scope.row.totalBytes) }}</template>
      </el-table-column>
      <el-table-column label="回收站" width="150">
        <template #default="scope">
          {{ scope.row.trashFiles }} 个 / {{ formatBytes(scope.row.trashBytes) }}
        </template>
      </el-table-column>
      <el-table-column label="类型分布">
        <template #default="scope">
          <el-tag v-for="group in scope.row.groups" :key="group.type" size="small" class="type-tag">
            {{ group.type }}: {{ group.count }}
          </el-tag>
          <span v-if="scope.row.groups.length === 0" class="empty">无资料</span>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';

import { ApiError, api, formatBytes, getToken, type ProjectSummary } from '@/api/client';

interface TypeGroup {
  type: string;
  count: number;
  totalBytes: number;
}

interface ProjectStat {
  projectId: string;
  projectCode: string;
  projectName: string;
  totalFiles: number;
  totalBytes: number;
  trashFiles: number;
  trashBytes: number;
  groups: TypeGroup[];
}

const projects = ref<ProjectSummary[]>([]);
const items = ref<ProjectStat[]>([]);
const projectId = ref('');
const loading = ref(false);

async function loadProjects(): Promise<void> {
  const result = await api<{ items: ProjectSummary[] }>('/projects');
  projects.value = result.items;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const query = projectId.value ? `?projectId=${encodeURIComponent(projectId.value)}` : '';
    const result = await api<{ items: ProjectStat[] }>(`/stats/projects${query}`);
    items.value = result.items;
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '加载统计失败');
  } finally {
    loading.value = false;
  }
}

async function exportCsv(): Promise<void> {
  try {
    const body: { projectId?: string } = {};
    if (projectId.value) body.projectId = projectId.value;

    const created = await api<{ exportId: string }>('/stats/exports', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const token = getToken();
    const response = await fetch(`/api/v1/stats/exports/${created.exportId}/content`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error('导出失败');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'vaultdeck-stats.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导出失败');
  }
}

onMounted(async () => {
  await loadProjects();
  await load();
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

.type-tag {
  margin-right: 6px;
  margin-bottom: 4px;
}

.empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
