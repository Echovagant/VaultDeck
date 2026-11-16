<template>
  <section>
    <h1>操作日志</h1>
    <p class="hint">仅展示你有权查看的记录；审计只追加，不可修改。</p>

    <el-table v-loading="loading" :data="items">
      <el-table-column label="时间" width="180">
        <template #default="scope">{{ new Date(scope.row.occurredAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column prop="actorName" label="操作人" width="120" />
      <el-table-column prop="action" label="动作" width="160" />
      <el-table-column prop="objectType" label="对象类型" width="110" />
      <el-table-column prop="detail" label="详情" />
      <el-table-column prop="result" label="结果" width="100" />
    </el-table>

    <div class="pager">
      <el-button :disabled="page <= 1" @click="go(page - 1)">上一页</el-button>
      <span>第 {{ page }} 页 / 共 {{ total }} 条</span>
      <el-button :disabled="page * pageSize >= total" @click="go(page + 1)">下一页</el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
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
    ElMessage.error(error instanceof ApiError ? error.message : '加载日志失败');
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

<style scoped>
h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.hint {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
