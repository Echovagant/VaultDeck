<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">04 / TRASH</p>
        <h1 class="vd-page-title">回收站</h1>
        <p class="vd-page-sub">删除的文件保留 10 天，到期后由系统自动清除</p>
      </div>
    </header>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="fileId"
      style="margin-top: 20px"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'sizeBytes'">{{ formatBytes(record.sizeBytes) }}</template>
        <template v-else-if="column.key === 'deletedAt'">
          {{ record.deletedAt ? new Date(record.deletedAt).toLocaleString() : '-' }}
        </template>
        <template v-else-if="column.key === 'expireAt'">
          {{ record.expireAt ? new Date(record.expireAt).toLocaleString() : '-' }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <div class="row-actions">
            <a-button type="link" class="restore-link" @click="restore(record.fileId)"
              >恢复</a-button
            >
            <a-button type="link" danger @click="purge(record.fileId)">彻底删除</a-button>
          </div>
        </template>
      </template>
    </a-table>
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { onMounted, ref } from 'vue';

import { ApiError, api, formatBytes } from '@/api/client';

interface TrashItem {
  trashId: string;
  fileId: string;
  fileName: string;
  sizeBytes: number;
  deletedAt: string | null;
  expireAt: string | null;
}

const items = ref<TrashItem[]>([]);
const loading = ref(false);

const columns = [
  { title: '文件名', dataIndex: 'fileName', key: 'fileName' },
  { title: '大小', key: 'sizeBytes', width: 120 },
  { title: '删除时间', key: 'deletedAt', width: 190 },
  { title: '到期时间', key: 'expireAt', width: 190 },
  { title: '操作', key: 'actions', width: 170 },
];

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api<{ items: TrashItem[] }>('/trash');
    items.value = result.items;
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载回收站失败');
  } finally {
    loading.value = false;
  }
}

async function restore(fileId: string): Promise<void> {
  try {
    await api(`/trash/${fileId}/restore`, { method: 'POST' });
    message.success('已恢复');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '恢复失败');
  }
}

async function purge(fileId: string): Promise<void> {
  try {
    await api(`/trash/${fileId}`, { method: 'DELETE' });
    message.success('已彻底删除');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除失败');
  }
}

onMounted(load);
</script>
<style scoped>
.row-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* 恢复是正向操作，用墨绿；彻底删除保留 danger 砖红，两者不再混淆 */
.restore-link {
  color: #3f6b45 !important;
  font-weight: 500;
}

.restore-link:hover {
  color: #2f5436 !important;
  background: #eef3ea !important;
}
</style>
