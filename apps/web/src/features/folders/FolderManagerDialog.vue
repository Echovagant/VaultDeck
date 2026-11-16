<template>
  <a-modal
    :open="modelValue"
    title="文件夹管理"
    width="760px"
    :footer="null"
    @update:open="emit('update:modelValue', $event)"
  >
    <div class="create-row">
      <a-input v-model:value="newName" placeholder="新文件夹名称" class="name-input" />
      <a-select
        v-model:value="newParent"
        placeholder="根目录"
        allow-clear
        class="parent-select"
        :options="parentOptions"
      />
      <a-button type="primary" :loading="creating" @click="create">新建</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="folders"
      :loading="loading"
      :pagination="false"
      row-key="folderId"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'parent'">{{ parentName(record) }}</template>
        <template v-else-if="column.key === 'actions'">
          <a-button type="link" @click="startRename(record)">重命名</a-button>
          <a-button type="link" @click="startMove(record)">移动</a-button>
          <a-button type="link" danger @click="remove(record)">删除</a-button>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="renameVisible"
      title="重命名文件夹"
      :confirm-loading="renaming"
      ok-text="保存"
      cancel-text="取消"
      @ok="confirmRename"
    >
      <a-input v-model:value="renameValue" placeholder="新的文件夹名称" />
    </a-modal>

    <a-modal
      v-model:open="moveVisible"
      title="移动文件夹"
      :confirm-loading="moving"
      ok-text="确定"
      cancel-text="取消"
      @ok="confirmMove"
    >
      <a-select
        v-model:value="moveTarget"
        placeholder="选择目标上级"
        style="width: 100%"
        :options="moveOptions"
      />
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { Modal, message } from 'ant-design-vue';
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
const newParent = ref<string | undefined>(undefined);

const renameVisible = ref(false);
const renaming = ref(false);
const renamingFolder = ref<FolderNode | null>(null);
const renameValue = ref('');

const moveVisible = ref(false);
const moving = ref(false);
const movingFolder = ref<FolderNode | null>(null);
const moveTarget = ref('__root__');

const columns = [
  { title: '名称', dataIndex: 'folderName', key: 'folderName' },
  { title: '上级', key: 'parent', width: 200 },
  { title: '操作', key: 'actions', width: 220 },
];

const parentOptions = computed(() =>
  folders.value.map((folder) => ({ label: folder.folderName, value: folder.folderId })),
);

const moveOptions = computed(() => {
  const options = [{ label: '根目录', value: '__root__' }];
  for (const folder of folders.value) {
    if (folder.folderId === movingFolder.value?.folderId) continue;
    options.push({ label: folder.folderName, value: folder.folderId });
  }
  return options;
});

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
    message.error(error instanceof ApiError ? error.message : '加载文件夹失败');
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  const name = newName.value.trim();
  if (!name) {
    message.warning('请输入文件夹名称');
    return;
  }
  creating.value = true;
  try {
    await api('/folders', {
      method: 'POST',
      body: JSON.stringify({
        projectId: props.projectId,
        folderName: name,
        parentId: newParent.value ?? null,
      }),
    });
    message.success('文件夹已创建');
    newName.value = '';
    await load();
    emit('changed');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '创建失败');
  } finally {
    creating.value = false;
  }
}

function startRename(row: FolderNode): void {
  renamingFolder.value = row;
  renameValue.value = row.folderName;
  renameVisible.value = true;
}

async function confirmRename(): Promise<void> {
  const folder = renamingFolder.value;
  const name = renameValue.value.trim();
  if (!folder || !name) return;

  renaming.value = true;
  try {
    await api(`/folders/${folder.folderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ folderName: name }),
    });
    message.success('已重命名');
    renameVisible.value = false;
    await load();
    emit('changed');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '重命名失败');
  } finally {
    renaming.value = false;
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
      body: JSON.stringify({
        parentId: moveTarget.value === '__root__' ? null : moveTarget.value,
      }),
    });
    message.success('已移动');
    moveVisible.value = false;
    await load();
    emit('changed');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '移动失败');
  } finally {
    moving.value = false;
  }
}

function remove(row: FolderNode): void {
  Modal.confirm({
    title: '删除文件夹',
    content: `确定删除文件夹「${row.folderName}」？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await api(`/folders/${row.folderId}`, { method: 'DELETE' });
        message.success('已删除');
        await load();
        emit('changed');
      } catch (error) {
        message.error(error instanceof ApiError ? error.message : '删除失败');
        throw error;
      }
    },
  });
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
