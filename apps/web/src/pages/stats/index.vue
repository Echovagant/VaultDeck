<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">02 / STATISTICS</p>
        <h1 class="vd-page-title">数据统计</h1>
        <p class="vd-page-sub">按项目统计各类资料数量与容量，可导出 CSV</p>
      </div>
      <div class="vd-page-actions">
        <a-select
          v-model:value="projectId"
          placeholder="全部项目"
          allow-clear
          style="width: 200px"
          :options="projectOptions"
          @change="load"
        />
        <a-button :loading="loading" @click="load">刷新</a-button>
        <a-button type="primary" :disabled="items.length === 0" @click="exportCsv">
          导出 CSV
        </a-button>
      </div>
    </header>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="projectId"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'totalBytes'">{{ formatBytes(record.totalBytes) }}</template>
        <template v-else-if="column.key === 'trash'">
          {{ record.trashFiles }} 个 / {{ formatBytes(record.trashBytes) }}
        </template>
        <template v-else-if="column.key === 'groups'">
          <a-tag v-for="group in record.groups" :key="group.type" style="margin-bottom: 4px">
            {{ group.type }}: {{ group.count }}
          </a-tag>
          <span v-if="record.groups.length === 0" class="muted">无资料</span>
        </template>
      </template>
    </a-table>
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, onMounted, ref } from 'vue';

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
const projectId = ref<string | undefined>(undefined);
const loading = ref(false);

const columns = [
  { title: '项目编码', dataIndex: 'projectCode', key: 'projectCode', width: 160 },
  { title: '项目名称', dataIndex: 'projectName', key: 'projectName' },
  { title: '文件数', dataIndex: 'totalFiles', key: 'totalFiles', width: 100 },
  { title: '容量', key: 'totalBytes', width: 120 },
  { title: '回收站', key: 'trash', width: 170 },
  { title: '类型分布', key: 'groups' },
];

const projectOptions = computed(() =>
  projects.value.map((project) => ({ label: project.projectName, value: project.projectId })),
);

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
    message.error(error instanceof ApiError ? error.message : '加载统计失败');
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
    message.error(error instanceof Error ? error.message : '导出失败');
  }
}

onMounted(async () => {
  await loadProjects();
  await load();
});
</script>

<style scoped>
.muted {
  color: var(--vd-text-secondary);
  font-size: 13px;
}
</style>
