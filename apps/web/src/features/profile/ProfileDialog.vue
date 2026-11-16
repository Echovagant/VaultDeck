<template>
  <a-modal
    :open="modelValue"
    title="个人资料"
    width="480px"
    :footer="null"
    @update:open="emit('update:modelValue', $event)"
  >
    <div class="avatar-row">
      <a-avatar :size="64" :src="session.avatarBlobUrl || undefined">
        {{ initials }}
      </a-avatar>
      <div class="avatar-actions">
        <a-upload :show-upload-list="false" accept="image/png,image/jpeg" :before-upload="onAvatar">
          <a-button size="small" :loading="uploading">更换头像</a-button>
        </a-upload>
        <p class="hint">PNG / JPEG，不超过 2 MB</p>
      </div>
    </div>

    <a-divider />

    <a-form layout="vertical">
      <a-form-item label="显示名">
        <a-input v-model:value="displayName" :maxlength="64" />
      </a-form-item>
      <a-button type="primary" :loading="savingProfile" @click="saveProfile"> 保存显示名 </a-button>
    </a-form>

    <a-divider />

    <a-form layout="vertical">
      <a-form-item label="当前口令">
        <a-input-password v-model:value="pwd.current" autocomplete="current-password" />
      </a-form-item>
      <a-form-item label="新口令（至少 10 位）">
        <a-input-password v-model:value="pwd.next" autocomplete="new-password" />
      </a-form-item>
      <a-form-item label="确认新口令">
        <a-input-password v-model:value="pwd.confirm" autocomplete="new-password" />
      </a-form-item>
      <a-button :loading="savingPwd" @click="savePassword">修改口令</a-button>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, reactive, ref, watch } from 'vue';

import { ApiError } from '@/api/client';
import { useSessionStore } from '@/stores/session';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const session = useSessionStore();
const displayName = ref('');
const uploading = ref(false);
const savingProfile = ref(false);
const savingPwd = ref(false);
const pwd = reactive({ current: '', next: '', confirm: '' });

const initials = computed(() => session.user?.displayName?.slice(0, 1) ?? 'U');

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) displayName.value = session.user?.displayName ?? '';
  },
);

async function onAvatar(file: File): Promise<boolean> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    message.warning('仅支持 PNG 或 JPEG 图片');
    return false;
  }
  if (file.size > 2 * 1024 * 1024) {
    message.warning('头像不能超过 2 MB');
    return false;
  }

  uploading.value = true;
  try {
    await session.uploadAvatar(file);
    message.success('头像已更新');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '头像上传失败');
  } finally {
    uploading.value = false;
  }
  return false;
}

async function saveProfile(): Promise<void> {
  const name = displayName.value.trim();
  if (!name) {
    message.warning('显示名不能为空');
    return;
  }
  savingProfile.value = true;
  try {
    await session.updateProfile(name);
    message.success('显示名已更新');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '更新失败');
  } finally {
    savingProfile.value = false;
  }
}

async function savePassword(): Promise<void> {
  if (!pwd.current) {
    message.warning('请输入当前口令');
    return;
  }
  if (pwd.next.length < 10) {
    message.warning('新口令至少 10 位');
    return;
  }
  if (pwd.next !== pwd.confirm) {
    message.warning('两次输入的新口令不一致');
    return;
  }

  savingPwd.value = true;
  try {
    await session.changePassword(pwd.current, pwd.next);
    message.success('口令已修改');
    pwd.current = '';
    pwd.next = '';
    pwd.confirm = '';
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '修改口令失败');
  } finally {
    savingPwd.value = false;
  }
}
</script>

<style scoped>
.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hint {
  margin: 0;
  color: var(--vd-text-secondary);
  font-size: 12px;
}
</style>
