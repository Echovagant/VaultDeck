<template>
  <section>
    <h1 class="vd-page-title">操作日志</h1>
    <p class="vd-page-sub">仅展示你有权查看的记录；审计只追加，不可修改</p>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      row-key="auditId"
      style="margin-top: 20px"
      :pagination="{
        current: page,
        pageSize,
        total,
        showSizeChanger: false,
        showTotal: (value: number) => `共 ${value} 条`,
        onChange: go,
      }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'occurredAt'">
          {{ new Date(record.occurredAt).toLocaleString() }}
        </template>
        <template v-else-if="column.key === 'result'">
          <a-tag :color="record.result === 'success' ? 'success' : 'error'">
            {{ record.result === 'success' ? '成功' : '失败' }}
          </a-tag>
        </template>
      </template>
    </a-table>
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { onMounted, ref } from 'vue';

import { ApiError, api } from '@/api/client';

interface AuditItem {
  auditId: string;
  actorName: string;
  action: string;
  objectType: string;
  objectId: string;
  result: string;
  detail: string;
  occurredAt: string;
}

const items = ref<AuditItem[]>([]);
const page = ref(1);
const pageSize = ref(50);
const total = ref(0);
const loading = ref(false);

const columns = [
  { title: '时间', key: 'occurredAt', width: 190 },
  { title: '操作人', dataIndex: 'actorName', key: 'actorName', width: 120 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 170 },
  { title: '对象类型', dataIndex: 'objectType', key: 'objectType', width: 110 },
  { title: '详情', dataIndex: 'detail', key: 'detail' },
  { title: '结果', key: 'result', width: 100 },
];

async function load(targetPage = page.value): Promise<void> {
  loading.value = true;
  try {
    const result = await api<{ items: AuditItem[]; total: number; page: number }>(
      `/audit?page=${targetPage}&pageSize=${pageSize.value}`,
    );
    items.value = result.items;
    total.value = result.total;
    page.value = result.page ?? targetPage;
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载日志失败');
  } finally {
    loading.value = false;
  }
}

function go(target: number): void {
  void load(target);
}

onMounted(() => {
  void load(1);
});
</script>
