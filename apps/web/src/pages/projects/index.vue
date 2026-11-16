<template>
  <section>
    <div class="page-head">
      <div>
        <h1 class="vd-page-title">项目</h1>
        <p class="vd-page-sub">按项目归档资料；领队可查看全部项目</p>
      </div>
      <a-button v-if="session.user?.role === 'LEADER'" type="primary" @click="openCreate">
        新建项目
      </a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="projects"
      :loading="loading"
      :pagination="false"
      row-key="projectId"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'totalBytes'">
          {{ formatBytes(record.totalBytes) }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-button type="link" @click="openProject(record.projectId)">查看资料</a-button>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="dialogVisible"
      title="新建项目"
      :confirm-loading="saving"
      ok-text="创建"
      cancel-text="取消"
      @ok="onCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="项目编码">
          <a-input v-model:value="form.projectCode" placeholder="例如 ARCH-2026-001" />
        </a-form-item>
        <a-form-item label="项目名称">
          <a-input v-model:value="form.projectName" placeholder="例如 某遗址发掘" />
        </a-form-item>
      </a-form>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { ApiError, api, formatBytes, type ProjectSummary } from '@/api/client';
import { useSessionStore } from '@/stores/session';

const router = useRouter();
const session = useSessionStore();
const projects = ref<ProjectSummary[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const form = reactive({ projectCode: '', projectName: '' });

const columns = [
  { title: '编码', dataIndex: 'projectCode', key: 'projectCode', width: 170 },
  { title: '项目名称', dataIndex: 'projectName', key: 'projectName' },
  { title: '文件数', dataIndex: 'fileCount', key: 'fileCount', width: 110 },
  { title: '容量', key: 'totalBytes', width: 130 },
  { title: '操作', key: 'actions', width: 140 },
];

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api<{ items: ProjectSummary[] }>('/projects');
    projects.value = result.items;
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载项目失败');
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  form.projectCode = '';
  form.projectName = '';
  dialogVisible.value = true;
}

async function onCreate(): Promise<void> {
  if (!form.projectCode.trim() || !form.projectName.trim()) {
    message.warning('项目编码与名称不能为空');
    return;
  }
  saving.value = true;
  try {
    await api('/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectCode: form.projectCode.trim(),
        projectName: form.projectName.trim(),
      }),
    });
    dialogVisible.value = false;
    message.success('项目已创建');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '创建失败');
  } finally {
    saving.value = false;
  }
}

function openProject(projectId: string): void {
  void router.push(`/projects/${projectId}/files`);
}

onMounted(load);
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}
</style>
