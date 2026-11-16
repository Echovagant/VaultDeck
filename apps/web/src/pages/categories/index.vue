<template>
  <section>
    <div class="toolbar">
      <h1>资料分类</h1>
      <el-button type="primary" @click="openCreate">新建分类</el-button>
    </div>

    <el-table v-loading="loading" :data="items">
      <el-table-column prop="categoryCode" label="编码" width="150" />
      <el-table-column prop="categoryName" label="名称" width="180" />
      <el-table-column label="扩展名">
        <template #default="scope">
          <el-tag v-for="ext in scope.row.extensions" :key="ext" size="small" class="ext-tag">
            {{ ext }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="110">
        <template #default="scope">
          <el-tag :type="scope.row.isSystem ? 'info' : 'success'" size="small">
            {{ scope.row.isSystem ? '内置' : '自定义' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="scope">
          <el-button
            link
            type="primary"
            :disabled="scope.row.isSystem"
            @click="openEdit(scope.row)"
          >
            编辑
          </el-button>
          <el-button link type="danger" :disabled="scope.row.isSystem" @click="remove(scope.row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑分类' : '新建分类'" width="480px">
      <el-form :model="form" label-position="top">
        <el-form-item v-if="!editing" label="分类编码">
          <el-input v-model="form.categoryCode" placeholder="例如 RASTER" />
        </el-form-item>
        <el-form-item label="分类名称">
          <el-input v-model="form.categoryName" />
        </el-form-item>
        <el-form-item label="扩展名（逗号分隔）">
          <el-input v-model="form.extensions" placeholder=".tif,.img,.dem" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
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
    ElMessage.error(error instanceof ApiError ? error.message : '加载分类失败');
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
    ElMessage.warning('名称与至少一个扩展名必填');
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
    ElMessage.success('已保存');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(item: CategoryItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除分类「${item.categoryName}」？`, '删除分类', {
      type: 'warning',
    });
    await api(`/categories/${item.categoryId}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    await load();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error instanceof ApiError ? error.message : '删除失败');
  }
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

.ext-tag {
  margin-right: 6px;
  margin-bottom: 4px;
}
</style>
