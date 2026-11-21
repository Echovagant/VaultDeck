<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">06 / SETTINGS</p>
        <h1 class="vd-page-title">系统设置</h1>
        <p class="vd-page-sub">上传、回收站与运行状态；修改后立即生效</p>
      </div>
    </header>

    <div class="settings-grid">
      <div class="settings-panel">
        <h2 class="settings-title">上传与存储</h2>
        <a-form layout="vertical" :model="form">
          <a-form-item label="单文件上传上限（GB）">
            <a-input-number
              v-model:value="form.maxUploadGb"
              :min="0.1"
              :max="200"
              :step="0.5"
              style="width: 100%"
            />
            <p class="settings-hint">超过上限的文件会在预检阶段被拒绝。</p>
          </a-form-item>
          <a-form-item label="分片大小（MB）">
            <a-input-number
              v-model:value="form.chunkSizeMb"
              :min="1"
              :max="64"
              :step="1"
              style="width: 100%"
            />
            <p class="settings-hint">只影响之后新建的上传会话。</p>
          </a-form-item>
          <a-form-item label="启用秒传">
            <a-switch v-model:checked="form.instantUploadEnabled" />
            <p class="settings-hint">
              仅对系统中已存在的相同文件生效（校验同哈希后不再传输内容）；单文件上限
              {{
                form.maxUploadGb
              }}
              GB。命中前仍需在浏览器计算文件指纹，大文件需要数十秒；首次上传按实际大小传输，速率以进度旁实测为准。
            </p>
          </a-form-item>
        </a-form>
      </div>

      <div class="settings-panel">
        <h2 class="settings-title">回收站</h2>
        <a-form layout="vertical" :model="form">
          <a-form-item label="保留天数">
            <a-input-number
              v-model:value="form.trashRetentionDays"
              :min="1"
              :max="365"
              style="width: 100%"
            />
          </a-form-item>
        </a-form>

        <ul class="settings-notes">
          <li>天数只影响之后删除的文件，已删除文件的到期时间不会回溯调整。</li>
          <li>到期后由系统清除对象与记录，清除后不可恢复。</li>
          <li>回收站内文件仍占用容量，不计入项目目录统计。</li>
        </ul>
      </div>

      <div class="settings-panel">
        <h2 class="settings-title">系统状态</h2>
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">服务状态</span>
            <span class="status-value status-ok">{{ health ? '运行中' : '读取中' }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">持续运行</span>
            <span class="status-value">{{ uptimeText }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">活跃会话</span>
            <span class="status-value">{{ health?.activeSessions ?? '—' }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">存储卷剩余</span>
            <span class="status-value">{{ freeSpaceText }}</span>
          </div>
        </div>
        <p class="settings-hint">状态为只读，刷新页面重新采集；会话数包含所有已登录设备。</p>
      </div>

      <div class="settings-panel">
        <h2 class="settings-title">账号安全</h2>
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">双重验证</span>
            <span class="status-value">{{ mfaEnabled ? '已启用' : '未启用' }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">验证方式</span>
            <span class="status-value">TOTP 动态码</span>
          </div>
        </div>
        <p class="settings-hint">
          启用后，登录时除口令外还需输入身份验证器中的 6 位动态码。密钥仅以加密形式保存在服务端。
        </p>
        <a-button v-if="!mfaEnabled" class="mfa-action" @click="openMfaSetup">
          启用双重验证
        </a-button>
        <a-button v-else danger class="mfa-action" @click="openMfaDisable"> 停用双重验证 </a-button>
      </div>

      <div v-if="isLeader" class="settings-panel">
        <h2 class="settings-title">AI 服务</h2>
        <a-form layout="vertical">
          <a-form-item label="供应商">
            <a-select
              v-model:value="aiForm.providerId"
              :options="providerOptions"
              placeholder="选择模型供应商"
              allow-clear
              @change="onProviderChange"
            />
          </a-form-item>
          <a-form-item v-if="selectedProvider?.customEndpoint" label="接入点地址">
            <a-input
              v-model:value="aiForm.baseUrl"
              placeholder="OpenAI 兼容端点，如 http://127.0.0.1:8000/v1"
              allow-clear
            />
          </a-form-item>
          <a-form-item label="模型">
            <a-auto-complete
              v-model:value="aiForm.model"
              :options="modelOptions"
              placeholder="保存后可拉取清单，或直接手填模型名"
            />
          </a-form-item>
          <a-form-item v-if="selectedProvider?.effortLevels" label="思考强度">
            <a-select
              v-model:value="aiForm.effort"
              :options="effortOptions"
              placeholder="跟随供应商默认"
              allow-clear
            />
          </a-form-item>
          <a-form-item label="API Key">
            <a-input-password
              v-model:value="aiForm.apiKey"
              placeholder="粘贴密钥后保存；已保存的不回显"
              autocomplete="new-password"
            />
          </a-form-item>
        </a-form>

        <a-alert
          v-if="aiBundle && !aiBundle.encryptionEnabled"
          type="warning"
          show-icon
          class="ai-alert"
          message="未配置加密密钥（VD_ENCRYPTION_KEY），无法保存 API Key"
        />
        <p v-else-if="selectedProvider && selectedProvider.family !== 'local'" class="settings-hint">
          使用该供应商时，查询语句会发送给该厂商；本机 Ollama 不会出局域网。
        </p>

        <div class="status-grid ai-status">
          <div class="status-item">
            <span class="status-label">API KEY</span>
            <span class="status-value">{{ aiBundle?.settings.hasApiKey ? '已保存' : '未保存' }}</span>
          </div>
        </div>

        <div class="ai-actions">
          <a-button
            :loading="aiFetchingModels"
            :disabled="!selectedProvider?.modelsSupported"
            @click="fetchModels"
          >
            拉取模型清单
          </a-button>
          <a-button danger :disabled="!aiBundle?.settings.hasApiKey" @click="clearApiKey">
            清除密钥
          </a-button>
          <a-button type="primary" :loading="aiSaving" @click="saveAiSettings">
            保存 AI 设置
          </a-button>
        </div>
      </div>
    </div>

    <div class="settings-actions">
      <a-button type="primary" :loading="saving" @click="save">保存设置</a-button>
      <a-button :loading="loading" @click="load">放弃修改</a-button>
    </div>

    <a-modal
      v-model:open="mfaSetupOpen"
      title="启用双重验证"
      :footer="null"
      :destroy-on-close="true"
      @cancel="closeMfaSetup"
    >
      <div v-if="mfaSetup" class="mfa-setup">
        <p class="mfa-setup-copy">
          用身份验证器（如 Microsoft Authenticator、Google
          Authenticator）扫描二维码；无法扫描时手动输入下方密钥。
        </p>
        <div class="mfa-qr">
          <a-qrcode :value="mfaSetup.otpauthUrl" :size="176" />
        </div>
        <a-input :value="mfaSetup.secret" readonly class="mfa-secret" />
        <a-form layout="vertical" :model="mfaForm" @finish="confirmMfaSetup">
          <a-form-item
            label="输入当前动态码"
            name="code"
            :rules="[
              { required: true, message: '请输入动态验证码' },
              { pattern: /^\d{6}$/, message: '动态验证码为 6 位数字' },
            ]"
          >
            <a-input
              v-model:value="mfaForm.code"
              size="large"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="000000"
            />
          </a-form-item>
          <a-button type="primary" html-type="submit" block :loading="mfaSaving">
            确认启用
          </a-button>
        </a-form>
      </div>
    </a-modal>

    <a-modal
      v-model:open="mfaDisableOpen"
      title="停用双重验证"
      :confirm-loading="mfaSaving"
      ok-text="确认停用"
      cancel-text="取消"
      @ok="confirmMfaDisable"
    >
      <a-form layout="vertical" :model="mfaForm">
        <a-form-item label="当前口令">
          <a-input-password v-model:value="mfaForm.password" autocomplete="current-password" />
        </a-form-item>
        <a-form-item label="当前动态码">
          <a-input
            v-model:value="mfaForm.code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="000000"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, onMounted, reactive, ref } from 'vue';

import { ApiError, api, formatBytes, type MfaSetup } from '@/api/client';
import { useSessionStore } from '@/stores/session';

interface AiProviderEntry {
  id: string;
  displayName: string;
  baseUrl: string;
  modelsSupported: boolean;
  family: string;
  effortLevels: string[] | null;
  effortSupported: boolean;
  customEndpoint: boolean;
  note: string;
  fallbackModels: string[];
}

interface AiSettingsView {
  providerId: string | null;
  baseUrl: string | null;
  model: string | null;
  effort: string | null;
  hasApiKey: boolean;
}

interface AiBundle {
  settings: AiSettingsView;
  providers: AiProviderEntry[];
  encryptionEnabled: boolean;
}

interface SettingsResponse {
  maxUploadBytes: number;
  chunkSizeBytes: number;
  trashRetentionDays: number;
  instantUploadEnabled: boolean;
}

interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  storageVolumeFreeBytes?: number;
  activeSessions?: number;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const loading = ref(false);
const saving = ref(false);
const health = ref<HealthResponse | null>(null);
const mfaEnabled = ref(false);
const mfaSetupOpen = ref(false);
const mfaDisableOpen = ref(false);
const mfaSetup = ref<MfaSetup | null>(null);
const mfaSaving = ref(false);
const mfaForm = reactive({ code: '', password: '' });
const form = reactive({
  maxUploadGb: 20,
  chunkSizeMb: 8,
  trashRetentionDays: 10,
  instantUploadEnabled: true,
});

const uptimeText = computed(() => formatDuration(health.value?.uptimeSeconds ?? 0));
const freeSpaceText = computed(() =>
  health.value?.storageVolumeFreeBytes === undefined
    ? '—'
    : formatBytes(health.value.storageVolumeFreeBytes),
);

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [settings, status, mfa] = await Promise.all([
      api<SettingsResponse>('/system/settings'),
      api<HealthResponse>('/system/health'),
      api<{ enabled: boolean }>('/auth/mfa'),
    ]);
    form.maxUploadGb = Number((settings.maxUploadBytes / GB).toFixed(1));
    form.chunkSizeMb = Math.round(settings.chunkSizeBytes / MB);
    form.trashRetentionDays = settings.trashRetentionDays;
    form.instantUploadEnabled = settings.instantUploadEnabled;
    health.value = status;
    mfaEnabled.value = mfa.enabled;
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载设置失败');
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    await api('/system/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        maxUploadBytes: Math.round(form.maxUploadGb * GB),
        chunkSizeBytes: Math.round(form.chunkSizeMb * MB),
        trashRetentionDays: form.trashRetentionDays,
        instantUploadEnabled: form.instantUploadEnabled,
      }),
    });
    message.success('设置已保存');
    await load();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function openMfaSetup(): Promise<void> {
  mfaSaving.value = false;
  mfaForm.code = '';
  mfaForm.password = '';
  try {
    mfaSetup.value = await api<MfaSetup>('/auth/mfa/setup', { method: 'POST' });
    mfaSetupOpen.value = true;
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '无法初始化双重验证');
  }
}

function closeMfaSetup(): void {
  mfaSetupOpen.value = false;
  mfaSetup.value = null;
  mfaForm.code = '';
}

async function confirmMfaSetup(): Promise<void> {
  const code = mfaForm.code.trim();
  if (!/^\d{6}$/.test(code)) {
    message.error('请输入 6 位动态验证码');
    return;
  }
  mfaSaving.value = true;
  try {
    await api('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) });
    mfaEnabled.value = true;
    closeMfaSetup();
    message.success('双重验证已启用');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '启用失败');
  } finally {
    mfaSaving.value = false;
  }
}

function openMfaDisable(): void {
  mfaForm.code = '';
  mfaForm.password = '';
  mfaDisableOpen.value = true;
}

async function confirmMfaDisable(): Promise<void> {
  const code = mfaForm.code.trim();
  if (!mfaForm.password || !/^\d{6}$/.test(code)) {
    message.error('请输入当前口令与 6 位动态验证码');
    return;
  }
  mfaSaving.value = true;
  try {
    await api('/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ password: mfaForm.password, code }),
    });
    mfaEnabled.value = false;
    mfaDisableOpen.value = false;
    message.success('双重验证已停用');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '停用失败');
  } finally {
    mfaSaving.value = false;
  }
}

// ---------- AI 服务设置（仅领队） ----------

const session = useSessionStore();
const isLeader = computed(() => session.user?.role === 'LEADER');

const aiBundle = ref<AiBundle | null>(null);
const aiSaving = ref(false);
const aiFetchingModels = ref(false);
const modelOptions = ref<Array<{ value: string }>>([]);
const aiForm = reactive<{
  providerId: string | null;
  baseUrl: string;
  model: string;
  effort: string | null;
  apiKey: string;
}>({ providerId: null, baseUrl: '', model: '', effort: null, apiKey: '' });

const selectedProvider = computed<AiProviderEntry | null>(
  () => aiBundle.value?.providers.find((p) => p.id === aiForm.providerId) ?? null,
);

const providerOptions = computed(() =>
  (aiBundle.value?.providers ?? []).map((p) => ({
    value: p.id,
    label: p.customEndpoint ? `${p.displayName}（自填端点）` : p.displayName,
  })),
);

const effortOptions = computed(
  () => (selectedProvider.value?.effortLevels ?? []).map((level) => ({ value: level })),
);

function onProviderChange(): void {
  // 换供应商后旧档位可能不被支持：不支持档位的直接清掉，避免保存时被后端 400
  if (!selectedProvider.value?.effortLevels) aiForm.effort = null;
  modelOptions.value = [];
}

async function loadAi(): Promise<void> {
  try {
    const bundle = await api<AiBundle>('/ai/settings');
    aiBundle.value = bundle;
    aiForm.providerId = bundle.settings.providerId;
    aiForm.baseUrl = bundle.settings.baseUrl ?? '';
    aiForm.model = bundle.settings.model ?? '';
    aiForm.effort = bundle.settings.effort;
    aiForm.apiKey = '';
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载 AI 设置失败');
  }
}

function fillAiFormFromBundle(bundle: AiBundle): void {
  aiBundle.value = bundle;
  aiForm.providerId = bundle.settings.providerId;
  aiForm.baseUrl = bundle.settings.baseUrl ?? '';
  aiForm.model = bundle.settings.model ?? '';
  aiForm.effort = bundle.settings.effort;
  aiForm.apiKey = '';
}

async function saveAiSettings(): Promise<void> {
  if (selectedProvider.value?.customEndpoint && !aiForm.baseUrl.trim()) {
    message.warning('自定义端点需要填写接入点地址');
    return;
  }
  aiSaving.value = true;
  try {
    const body: Record<string, unknown> = {
      providerId: aiForm.providerId,
      baseUrl: aiForm.baseUrl.trim() || null,
      model: aiForm.model.trim() || null,
      effort: aiForm.effort,
    };
    // 密钥只在输入框非空时随发；已保存的密钥不回显也不重传
    if (aiForm.apiKey.trim()) body['apiKey'] = aiForm.apiKey.trim();
    const updated = await api<AiBundle>('/ai/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    fillAiFormFromBundle(updated);
    message.success('AI 设置已保存');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存 AI 设置失败');
  } finally {
    aiSaving.value = false;
  }
}

async function fetchModels(): Promise<void> {
  aiFetchingModels.value = true;
  try {
    const result = await api<{ models: string[]; source: string; warning: string | null }>(
      '/ai/models',
      { method: 'POST' },
    );
    modelOptions.value = result.models.map((name) => ({ value: name }));
    if (result.source !== 'api') {
      message.warning(result.warning ?? '实时清单没拉到，用的是离线兜底清单');
    } else {
      message.success(`拉到 ${result.models.length} 个模型`);
    }
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '拉取清单失败');
  } finally {
    aiFetchingModels.value = false;
  }
}

async function clearApiKey(): Promise<void> {
  aiSaving.value = true;
  try {
    const updated = await api<AiBundle>('/ai/settings', {
      method: 'PATCH',
      body: JSON.stringify({ clearApiKey: true }),
    });
    fillAiFormFromBundle(updated);
    message.success('已清除保存的密钥');
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '清除密钥失败');
  } finally {
    aiSaving.value = false;
  }
}

onMounted(() => {
  void load();
  if (isLeader.value) void loadAi();
});
</script>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 14px;
  align-items: stretch;
}

.settings-panel {
  padding: 16px 18px 18px;
  background: var(--vd-surface);
  border: 1px solid var(--vd-border);
  border-radius: var(--vd-radius);
}

.settings-title {
  margin: 0 0 12px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--vd-border);
  font-family: var(--vd-font-display);
  font-size: 15px;
  font-weight: 600;
}

.settings-hint {
  margin: 6px 0 0;
  color: var(--vd-text-secondary);
  font-size: 11px;
  line-height: 1.7;
}

.settings-notes {
  margin: 4px 0 0;
  padding-left: 16px;
  color: var(--vd-text-secondary);
  font-size: 12px;
  line-height: 1.9;
}

.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 12px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.status-label {
  color: var(--vd-text-secondary);
  font-family: var(--vd-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.status-value {
  font-family: var(--vd-font-mono);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.status-ok {
  color: #4f7a52;
}

.settings-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.mfa-action {
  margin-top: 12px;
}

.ai-alert {
  margin-top: 8px;
}

.ai-status {
  margin-top: 12px;
}

.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.mfa-setup-copy {
  margin: 0 0 8px;
  color: var(--vd-text-secondary);
  font-size: 12px;
  line-height: 1.8;
}

.mfa-qr {
  display: flex;
  justify-content: center;
  margin: 16px 0;
}

.mfa-secret {
  margin-bottom: 18px;
  font-family: var(--vd-font-mono);
  font-size: 12px;
}

@media (max-width: 760px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
