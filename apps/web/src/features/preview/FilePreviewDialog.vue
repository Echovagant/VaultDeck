<template>
  <a-modal
    :open="modelValue"
    :title="file?.fileName ?? '预览'"
    width="80%"
    :footer="null"
    @update:open="emit('update:modelValue', $event)"
    @after-close="cleanup"
  >
    <a-spin :spinning="loading">
      <div class="preview-body">
        <iframe v-if="kind === 'pdf'" :src="objectUrl" class="pdf-frame" title="PDF 预览" />
        <img v-else-if="kind === 'image'" :src="objectUrl" class="image" alt="图片预览" />
        <pre v-else-if="kind === 'text'" class="text-block">{{ textContent }}</pre>
        <div v-else-if="kind === 'docx'" ref="docxContainer" class="docx-container" />
        <div v-else-if="kind === 'sheet'" class="sheet-container">
          <div v-if="sheetNames.length > 1" class="sheet-tabs">
            <a-button
              v-for="(name, index) in sheetNames"
              :key="`${name}-${index}`"
              size="small"
              :type="index === activeSheet ? 'primary' : 'default'"
              @click="selectSheet(index)"
            >
              {{ name }}
            </a-button>
          </div>
          <div class="sheet-table" v-html="sheetHtml" />
          <p v-if="sheetNote" class="sheet-note">{{ sheetNote }}</p>
        </div>
        <a-empty v-else :description="unsupportedText" />
      </div>
    </a-spin>

    <div class="preview-footer">
      <a-button @click="emit('update:modelValue', false)">关闭</a-button>
      <a-button type="primary" @click="download">下载原文件</a-button>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { nextTick, ref, watch } from 'vue';

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
// 浏览器端可直接渲染的 Office 格式
const CLIENT_OFFICE_EXTENSIONS = ['docx', 'xlsx'];
// 需要服务端高保真转换（LibreOffice 可选）；未启用时提示下载
const SERVER_EXTENSIONS = ['doc', 'xls', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf'];

const EXCEL_MAX_ROWS = 500;
const EXCEL_MAX_COLS = 50;

type PreviewKind = 'pdf' | 'image' | 'text' | 'docx' | 'sheet' | 'unsupported';

const loading = ref(false);
const kind = ref<PreviewKind>('unsupported');
const unsupportedText = ref('该格式暂不支持在线预览，请下载后查看');
const objectUrl = ref('');
const textContent = ref('');
const docxContainer = ref<HTMLElement | null>(null);
const sheetHtml = ref('');
const sheetNote = ref('');
const sheetNames = ref<string[]>([]);
const activeSheet = ref(0);
let workbook: import('exceljs').Workbook | null = null;
let officeServerCache: boolean | null = null;

function extensionOf(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '').toLowerCase() : '';
}

function cleanup(): void {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = '';
  textContent.value = '';
  sheetHtml.value = '';
  sheetNote.value = '';
  sheetNames.value = [];
  activeSheet.value = 0;
  workbook = null;
  if (docxContainer.value) docxContainer.value.innerHTML = '';
  kind.value = 'unsupported';
}

async function officeServerAvailable(): Promise<boolean> {
  if (officeServerCache !== null) return officeServerCache;
  try {
    const response = await fetch('/api/v1/system/health');
    const health = await response.json();
    officeServerCache = Boolean(health?.preview?.officeServer);
  } catch {
    officeServerCache = false;
  }
  return officeServerCache;
}

async function fetchContent(file: PreviewFile): Promise<Response> {
  // purpose=preview 让服务端把这次访问记为 file.preview 而不是 file.download
  return fetch(`/api/v1/files/${file.fileId}/content?purpose=preview`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[character] ?? character;
  });
}

function renderSheet(): void {
  const sheet = workbook?.worksheets[activeSheet.value];
  if (!sheet) return;
  const rowCount = Math.min(sheet.rowCount, EXCEL_MAX_ROWS);
  const columnCount = Math.min(sheet.columnCount, EXCEL_MAX_COLS);
  const rows: string[] = [];
  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const cells: string[] = [];
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      cells.push(`<td>${escapeHtml(row.getCell(columnIndex).text ?? '')}</td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  sheetHtml.value = `<table><tbody>${rows.join('')}</tbody></table>`;
  sheetNote.value =
    sheet.rowCount > EXCEL_MAX_ROWS || sheet.columnCount > EXCEL_MAX_COLS
      ? `表格较大，仅显示前 ${rowCount} 行 / ${columnCount} 列，完整内容请下载查看`
      : '';
}

function selectSheet(index: number): void {
  activeSheet.value = index;
  renderSheet();
}

async function renderDocx(buffer: ArrayBuffer): Promise<void> {
  kind.value = 'docx';
  await nextTick();
  const container = docxContainer.value;
  if (!container) throw new Error('预览容器未就绪');
  container.innerHTML = '';
  const { renderAsync } = await import('docx-preview');
  // 连续文档流模式：不模拟 A4 纸张（纸张模式在宽弹窗里两侧大片留白），
  // 忽略文档固定页宽页高，内容像网页一样铺满弹窗。
  await renderAsync(buffer, container, undefined, {
    inWrapper: false,
    breakPages: false,
    ignoreWidth: true,
    ignoreHeight: true,
    ignoreLastRenderedPageBreak: true,
    renderHeaders: false,
    renderFooters: false,
  });
}

async function renderXlsx(buffer: ArrayBuffer): Promise<void> {
  const ExcelJS = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  workbook = book;
  sheetNames.value = book.worksheets.map((sheet) => sheet.name);
  activeSheet.value = 0;
  kind.value = 'sheet';
  renderSheet();
}

async function load(file: PreviewFile): Promise<void> {
  cleanup();
  unsupportedText.value = '该格式暂不支持在线预览，请下载后查看';
  loading.value = true;
  try {
    const ext = extensionOf(file.fileName);

    if (ext === 'pdf') {
      const response = await fetchContent(file);
      if (!response.ok) throw new Error('加载文件失败');
      objectUrl.value = URL.createObjectURL(await response.blob());
      kind.value = 'pdf';
      return;
    }

    if (IMAGE_EXTENSIONS.includes(ext)) {
      const response = await fetchContent(file);
      if (!response.ok) throw new Error('加载文件失败');
      objectUrl.value = URL.createObjectURL(await response.blob());
      kind.value = 'image';
      return;
    }

    if (TEXT_EXTENSIONS.includes(ext)) {
      const response = await fetchContent(file);
      if (!response.ok) throw new Error('加载文件失败');
      textContent.value = (await response.text()).slice(0, 200000);
      kind.value = 'text';
      return;
    }

    if (CLIENT_OFFICE_EXTENSIONS.includes(ext)) {
      const response = await fetchContent(file);
      if (!response.ok) throw new Error('加载文件失败');
      const buffer = await response.arrayBuffer();
      if (ext === 'docx') await renderDocx(buffer);
      else await renderXlsx(buffer);
      return;
    }

    if (SERVER_EXTENSIONS.includes(ext)) {
      if (!(await officeServerAvailable())) {
        unsupportedText.value = '该格式需要服务端高保真转换（当前未启用），请下载后查看';
        kind.value = 'unsupported';
        return;
      }
      const response = await fetch(`/api/v1/files/${file.fileId}/preview`);
      if (!response.ok) {
        unsupportedText.value = '服务端转换暂不可用，请下载后查看';
        kind.value = 'unsupported';
        await response.body?.cancel();
        return;
      }
      objectUrl.value = URL.createObjectURL(await response.blob());
      kind.value = 'pdf';
      return;
    }

    kind.value = 'unsupported';
  } catch (error) {
    kind.value = 'unsupported';
    unsupportedText.value = '预览失败，请下载后查看';
    message.error(error instanceof Error ? error.message : '预览失败');
  } finally {
    loading.value = false;
  }
}

async function download(): Promise<void> {
  const file = props.file;
  if (!file) return;
  try {
    const response = await fetch(`/api/v1/files/${file.fileId}/content`);
    if (!response.ok) throw new Error('下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '下载失败');
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
  background: var(--vd-surface-sunken);
  font-family: var(--vd-font-mono);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}

.docx-container {
  max-height: 65vh;
  padding: 20px 28px;
  overflow: auto;
  background: var(--vd-surface);
  border: 1px solid var(--vd-border);
  border-radius: 6px;
}

.docx-container :deep(.docx-wrapper) {
  padding: 0;
  background: transparent;
}

.docx-container :deep(p) {
  margin: 0 0 10px;
  line-height: 1.9;
}

.sheet-container {
  max-height: 65vh;
  overflow: auto;
}

.sheet-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.sheet-table :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.sheet-table :deep(td) {
  padding: 4px 8px;
  border: 1px solid var(--vd-border);
  white-space: nowrap;
}

.sheet-table :deep(tr:first-child td) {
  background: var(--vd-surface-sunken);
  font-weight: 600;
}

.sheet-note {
  margin: 8px 0 0;
  color: var(--vd-text-secondary);
  font-size: 12px;
}

.preview-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
</style>
