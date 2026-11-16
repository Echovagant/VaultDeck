<template>
  <el-dialog
    :model-value="modelValue"
    :title="file?.fileName ?? '预览'"
    width="80%"
    top="5vh"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="cleanup"
  >
    <div v-loading="loading" class="preview-body">
      <iframe v-if="kind === 'pdf'" :src="objectUrl" class="pdf-frame" title="PDF 预览" />
      <img v-else-if="kind === 'image'" :src="objectUrl" class="image" alt="图片预览" />
      <pre v-else-if="kind === 'text'" class="text-block">{{ textContent }}</pre>
      <el-empty v-else :description="loading ? '加载中' : '该格式暂不支持在线预览，请下载后查看'" />
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button type="primary" @click="download">下载原文件</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { ref, watch } from 'vue';

import { getToken } from '@/api/client';

interface PreviewFile {
  fileId: string;
  fileName: string;
}

const props = defineProps<{
  modelValue: boolean;
  file: PreviewFile | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const TEXT_EXTENSIONS = ['txt', 'csv', 'md', 'json', 'log', 'xml', 'yaml', 'yml'];

const loading = ref(false);
const kind = ref<'pdf' | 'image' | 'text' | 'unsupported'>('unsupported');
const objectUrl = ref('');
const textContent = ref('');

function extensionOf(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '').toLowerCase() : '';
}

function cleanup(): void {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = '';
  textContent.value = '';
  kind.value = 'unsupported';
}

async function load(file: PreviewFile): Promise<void> {
  cleanup();
  loading.value = true;
  try {
    const token = getToken();
    const response = await fetch(`/api/v1/files/${file.fileId}/content`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error('加载文件失败');

    const ext = extensionOf(file.fileName);
    if (ext === 'pdf') {
      objectUrl.value = URL.createObjectURL(await response.blob());
      kind.value = 'pdf';
    } else if (IMAGE_EXTENSIONS.includes(ext)) {
      objectUrl.value = URL.createObjectURL(await response.blob());
      kind.value = 'image';
    } else if (TEXT_EXTENSIONS.includes(ext)) {
      textContent.value = (await response.text()).slice(0, 200000);
      kind.value = 'text';
    } else {
      kind.value = 'unsupported';
      await response.body?.cancel();
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '预览失败');
  } finally {
    loading.value = false;
  }
}

async function download(): Promise<void> {
  const file = props.file;
  if (!file) return;
  try {
    const token = getToken();
    const response = await fetch(`/api/v1/files/${file.fileId}/content`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error('下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下载失败');
  }
}

watch(
  () => [props.modelValue, props.file] as const,
  ([visible, file]) => {
    if (visible && file) void load(file);
    if (!visible) cleanup();
  },
  { immediate: true },
);
</script>

<style scoped>
.preview-body {
  min-height: 320px;
  max-height: 70vh;
  overflow: auto;
}

.pdf-frame {
  width: 100%;
  height: 70vh;
  border: none;
}

.image {
  display: block;
  max-width: 100%;
  margin: 0 auto;
}

.text-block {
  margin: 0;
  padding: 12px;
  background: var(--el-fill-color-lighter);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
