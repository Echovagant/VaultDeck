<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">07 / ADMIN</p>
        <h1 class="vd-page-title">账号管理</h1>
        <p class="vd-page-sub">创建账号、调整角色、停用账号、重置口令</p>
      </div>
      <div class="vd-page-actions">
        <a-button type="primary" @click="openCreate">新建账号</a-button>
      </div>
    </header>

    <div class="vd-panel">
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
              style="width: 132px"
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
            <div class="row-actions">
              <a-button type="link" @click="openReset(record)">重置口令</a-button>
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
            </div>
          </template>
        </template>
      </a-table>
    </div>

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
          <a-input-password v-model:value="form.password" placeholder="至少 8 个字符" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="resetVisible"
      title="重置口令"
      :confirm-loading="resetting"
      ok-text="确认重置"
      cancel-text="取消"
      @ok="submitReset"
    >
      <p class="reset-note">
        将为
        <strong>{{ resetTarget?.displayName }}</strong>
        （<span class="vd-mono">{{ resetTarget?.username }}</span
        >）设置新口令。
      </p>
      <p class="reset-warn">重置后该账号的全部已登录会话会立即失效，需要使用新口令重新登录。</p>
      <a-input-password v-model:value="resetPassword" placeholder="新口令，至少 8 位" />
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { Modal, message } from 'ant-design-vue';
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
const resetting = ref(false);
const dialogVisible = ref(false);
const resetVisible = ref(false);
const resetTarget = ref<UserItem | null>(null);
const resetPassword = ref('');
const form = reactive({ username: '', displayName: '', role: 'MEMBER', password: '' });

const roleOptions = [
  { label: '领队', value: 'LEADER' },
  { label: '执行领队', value: 'DEPUTY_LEADER' },
  { label: '队员', value: 'MEMBER' },
];

const columns = [
  { title: '用户名', dataIndex: 'username', key: 'username', width: 180 },
  { title: '显示名', dataIndex: 'displayName', key: 'displayName' },
  { title: '角色', key: 'role', width: 170 },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'actions', width: 200 },
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
  if (!form.username.trim() || !form.displayName.trim() || form.password.length < 8) {
    message.warning('用户名、显示名与至少 8 位口令都必填');
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

function openReset(item: UserItem): void {
  resetTarget.value = item;
  resetPassword.value = '';
  resetVisible.value = true;
}

async function submitReset(): Promise<void> {
  const target = resetTarget.value;
  if (!target) return;
  if (resetPassword.value.length < 8) {
    message.warning('新口令至少 8 位');
    return;
  }
  resetting.value = true;
  try {
    await api(`/users/${target.userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ password: resetPassword.value }),
    });
    resetVisible.value = false;
    message.success(`已重置 ${target.displayName} 的口令`);
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '重置失败');
  } finally {
    resetting.value = false;
  }
}

async function changeRole(item: UserItem, role: string): Promise<void> {
  if (role === item.role) return;
  const nextLabel = roleOptions.find((option) => option.value === role)?.label ?? role;
  const confirmed = await new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: '调整账号角色',
      content:
        role === 'LEADER'
          ? `将把「${item.displayName}」设为领队，该账号可查看全部项目并管理账号与设置。`
          : `将把「${item.displayName}」的角色改为${nextLabel}。`,
      okText: '确认调整',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
  if (!confirmed) {
    await load();
    return;
  }

  try {
    await api(`/users/${item.userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    message.success('角色已更新');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '更新失败');
  } finally {
    await load();
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
.row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.reset-note {
  margin: 0 0 6px;
  font-size: 13px;
}

.reset-warn {
  margin: 0 0 14px;
  padding: 8px 12px;
  border-left: 2px solid var(--vd-ochre);
  background: var(--vd-ochre-soft);
  color: var(--vd-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}
</style>
