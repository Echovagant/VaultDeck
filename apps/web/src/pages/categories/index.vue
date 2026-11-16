<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">03 / CATEGORIES</p>
        <h1 class="vd-page-title">资料分类</h1>
        <p class="vd-page-sub">内置分类不可修改；自定义分类可增删改</p>
      </div>
      <div class="vd-page-actions">
        <a-button type="primary" @click="openCreate">新建分类</a-button>
      </div>
    </header>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="categoryId"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'extensions'">
          <a-tag v-for="ext in record.extensions" :key="ext" style="margin-bottom: 4px">
            {{ ext }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'kind'">
          <a-tag :color="record.isSystem ? 'default' : 'success'">
            {{ record.isSystem ? '内置' : '自定义' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'actions'">
          <div class="row-actions">
            <a-button
              type="link"
              class="edit-link"
              :disabled="record.isSystem"
              @click="openEdit(record)"
            >
              编辑
            </a-button>
            <a-button type="link" danger :disabled="record.isSystem" @click="remove(record)">
              删除
            </a-button>
          </div>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="dialogVisible"
      :title="editing ? '编辑分类' : '新建分类'"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      @ok="save"
    >
      <a-form layout="vertical">
        <a-form-item v-if="!editing" label="分类编码">
          <a-input v-model:value="form.categoryCode" placeholder="例如 RASTER" />
        </a-form-item>
        <a-form-item label="分类名称">
          <a-input v-model:value="form.categoryName" />
        </a-form-item>
        <a-form-item label="扩展名（逗号分隔）">
          <a-input v-model:value="form.extensions" placeholder=".tif,.img,.dem" />
        </a-form-item>
      </a-form>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { Modal, message } from 'ant-design-vue';
import { onMounted, reactive, ref } from 'vue';

import { ApiError, api } from '@/api/client';

interface CategoryItem {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  extensions: string[];
  isSystem: boolean;
}

const items = ref<CategoryItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref<CategoryItem | null>(null);
const form = reactive({ categoryCode: '', categoryName: '', extensions: '' });

const columns = [
  { title: '编码', dataIndex: 'categoryCode', key: 'categoryCode', width: 160 },
  { title: '名称', dataIndex: 'categoryName', key: 'categoryName', width: 180 },
  { title: '扩展名', key: 'extensions' },
  { title: '类型', key: 'kind', width: 110 },
  { title: '操作', key: 'actions', width: 150 },
];

function parseExtensions(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .map((item) => (item.startsWith('.') ? item : `.${item}`));
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    items.value = await api<CategoryItem[]>('/categories');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载分类失败');
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  form.categoryCode = '';
  form.categoryName = '';
  form.extensions = '';
  dialogVisible.value = true;
}

function openEdit(item: CategoryItem): void {
  editing.value = item;
  form.categoryCode = item.categoryCode;
  form.categoryName = item.categoryName;
  form.extensions = item.extensions.join(',');
  dialogVisible.value = true;
}

async function save(): Promise<void> {
  const extensions = parseExtensions(form.extensions);
  if (!form.categoryName.trim() || extensions.length === 0) {
    message.warning('名称与至少一个扩展名必填');
    return;
  }

  saving.value = true;
  try {
    if (editing.value) {
      await api(`/categories/${editing.value.categoryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ categoryName: form.categoryName.trim(), extensions }),
      });
    } else {
      await api('/categories', {
        method: 'POST',
        body: JSON.stringify({
          categoryCode: form.categoryCode.trim().toUpperCase(),
          categoryName: form.categoryName.trim(),
          extensions,
        }),
      });
    }
    dialogVisible.value = false;
    message.success('已保存');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(item: CategoryItem): Promise<void> {
  const confirmed = await new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: '删除分类',
      content: `将删除分类「${item.categoryName}」，该操作不可恢复；已有文件不受影响。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
  if (!confirmed) return;

  try {
    await api(`/categories/${item.categoryId}`, { method: 'DELETE' });
    message.success('已删除');
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

/* 编辑是中性操作，用墨色；删除保留 danger 砖红，两者不再混淆 */
.edit-link {
  color: #5a4f42 !important;
  font-weight: 500;
}

.edit-link:hover {
  color: var(--vd-text) !important;
  background: var(--vd-surface-sunken) !important;
}
</style>
