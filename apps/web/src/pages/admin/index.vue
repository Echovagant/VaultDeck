<template>
  <section>
    <header class="vd-page-head">
      <div>
        <p class="vd-eyebrow">07 / ADMIN</p>
        <h1 class="vd-page-title">后台</h1>
        <p class="vd-page-sub">账号管理与 Agent 接入授权</p>
      </div>
      <div class="vd-page-actions">
        <a-button @click="openGrantCreate">新建 Agent 授权</a-button>
        <a-button v-if="isLeader" type="primary" @click="openCreate">新建账号</a-button>
      </div>
    </header>

    <div v-if="isLeader" class="vd-panel">
      <h2 class="panel-title">账号管理</h2>
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

      <div class="vd-panel">
        <h2 class="panel-title">Agent 接入</h2>
        <p class="panel-note">
          {{ isLeader
            ? '给外部 Agent（Skill / MCP）发授权码：Agent 用授权码换访问令牌，按选定角色与项目范围访问，可随时撤销。'
            : '为外部 Agent（Skill / MCP）创建你权限范围内的授权：范围只能是你参与的项目，档位不高于你的角色，可随时撤销。' }}
        </p>
      <a-table
        :columns="grantColumns"
        :data-source="agentGrants"
        :loading="grantsLoading"
        :pagination="false"
        row-key="grantId"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'role'">
            {{ record.role === 'DEPUTY_LEADER' ? '执行领队' : '队员' }}
          </template>
          <template v-else-if="column.key === 'scope'">
            {{ record.scopeAll ? '全部项目' : `${record.projectIds.length} 个指定项目` }}
          </template>
          <template v-else-if="column.key === 'readOnly'">
            <a-tag :color="record.readOnly ? 'default' : 'warning'">
              {{ record.readOnly ? '只读' : '读写' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'state'">
            <a-tag v-if="record.revokedAt" color="error">已撤销</a-tag>
            <a-tag v-else-if="!record.codeUsed" color="processing">待兑换</a-tag>
            <a-tag v-else color="success">已接入</a-tag>
          </template>
          <template v-else-if="column.key === 'lastUsedAt'">
            {{ record.lastUsedAt ? new Date(record.lastUsedAt).toLocaleString() : '—' }}
          </template>
          <template v-else-if="column.key === 'grantActions'">
            <a-button v-if="!record.revokedAt" type="link" danger @click="revokeGrant(record)">
              撤销
            </a-button>
          </template>
        </template>
      </a-table>
    </div>

    <div class="vd-panel">
      <h2 class="panel-title">扩展</h2>
      <p class="panel-note">
        可选组件与其状态。安装或启停需要管理员权限，详细步骤见部署手册对应章节。
      </p>
      <div class="ext-toolbar">
        <a-radio-group v-model:value="extFilter" size="small" :options="extFilterOptions" option-type="button" />
        <a-input-search
          v-model:value="extKeyword"
          placeholder="按名称或描述搜索"
          allow-clear
          style="max-width: 240px"
        />
      </div>
      <div class="ext-grid">
        <a-empty v-if="visibleExtensions.length === 0" description="没有匹配的扩展" />
        <div
          v-for="ext in visibleExtensions"
          :key="ext.name"
          class="ext-card ext-card-clickable"
          @click="openExtensionDetail(ext)"
        >
          <div class="ext-head">
            <span class="ext-name">{{ ext.name }}</span>
            <a-tag :color="ext.tagColor">{{ ext.tagText }}</a-tag>
          </div>
          <p class="ext-desc">{{ ext.desc }}</p>
          <p v-if="ext.meta" class="ext-meta">{{ ext.meta }}</p>
          <span class="ext-open-hint">点击查看详情与操作</span>
        </div>
      </div>
    </div>

    <a-modal
      v-model:open="extDetailVisible"
      :title="activeExtension?.name ?? '扩展详情'"
      :footer="null"
      :destroy-on-close="true"
    >
      <template v-if="activeExtension">
        <p class="ext-desc">{{ activeExtension.desc }}</p>
        <a-tag :color="activeExtension.tagColor">{{ activeExtension.tagText }}</a-tag>
        <p v-if="activeExtension.meta" class="ext-meta">{{ activeExtension.meta }}</p>

        <template v-if="activeExtension.name.startsWith('pgvector')">
          <a-alert
            v-if="extActionDetail"
            :type="extActionOk ? 'success' : 'error'"
            show-icon
            :message="extActionDetail"
            style="margin: 12px 0"
          />
          <div class="ext-actions">
            <a-button
              v-if="!aiBundle?.vectorAvailable"
              type="primary"
              :loading="extActionLoading"
              @click="runVectorAction('install')"
            >
              安装
            </a-button>
            <template v-else>
              <a-button :loading="extActionLoading" @click="runVectorAction('refresh')">
                更新状态
              </a-button>
              <a-button danger :loading="extActionLoading" @click="runVectorAction('uninstall')">
                卸载（清空语义索引）
              </a-button>
            </template>
          </div>
          <p v-if="!aiBundle?.vectorAvailable" class="ext-steps">
            若安装提示找不到扩展文件，需要管理员先把 vector.dll 复制到 PG 的 lib 目录、vector.control
            复制到 share\extension 目录并重启数据库，再点「安装」（完整步骤见部署手册 5.3）。
          </p>
        </template>

        <template v-else-if="activeExtension.name.startsWith('MCP')">
          <div class="ext-actions">
            <a-button type="primary" @click="mcpConfigVisible = true">查看接入配置</a-button>
          </div>
        </template>

        <template v-else-if="activeExtension.name.startsWith('Agent Skill')">
          <div class="ext-actions">
            <a-button
              type="primary"
              href="https://github.com/Echovagant/VaultDeck/releases"
              target="_blank"
              rel="noopener"
            >
              前往 Releases 下载
            </a-button>
          </div>
        </template>
      </template>
    </a-modal>

    <a-modal v-model:open="mcpConfigVisible" title="MCP Server 接入配置" :footer="null" width="680px">
      <p class="ext-desc">
        在 MCP 客户端（Claude Desktop / Cherry Studio / Cursor 等）的配置文件中加入以下片段；令牌在
        「Agent 接入」创建授权码后由 Agent 兑换获得。
      </p>
      <pre class="mcp-config">{
  "mcpServers": {
    "vaultdeck": {
      "command": "node",
      "args": ["&lt;离线包路径&gt;/current/mcp/vaultdeck-mcp.mjs"],
      "env": {
        "VD_VAULTDECK_URL": "https://&lt;主机地址&gt;:8443",
        "VD_VAULTDECK_TOKEN": "&lt;vdak_ 开头的访问令牌&gt;"
      }
    }
  }
}</pre>
      <p class="ext-desc">完整说明见离线包 current\mcp\MCP-INSTALL.md。</p>
    </a-modal>

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

    <a-modal
      v-model:open="grantDialogVisible"
      title="新建 Agent 授权"
      :confirm-loading="grantSaving"
      ok-text="创建授权"
      cancel-text="取消"
      @ok="submitGrantCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="名称（给哪个 Agent / 用途）">
          <a-input v-model:value="grantForm.name" placeholder="例如：组内 AI 助手" />
        </a-form-item>
        <a-form-item label="角色档位">
          <a-select v-model:value="grantForm.role" :options="grantRoleOptions" />
          <p class="settings-hint">
            {{ isLeader
              ? '执行领队档可读范围内全部文件；队员档只能读到它自己上传的文件。'
              : '授权档位不高于你的角色；范围只能是你参与的项目。' }}
          </p>
        </a-form-item>
        <a-form-item label="项目范围">
          <a-radio-group v-if="isLeader" v-model:value="grantForm.scopeMode">
            <a-radio value="all">全部项目</a-radio>
            <a-radio value="specific">指定项目</a-radio>
          </a-radio-group>
          <span v-if="isLeader && grantForm.scopeMode === 'all'" class="settings-hint">
            对全部项目生效（含以后新建的项目）。
          </span>
          <a-select
            v-if="!isLeader || grantForm.scopeMode === 'specific'"
            v-model:value="grantForm.projectIds"
            mode="multiple"
            :options="projectOptions"
            :placeholder="isLeader ? '选择可访问的项目' : '选择你参与的项目'"
            style="margin-top: 8px"
          />
        </a-form-item>
        <a-form-item label="权限位">
          <a-switch v-model:checked="grantForm.readOnly" checked-children="只读" un-checked-children="读写" />
          <p class="settings-hint">只读授权在服务端拦截一切写请求（上传、删除、修改）；读操作正常放行。</p>
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="codeVisible"
      title="授权码已生成"
      :footer="null"
      :destroy-on-close="true"
    >
      <p class="reset-warn">
        授权码明文只显示这一次，关闭后无法再查看；15 分钟内有效，Agent 兑换一次即作废。
      </p>
      <a-typography-paragraph class="code-line" copyable>{{ createdCode }}</a-typography-paragraph>
      <p class="settings-hint">把下面这条安装指令发给 Agent 平台即可完成安装与授权：</p>
      <a-typography-paragraph class="code-line" copyable>
        {{ installCommand }}
      </a-typography-paragraph>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { Modal, message } from 'ant-design-vue';
import { computed, onMounted, reactive, ref } from 'vue';

import { ApiError, api } from '@/api/client';
import { useSessionStore } from '@/stores/session';

interface VectorStatsInfo {
  available: boolean;
  indexedFiles: number;
  chunks: number;
  model: string | null;
}

interface AiSettingsView {
  providerId: string | null;
  baseUrl: string | null;
  model: string | null;
  effort: string | null;
  embeddingModel: string | null;
  hasApiKey: boolean;
}

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

interface AiBundle {
  settings: AiSettingsView;
  providers: AiProviderEntry[];
  encryptionEnabled: boolean;
  vectorAvailable: boolean;
  vectorStats?: VectorStatsInfo;
}

interface UserItem {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  status: 'active' | 'disabled';
}

interface AgentGrant {
  grantId: string;
  name: string;
  role: 'DEPUTY_LEADER' | 'MEMBER';
  scopeAll: boolean;
  projectIds: string[];
  readOnly: boolean;
  codeUsed: boolean;
  codeExpiresAt: string | null;
  hasToken: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface ProjectOption {
  projectId: string;
  projectName: string;
}

const session = useSessionStore();
const isLeader = computed(() => session.user?.role === 'LEADER');
const users = ref<UserItem[]>([]);
const agentGrants = ref<AgentGrant[]>([]);
const projects = ref<ProjectOption[]>([]);
const loading = ref(false);
const saving = ref(false);
const resetting = ref(false);
const dialogVisible = ref(false);
const resetVisible = ref(false);
const resetTarget = ref<UserItem | null>(null);
const resetPassword = ref('');
const form = reactive({ username: '', displayName: '', role: 'MEMBER', password: '' });

const grantsLoading = ref(false);
const aiBundle = ref<AiBundle | null>(null);
const extFilter = ref('全部');
const extKeyword = ref('');

interface ExtEntry {
  name: string;
  category: string;
  tagText: string;
  tagColor: string;
  desc: string;
  steps?: string;
  meta?: string;
  guideUrl?: string;
}

const EXT_CATALOG: Array<Omit<ExtEntry, 'steps' | 'meta'>> = [
  {
    name: 'pgvector（语义搜索）',
    category: 'AI 能力',
    tagText: '已启用',
    tagColor: 'success',
    desc: '语义搜索与语义索引的向量存储。未安装时语义功能禁用并提示，其余 AI 功能不受影响。',
  },
  {
    name: 'MCP Server',
    category: '接入',
    tagText: '内置',
    tagColor: 'success',
    desc: '把资料库接入外部 AI 助手（Claude Desktop / Cherry Studio / Cursor 等）。零依赖单文件在离线包 current\\mcp\\ 目录，安装说明见同目录 MCP-INSTALL.md；仓库内源码在 apps/mcp-server/。',
    guideUrl: 'https://github.com/Echovagant/VaultDeck/blob/main/apps/mcp-server/MCP-INSTALL.md',
  },
  {
    name: 'Agent Skill 包',
    category: '接入',
    tagText: 'Releases 提供',
    tagColor: 'success',
    desc: '面向千问等支持 Skill 的 AI 助手：下载 vaultdeck-skill-x.x.x.zip，按包内 SKILL.md 安装授权即可用自然语言找文件、总结、分类、上传下载。',
    guideUrl: 'https://github.com/Echovagant/VaultDeck/releases',
  },
];

const visibleExtensions = computed<ExtEntry[]>(() => {
  const keyword = extKeyword.value.trim().toLowerCase();
  return EXT_CATALOG.filter((ext) => {
    if (extFilter.value !== '全部' && ext.category !== extFilter.value) return false;
    if (keyword && !(`${ext.name} ${ext.desc}`.toLowerCase().includes(keyword))) return false;
    return true;
  }).map((ext) => {
    if (!ext.name.startsWith('pgvector')) return ext;
    const available = aiBundle.value?.vectorAvailable ?? false;
    const stats = aiBundle.value?.vectorStats;
    return {
      ...ext,
      tagText: available ? '已启用' : '未安装',
      tagColor: available ? 'success' : 'default',
      steps: available
        ? undefined
        : '安装：下载 pgvector Windows 包（GitHub pgvector/pgvector Release，按 PG 大版本选）→ 复制 vector.dll 与 vector.control 到 PG 的 lib 与 share\\extension 目录 → 重启数据库 → 在业务库执行 CREATE EXTENSION IF NOT EXISTS vector → 重启本服务。完整步骤见部署手册 5.3。',
      meta: available
        ? `已索引 ${stats?.chunks ?? 0} 块 / ${stats?.indexedFiles ?? 0} 个文件${stats?.model ? `（模型 ${stats.model}）` : ''}`
        : undefined,
    };
  });
});

const extFilterOptions = ['全部', 'AI 能力', '接入', '文档转换'];
const extDetailVisible = ref(false);
const activeExtension = ref<ExtEntry | null>(null);
const extActionLoading = ref(false);
const extActionDetail = ref('');
const extActionOk = ref(false);
const mcpConfigVisible = ref(false);

function openExtensionDetail(ext: ExtEntry): void {
  activeExtension.value = ext;
  extActionDetail.value = '';
  extDetailVisible.value = true;
  void loadAiBundle();
}

async function runVectorAction(action: 'install' | 'uninstall' | 'refresh'): Promise<void> {
  extActionLoading.value = true;
  extActionDetail.value = '';
  try {
    if (action === 'refresh') {
      await loadAiBundle();
      extActionOk.value = true;
      extActionDetail.value = '状态已刷新';
      return;
    }
    const endpoint = action === 'install' ? '/ai/vector/install' : '/ai/vector/uninstall';
    const result = await api<{ ok: boolean; detail: string }>(endpoint, { method: 'POST' });
    extActionOk.value = result.ok;
    extActionDetail.value = result.detail;
    await loadAiBundle();
  } catch (error) {
    extActionOk.value = false;
    extActionDetail.value = error instanceof ApiError ? error.message : '操作失败';
  } finally {
    extActionLoading.value = false;
  }
}

const grantSaving = ref(false);
const grantDialogVisible = ref(false);
const codeVisible = ref(false);
const createdCode = ref('');
const grantForm = reactive<{
  name: string;
  role: 'DEPUTY_LEADER' | 'MEMBER';
  scopeMode: 'all' | 'specific';
  projectIds: string[];
  readOnly: boolean;
}>({ name: '', role: 'DEPUTY_LEADER', scopeMode: 'all', projectIds: [], readOnly: true });

const roleOptions = [
  { label: '领队', value: 'LEADER' },
  { label: '执行领队', value: 'DEPUTY_LEADER' },
  { label: '队员', value: 'MEMBER' },
];

const grantRoleOptions = computed(() => {
  const deputyOption = { label: '执行领队（读范围内全部文件）', value: 'DEPUTY_LEADER' };
  const memberOption = { label: '队员（只读自己上传的）', value: 'MEMBER' };
  if (session.user?.role === 'MEMBER') return [memberOption];
  if (session.user?.role === 'LEADER') return [deputyOption, memberOption];
  return [deputyOption, memberOption];
});

const columns = [
  { title: '用户名', dataIndex: 'username', key: 'username', width: 180 },
  { title: '显示名', dataIndex: 'displayName', key: 'displayName' },
  { title: '角色', key: 'role', width: 170 },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'actions', width: 200 },
];

const grantColumns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '角色档位', key: 'role', width: 100 },
  { title: '范围', key: 'scope', width: 130 },
  { title: '权限', key: 'readOnly', width: 80 },
  { title: '状态', key: 'state', width: 90 },
  { title: '最近使用', key: 'lastUsedAt', width: 170 },
  { title: '操作', key: 'grantActions', width: 90 },
];

const projectOptions = computed(() =>
  projects.value.map((p) => ({ value: p.projectId, label: p.projectName })),
);

const installCommand = computed(
  () =>
    `请安装 VaultDeck Skill，并授权访问。VaultDeck 地址与授权码由管理员提供：授权码 ${createdCode.value}`,
);

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

async function loadAiBundle(): Promise<void> {
  try {
    aiBundle.value = await api<AiBundle>('/ai/settings');
  } catch {
    aiBundle.value = null;
  }
}

async function loadGrants(): Promise<void> {
  grantsLoading.value = true;
  try {
    agentGrants.value = await api<AgentGrant[]>('/agent/grants');
  } catch {
    // 非领队打开后台页时静默：面板数据为空即可
    agentGrants.value = [];
  } finally {
    grantsLoading.value = false;
  }
}

async function loadProjects(): Promise<void> {
  try {
    const result = await api<{ items?: ProjectOption[] } | ProjectOption[]>('/projects');
    projects.value = Array.isArray(result) ? result : (result.items ?? []);
  } catch {
    projects.value = [];
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

// ---------- Agent 授权 ----------

function openGrantCreate(): void {
  grantForm.name = '';
  // 队员只能建队员档；范围默认指向自己可见的项目清单
  grantForm.role = session.user?.role === 'MEMBER' ? 'MEMBER' : 'DEPUTY_LEADER';
  grantForm.scopeMode = 'all';
  grantForm.projectIds = [];
  grantForm.readOnly = true;
  void loadProjects();
  grantDialogVisible.value = true;
}

async function submitGrantCreate(): Promise<void> {
  if (!grantForm.name.trim()) {
    message.warning('请填写授权名称');
    return;
  }
  if (grantForm.scopeMode === 'specific' && grantForm.projectIds.length === 0) {
    message.warning('指定范围时至少选择一个项目');
    return;
  }
  grantSaving.value = true;
  try {
    const created = await api<AgentGrant & { code: string }>('/agent/grants', {
      method: 'POST',
      body: JSON.stringify({
        name: grantForm.name.trim(),
        role: grantForm.role,
        scopeAll: isLeader.value && grantForm.scopeMode === 'all',
        projectIds: grantForm.scopeMode === 'all' ? [] : grantForm.projectIds,
        readOnly: grantForm.readOnly,
      }),
    });
    grantDialogVisible.value = false;
    createdCode.value = created.code;
    codeVisible.value = true;
    await loadGrants();
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '创建授权失败');
  } finally {
    grantSaving.value = false;
  }
}

function revokeGrant(item: AgentGrant): void {
  Modal.confirm({
    title: '撤销 Agent 授权',
    content: `撤销后「${item.name}」的访问令牌立即失效，Agent 将无法再访问。`,
    okText: '确认撤销',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await api(`/agent/grants/${item.grantId}`, {
          method: 'PATCH',
          body: JSON.stringify({ revoked: true }),
        });
        message.success('授权已撤销');
        await loadGrants();
      } catch (error) {
        message.error(error instanceof ApiError ? error.message : '撤销失败');
      }
    },
  });
}

onMounted(() => {
  void load();
  void loadGrants();
  void loadAiBundle();
});
</script>

<style scoped>
/* 后台页两个面板纵向叠放，补面板间距；面板内容与边框留出呼吸空间 */
.vd-panel {
  padding: 14px 16px 16px;
}

.vd-panel + .vd-panel {
  margin-top: 16px;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-title {
  margin: 0 0 8px;
  font-family: var(--vd-font-display);
  font-size: 15px;
  font-weight: 600;
}

.panel-note {
  margin: 0 0 12px;
  color: var(--vd-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.settings-hint {
  margin: 6px 0 0;
  color: var(--vd-text-secondary);
  font-size: 11px;
  line-height: 1.7;
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

.code-line {
  font-family: var(--vd-font-mono);
  font-size: 13px;
  word-break: break-all;
}
.ext-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.ext-card {
  padding: 12px 14px;
  border: 1px solid var(--vd-border);
  border-radius: var(--vd-radius);
  background: var(--vd-surface-sunken, transparent);
}

.ext-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.ext-name {
  font-weight: 600;
  font-size: 13px;
}

.ext-desc {
  margin: 0 0 4px;
  color: var(--vd-text-secondary);
  font-size: 12px;
  line-height: 1.8;
}

.ext-steps {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-left: 2px solid var(--vd-accent);
  background: var(--vd-ochre-soft, rgba(0,0,0,0.03));
  color: var(--vd-text-secondary);
  font-size: 11px;
  line-height: 1.8;
}

.ext-meta {
  margin: 0;
  color: var(--vd-text-secondary);
  font-family: var(--vd-font-mono);
  font-size: 11px;
}
.ext-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.ext-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.ext-card {
  padding: 12px 14px;
  border: 1px solid var(--vd-border);
  border-radius: var(--vd-radius);
  background: var(--vd-surface-sunken, transparent);
}

.ext-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.ext-name {
  font-weight: 600;
  font-size: 13px;
}

.ext-desc {
  margin: 0 0 4px;
  color: var(--vd-text-secondary);
  font-size: 12px;
  line-height: 1.8;
}

.ext-steps {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-left: 2px solid var(--vd-accent);
  background: var(--vd-ochre-soft, rgba(0,0,0,0.03));
  color: var(--vd-text-secondary);
  font-size: 11px;
  line-height: 1.8;
}

.ext-meta {
  margin: 0;
  color: var(--vd-text-secondary);
  font-family: var(--vd-font-mono);
  font-size: 11px;
}
</style>
