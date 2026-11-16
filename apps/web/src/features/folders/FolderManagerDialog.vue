<template>
  <el-dialog
    :model-value="modelValue"
    title="文件夹管理"
    width="760px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="create-row">
      <el-input v-model="newName" placeholder="新文件夹名称" class="name-input" />
      <el-select v-model="newParent" placeholder="根目录" clearable class="parent-select">
        <el-option
          v-for="folder in folders"
          :key="folder.folderId"
          :label="folder.folderName"
          :value="folder.folderId"
        />
      </el-select>
      <el-button type="primary" :loading="creating" @click="create">新建</el-button>
    </div>

    <el-table v-loading="loading" :data="folders" max-height="420">
      <el-table-column prop="folderName" label="名称" />
      <el-table-column label="上级" width="180">
        <template #default="scope">{{ parentName(scope.row) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220">
        <template #default="scope">
          <el-button link type="primary" @click="rename(scope.row)">重命名</el-button>
          <el-button link type="primary" @click="startMove(scope.row)">移动</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="moveVisible" title="移动文件夹" width="420px" append-to-body>
      <el-select v-model="moveTarget" placeholder="选择目标上级" class="name-input">
        <el-option label="根目录" value="__root__" />
        <el-option
          v-for="folder in moveOptions"
          :key="folder.folderId"
          :label="folder.folderName"
          :value="folder.folderId"
        />
      </el-select>
      <template #footer>
        <el-button @click="moveVisible = false">取消</el-button>
        <el-button type="primary" :loading="moving" @click="confirmMove">确定</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, ref, watch } from 'vue';

import { ApiError, api } from '@/api/client';

interface FolderNode {
  folderId: string;
  projectId: string;
  folderName: string;
  parentId: string | null;
  createdAt: string;
}

const props = defineProps<{ modelValue: boolean; projectId: string }>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  changed: [];
}>();

const folders = ref<FolderNode[]>([]);
const loading = ref(false);
const creating = ref(false);
const newName = ref('');
const newParent = ref('');

const moveVisible = ref(false);
const moving = ref(false);
const movingFolder = ref<FolderNode | null>(null);
const moveTarget = ref('__root__');

const moveOptions = computed(() =>
  folders.value.filter((folder) => folder.folderId !== movingFolder.value?.folderId),
);

function parentName(row: FolderNode): string {
  if (!row.parentId) return '根目录';
  return folders.value.find((folder) => folder.folderId === row.parentId)?.folderName ?? '未知';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api<{ items: FolderNode[] }>(
      `/folders?projectId=${encodeURIComponent(props.projectId)}`,
    );
    folders.value = result.items;
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '加载文件夹失败');
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  const name = newName.value.trim();
  if (!name) {
    ElMessage.warning('请输入文件夹名称');
    return;
  }
  creating.value = true;
  try {
    await api('/folders', {
      method: 'POST',
      body: JSON.stringify({
        projectId: props.projectId,
        folderName: name,
        parentId: newParent.value || null,
      }),
    });
    ElMessage.success('文件夹已创建');
    newName.value = '';
    await load();
    emit('changed');
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '创建失败');
  } finally {
    creating.value = false;
  }
}

async function rename(row: FolderNode): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('输入新的文件夹名称', '重命名', {
      inputValue: row.folderName,
      inputValidator: (value) => (value.trim().length > 0 ? true : '名称不能为空'),
    });
    await api(`/folders/${row.folderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ folderName: result.value.trim() }),
    });
    ElMessage.success('已重命名');
    await load();
    emit('changed');
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error instanceof ApiError ? error.message : '重命名失败');
  }
}

function startMove(row: FolderNode): void {
  movingFolder.value = row;
  moveTarget.value = row.parentId ?? '__root__';
  moveVisible.value = true;
}

async function confirmMove(): Promise<void> {
  const folder = movingFolder.value;
  if (!folder) return;
  moving.value = true;
  try {
    await api(`/folders/${folder.folderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId: moveTarget.value === '__root__' ? null : moveTarget.value }),
    });
    ElMessage.success('已移动');
    moveVisible.value = false;
    await load();
    emit('changed');
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '移动失败');
  } finally {
    moving.value = false;
  }
}

async function remove(row: FolderNode): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除文件夹「${row.folderName}」？`, '删除文件夹', {
      type: 'warning',
    });
    await api(`/folders/${row.folderId}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    await load();
    emit('changed');
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error instanceof ApiError ? error.message : '删除失败');
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) void load();
  },
);
</script>

<style scoped>
.create-row {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.name-input {
  flex: 1;
}

.parent-select {
  width: 200px;
}
</style>
