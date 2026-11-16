<template>
  <section>
    <div class="page-head">
      <div>
        <h1 class="vd-page-title">账号管理</h1>
        <p class="vd-page-sub">创建账号、调整角色、停用账号</p>
      </div>
      <a-button type="primary" @click="openCreate">新建账号</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="users"
      :loading="loading"
      :pagination="false"
      row-key="userId"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'role'">
          <a-select
            :value="record.role"
            size="small"
            style="width: 140px"
            :disabled="record.userId === session.user?.userId"
            :options="roleOptions"
            @change="(value: string) => changeRole(record, value)"
          />
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="record.status === 'active' ? 'success' : 'default'">
            {{ record.status === 'active' ? '启用' : '停用' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-button
            v-if="record.status === 'active'"
            type="link"
            danger
            :disabled="record.userId === session.user?.userId"
            @click="toggle(record, 'disabled')"
          >
            停用
          </a-button>
          <a-button v-else type="link" @click="toggle(record, 'active')">启用</a-button>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="dialogVisible"
      title="新建账号"
      :confirm-loading="saving"
      ok-text="创建"
      cancel-text="取消"
      @ok="createUser"
    >
      <a-form layout="vertical">
        <a-form-item label="用户名">
          <a-input v-model:value="form.username" placeholder="至少 3 个字符" />
        </a-form-item>
        <a-form-item label="显示名">
          <a-input v-model:value="form.displayName" />
        </a-form-item>
        <a-form-item label="角色">
          <a-select v-model:value="form.role" :options="roleOptions" />
        </a-form-item>
        <a-form-item label="初始口令">
          <a-input-password v-model:value="form.password" placeholder="至少 10 个字符" />
        </a-form-item>
      </a-form>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
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

const roleOptions = [
  { label: '领队', value: 'LEADER' },
  { label: '执行领队', value: 'DEPUTY_LEADER' },
  { label: '队员', value: 'MEMBER' },
];

const columns = [
  { title: '用户名', dataIndex: 'username', key: 'username', width: 180 },
  { title: '显示名', dataIndex: 'displayName', key: 'displayName' },
  { title: '角色', key: 'role', width: 180 },
  { title: '状态', key: 'status', width: 110 },
  { title: '操作', key: 'actions', width: 150 },
];

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api<{ items: UserItem[] }>('/users');
    users.value = result.items;
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载账号失败');
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
    message.warning('用户名、显示名与至少 10 位口令都必填');
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
    message.success('账号已创建');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '创建失败');
  } finally {
    saving.value = false;
  }
}

async function changeRole(item: UserItem, role: string): Promise<void> {
  try {
    await api(`/users/${item.userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    message.success('角色已更新');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '更新失败');
  }
}

async function toggle(item: UserItem, status: 'active' | 'disabled'): Promise<void> {
  try {
    await api(`/users/${item.userId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    message.success(status === 'active' ? '已启用' : '已停用');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '更新失败');
  }
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
