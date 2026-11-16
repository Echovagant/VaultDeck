<template>
  <section>
    <div class="toolbar">
      <h1>项目</h1>
      <el-button type="primary" @click="dialogVisible = true">新建项目</el-button>
    </div>

    <el-table v-loading="loading" :data="projects">
      <el-table-column prop="projectCode" label="编码" width="150" />
      <el-table-column prop="projectName" label="项目名称" />
      <el-table-column prop="fileCount" label="文件数" width="100" />
      <el-table-column label="容量" width="120">
        <template #default="scope">{{ formatBytes(scope.row.totalBytes) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130">
        <template #default="scope">
          <el-button link type="primary" @click="openProject(scope.row.projectId)">
            查看资料
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="新建项目" width="420px">
      <el-form :model="form" label-position="top">
        <el-form-item label="项目编码">
          <el-input v-model="form.projectCode" placeholder="例如 ARCH-2026-001" />
        </el-form-item>
        <el-form-item label="项目名称">
          <el-input v-model="form.projectName" placeholder="例如 某遗址发掘" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreate">创建</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { ApiError, api, formatBytes, type ProjectSummary } from '@/api/client';

const router = useRouter();
const projects = ref<ProjectSummary[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const form = reactive({ projectCode: '', projectName: '' });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api<{ items: ProjectSummary[] }>('/projects');
    projects.value = result.items;
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '加载项目失败');
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (!form.projectCode.trim() || !form.projectName.trim()) {
    ElMessage.warning('项目编码与名称不能为空');
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
    form.projectCode = '';
    form.projectName = '';
    ElMessage.success('项目已创建');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '创建失败');
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
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.toolbar h1 {
  margin: 0;
  font-size: 20px;
}
</style>
