<template>
  <section>
    <div class="toolbar">
      <h1>账号管理</h1>
      <el-button type="primary" @click="openCreate">新建账号</el-button>
    </div>

    <el-table v-loading="loading" :data="users">
      <el-table-column prop="username" label="用户名" width="170" />
      <el-table-column prop="displayName" label="显示名" />
      <el-table-column label="角色" width="170">
        <template #default="scope">
          <el-select
            :model-value="scope.row.role"
            size="small"
            :disabled="scope.row.userId === session.user?.userId"
            @change="(value: string) => changeRole(scope.row, value)"
          >
            <el-option label="领队" value="LEADER" />
            <el-option label="执行领队" value="DEPUTY_LEADER" />
            <el-option label="队员" value="MEMBER" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="scope">
          <el-tag :type="scope.row.status === 'active' ? 'success' : 'info'">
            {{ scope.row.status === 'active' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'active'"
            link
            type="danger"
            :disabled="scope.row.userId === session.user?.userId"
            @click="toggle(scope.row, 'disabled')"
          >
            停用
          </el-button>
          <el-button v-else link type="primary" @click="toggle(scope.row, 'active')">
            启用
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="新建账号" width="440px">
      <el-form :model="form" label-position="top">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="至少 3 个字符" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.displayName" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role">
            <el-option label="领队" value="LEADER" />
            <el-option label="执行领队" value="DEPUTY_LEADER" />
            <el-option label="队员" value="MEMBER" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始口令">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="至少 10 个字符"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createUser">创建</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import { ApiError, api } from '@/api/client';
import { useSessionStore } from '@/stores/session';

interface UserItem {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  status: 'active' | 'disabled';
}

const session = useSessionStore();
const users = ref<UserItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const form = reactive({ username: '', displayName: '', role: 'MEMBER', password: '' });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api<{ items: UserItem[] }>('/users');
    users.value = result.items;
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '加载账号失败');
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  form.username = '';
  form.displayName = '';
  form.role = 'MEMBER';
  form.password = '';
  dialogVisible.value = true;
}

async function createUser(): Promise<void> {
  if (!form.username.trim() || !form.displayName.trim() || form.password.length < 10) {
    ElMessage.warning('用户名、显示名与至少 10 位口令都必填');
    return;
  }
  saving.value = true;
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        role: form.role,
        password: form.password,
      }),
    });
    dialogVisible.value = false;
    ElMessage.success('账号已创建');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '创建失败');
  } finally {
    saving.value = false;
  }
}

async function changeRole(item: UserItem, role: string): Promise<void> {
  try {
    await api(`/users/${item.userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    ElMessage.success('角色已更新');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '更新失败');
  }
}

async function toggle(item: UserItem, status: 'active' | 'disabled'): Promise<void> {
  try {
    await api(`/users/${item.userId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    ElMessage.success(status === 'active' ? '已启用' : '已停用');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '更新失败');
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
</style>
