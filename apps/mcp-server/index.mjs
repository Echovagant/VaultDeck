#!/usr/bin/env node
/**
 * VaultDeck MCP Server（stdio, JSON-RPC 2.0, 零第三方依赖）。
 *
 * 把局域网内的 VaultDeck 资料库暴露为 MCP 工具面：
 *   list_projects / search_files / ai_find_files / download_file / upload_file
 *
 * ## 授权与红线
 *
 * - 认证走 VaultDeck 二期的 Agent 授权：环境变量 VD_VAULTDECK_TOKEN 填
 *   `vdak_...` 访问令牌（领队在后台创建授权码 → Agent 兑换得到）。
 * - 权限在 VaultDeck 服务端按授权范围过滤：Agent 拿不到范围外的任何数据；
 *   只读授权在服务端拦截一切写请求（本进程原样转达 403）。
 * - `ai_find_files` 用的是 VaultDeck 服务端配置的模型密钥（BYOK 存在服务端），
 *   **Agent 不需要也不接触任何 LLM API key**；查询语句会发送给所配置的模型厂商
 *   （本机 Ollama 不出局域网）。
 * - 本进程不落盘任何凭据；token 只在内存里作为请求头使用。
 *
 * ## 配置（环境变量）
 *
 *   VD_VAULTDECK_URL    VaultDeck 服务地址（默认 http://127.0.0.1:3000）
 *   VD_VAULTDECK_TOKEN  Agent 访问令牌（vdak_ 开头，必填）
 *
 * ## 客户端配置示例（Claude Desktop / Cherry Studio / Cursor 等）
 *
 *   { "mcpServers": { "vaultdeck": {
 *       "command": "node",
 *       "args": ["<路径>/apps/mcp-server/index.mjs"],
 *       "env": { "VD_VAULTDECK_URL": "https://<主机>:8443",
 *                "VD_VAULTDECK_TOKEN": "<领队发放的 vdak_ 令牌>" } } } }
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const BASE_URL = (process.env['VD_VAULTDECK_URL'] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const API = `${BASE_URL}/api/v1`;
const TOKEN = process.env['VD_VAULTDECK_TOKEN'] ?? '';
const CHUNK_SIZE = 8 * 1024 * 1024;

// ---------- REST 基础 ----------

/** 统一请求：401/403/4xx 的 problem+json 转成带业务语义的错误消息 */
async function api(pathname, init = {}) {
  if (!TOKEN) throw new Error('未配置 VD_VAULTDECK_TOKEN 环境变量（向 VaultDeck 领队索取 Agent 令牌）');
  const headers = { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) };
  const response = await fetch(`${API}${pathname}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const detail = body?.detail ?? body?.title ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

// ---------- 工具实现 ----------

async function toolListProjects() {
  const projects = await api('/projects');
  const items = Array.isArray(projects) ? projects : (projects.items ?? []);
  if (items.length === 0) return '（没有任何项目）';
  return items
    .map((p) => `${p.projectId}  ${p.projectName}（${p.projectCode ?? ''}）文件 ${p.fileCount ?? '?'} 个，容量 ${formatBytes(p.totalBytes ?? 0)}`)
    .join('\n');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes ?? 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(1)} ${units[index]}`;
}

/** 把自然语言 / 参数化条件翻译成 /search 的查询串 */
function buildSearchParams(args, keyword) {
  const params = new URLSearchParams();
  if (keyword && keyword.trim().length >= 2) params.set('q', keyword.trim());
  const pick = (name) => {
    const value = args[name];
    if (value === undefined || value === null || value === '') return;
    params.set(name, String(value));
  };
  pick('projectId'); pick('uploadedFrom'); pick('uploadedTo');
  pick('minSizeBytes'); pick('maxSizeBytes'); pick('extensions');
  params.set('pageSize', String(Math.min(50, Math.max(1, Number(args.limit ?? 20) || 20))));
  return params;
}

function renderSearchResult(result) {
  if (result.total === 0) return `没有匹配的文件（共 0 条）。${result.notice ?? ''}`.trim();
  const lines = result.items.map((item) =>
    `${item.fileId}  ${item.fileName}（${formatBytes(item.sizeBytes)}，${item.projectName}，${item.createdAt.slice(0, 10)} 上传）`,
  );
  const head = `共 ${result.total} 条，列出 ${result.items.length} 条：`;
  return [head, ...lines].join('\n');
}

async function toolSearchFiles(args) {
  const params = buildSearchParams(args, args.keyword);
  if (![...params.keys()].some((key) => key !== 'pageSize')) {
    throw new Error('请至少提供一个搜索条件（keyword / 日期 / 大小 / 扩展名 / projectId）');
  }
  const result = await api(`/search?${params}`);
  return renderSearchResult(result);
}

async function toolAiFindFiles(args) {
  const query = (args.query ?? '').trim();
  if (!query) throw new Error('query 不能为空：用一句话描述要找的文件');
  // 服务端 AI 解析（模型密钥在 VaultDeck 服务端，Agent 不需要 key）
  const parsed = await api('/ai/parse-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: query.slice(0, 300) }),
  });
  const f = parsed.filters;
  if (parsed.notice && !f) return `AI 没解析出可用条件：${parsed.notice}`;
  const params = new URLSearchParams({ pageSize: '20' });
  if (f.keyword) params.set('q', f.keyword);
  if (f.uploadedFrom) params.set('uploadedFrom', f.uploadedFrom);
  if (f.uploadedTo) params.set('uploadedTo', f.uploadedTo);
  if (f.minSizeBytes !== null && f.minSizeBytes !== undefined) params.set('minSizeBytes', String(f.minSizeBytes));
  if (f.maxSizeBytes !== null && f.maxSizeBytes !== undefined) params.set('maxSizeBytes', String(f.maxSizeBytes));
  if (f.extensions && f.extensions.length > 0) params.set('extensions', f.extensions.join(','));
  const result = await api(`/search?${params}`);
  const head = parsed.notice ? `${parsed.notice}\n` : '';
  return head + renderSearchResult(result);
}

async function toolDownloadFile(args) {
  const fileId = args.fileId;
  const savePath = args.savePath;
  if (!fileId || !savePath) throw new Error('fileId 与 savePath 都必填');
  if ((await stat(savePath).catch(() => null))?.isDirectory()) {
    throw new Error('savePath 是一个目录，请给完整文件名');
  }
  if (!TOKEN) throw new Error('未配置 VD_VAULTDECK_TOKEN');
  const response = await fetch(`${API}/files/${fileId}/content`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(problem?.detail ?? `下载失败（HTTP ${response.status}）`);
  }
  await mkdir(path.dirname(path.resolve(savePath)), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(savePath, buffer);
  return `已下载 ${formatBytes(buffer.length)} 到 ${path.resolve(savePath)}`;
}

/** 选目录：给了 folderId 用之；否则取项目第一个文件夹，没有就建一个 */
async function resolveFolderId(projectId, folderId) {
  if (folderId) return folderId;
  const list = await api(`/folders?projectId=${projectId}`);
  const folders = Array.isArray(list) ? list : (list.items ?? []);
  if (folders.length > 0) return folders[0].folderId;
  const created = await api('/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, folderName: 'Agent 上传', parentId: null }),
  });
  return created.folderId ?? created.id ?? created.folderID;
}

async function toolUploadFile(args) {
  const filePath = args.filePath;
  const projectId = args.projectId;
  if (!filePath || !projectId) throw new Error('filePath 与 projectId 都必填');
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`本地文件不存在：${filePath}`);
  if (info.size < 1) throw new Error('空文件不能上传');
  if (info.size > 20 * 1024 * 1024 * 1024) throw new Error('超过单文件 20 GB 上限');

  const folderId = await resolveFolderId(projectId, args.folderId);
  const fileName = path.basename(filePath);

  // 全量 sha256（流式）
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  const sha256 = digest.digest('hex');

  // 预检：秒传 / 断点续传 / 新会话 三态
  const precheck = await api('/upload-sessions/precheck', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      folderId,
      fileName,
      sizeBytes: info.size,
      sha256,
      clientFingerprint: 'vaultdeck-mcp-server',
    }),
  });

  if (precheck.kind === 'instant') {
    return `秒传完成（服务端已有相同内容），fileId=${precheck.fileId}`;
  }

  const sessionId = precheck.sessionId;
  const chunkSize = precheck.chunkSize ?? CHUNK_SIZE;
  const chunkCount = precheck.chunkCount ?? Math.ceil(info.size / chunkSize);
  const done = new Set(precheck.receivedChunks ?? []);

  // 分片上传（PUT + Digest 头 = 分片 sha256）
  for (let index = 0; index < chunkCount; index++) {
    if (done.has(index)) continue;
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, info.size);
    const chunk = Buffer.alloc(end - start);
    let read = 0;
    for await (const piece of createReadStream(filePath, { start, end: end - 1 })) {
      if (piece.copy) {
        piece.copy(chunk, read);
      } else {
        chunk.set(piece, read);
      }
      read += piece.length;
    }
    await api(`/upload-sessions/${sessionId}/chunks/${index}`, {
      method: 'PUT',
      // 服务端 Digest 校验格式：sha-256=<base64>（与产品前端一致），不是 hex
      headers: {
        'content-type': 'application/octet-stream',
        digest: `sha-256=${createHash('sha256').update(chunk).digest('base64')}`,
      },
      body: new Uint8Array(chunk),
    });
  }

  // 合并
  const file = await api(`/upload-sessions/${sessionId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });
  return `上传完成：${file.fileName}（${formatBytes(file.sizeBytes)}），fileId=${file.fileId}`;
}

// ---------- 工具声明（JSON Schema，供 MCP 客户端渲染参数表单） ----------

const TOOLS = [
  {
    name: 'list_projects',
    description: '列出 VaultDeck 里你能访问的全部项目（名称、编码、文件数、容量）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_files',
    description: '按结构化条件搜索文件（文件名关键词、上传日期区间、大小区间、扩展名、项目）',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '文件名关键词，至少 2 个字符；可省略改用其他条件' },
        projectId: { type: 'string', description: '限定项目 id（list_projects 可得）' },
        uploadedFrom: { type: 'string', description: '上传日期下限 YYYY-MM-DD（含）' },
        uploadedTo: { type: 'string', description: '上传日期上限 YYYY-MM-DD（含）' },
        minSizeBytes: { type: 'integer', description: '文件大小下限（字节）' },
        maxSizeBytes: { type: 'integer', description: '文件大小上限（字节）' },
        extensions: { type: 'string', description: '扩展名白名单，逗号分隔，如 pdf、docx' },
        limit: { type: 'integer', description: '最多返回条数，默认 20' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ai_find_files',
    description:
      'AI 找文件：用一句自然语言描述要找的文件（如「上周上传的超过 100MB 的视频」），服务端用配置好的模型解析成条件并返回真实文件列表。模型密钥在 VaultDeck 服务端，无需自带。',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', maxLength: 300, description: '一句话描述，如「上周上传的csv文件」' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'download_file',
    description: '把 VaultDeck 里的一个文件下载到本机指定路径（需要只读以上权限）',
    inputSchema: {
      type: 'object',
      required: ['fileId', 'savePath'],
      properties: {
        fileId: { type: 'string', description: '文件 id（search_files / ai_find_files 可得）' },
        savePath: { type: 'string', description: '保存到本地的完整路径' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'upload_file',
    description: '把本机一个文件上传到指定项目（需要读写授权；支持秒传与断点续传，单文件上限 20GB）',
    inputSchema: {
      type: 'object',
      required: ['filePath', 'projectId'],
      properties: {
        filePath: { type: 'string', description: '本地文件完整路径' },
        projectId: { type: 'string', description: '目标项目 id（list_projects 可得）' },
        folderId: { type: 'string', description: '目标文件夹 id；省略时自动选项目第一个文件夹' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ai_summarize_file',
    description:
      'AI 总结一个文件的内容（当前支持纯文本类：txt/md/csv/log/json），返回摘要与关键词。模型能力由 VaultDeck 服务端提供。',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: {
        fileId: { type: 'string', description: '文件 id（search_files / ai_find_files 可得）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ai_classify_project',
    description:
      'AI 对一个项目内的文件批量给出分类建议（类目名 + 理由），只提议不自动落库；单次最多分析 60 个文件。',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', description: '项目 id（list_projects 可得）' },
      },
      additionalProperties: false,
    },
  },
];

async function toolAiSummarizeFile(args) {
  const fileId = args.fileId;
  if (!fileId) throw new Error('fileId 必填（search_files / ai_find_files 可得）');
  const result = await api('/ai/summarize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  return `摘要：${result.summary}\n关键词：${(result.keywords ?? []).join('、') || '（无）'}`;
}

async function toolAiClassifyProject(args) {
  const projectId = args.projectId;
  if (!projectId) throw new Error('projectId 必填（list_projects 可得）');
  const result = await api('/ai/classify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  const notice = result.notice ? `提示：${result.notice}\n` : '';
  if (!result.suggestions || result.suggestions.length === 0) return `${notice}（没有分类建议）`;
  const lines = result.suggestions.map(
    (s) => `${s.fileId}  ${s.fileName} → ${s.suggestedCategory}（${s.reason}）`,
  );
  return `${notice}共 ${result.suggestions.length} 条分类建议：\n${lines.join('\n')}`;
}

const HANDLERS = {
  list_projects: toolListProjects,
  search_files: toolSearchFiles,
  ai_find_files: toolAiFindFiles,
  download_file: toolDownloadFile,
  upload_file: toolUploadFile,
  ai_summarize_file: toolAiSummarizeFile,
  ai_classify_project: toolAiClassifyProject,
};

// ---------- MCP stdio 协议（JSON-RPC 2.0，按行分帧） ----------

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'vaultdeck', version: '0.1.0' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = params?.name;
      const handler = HANDLERS[name];
      if (!handler) return toolResult(`未知工具：${name}`, true);
      try {
        return toolResult(await handler(params?.arguments ?? {}));
      } catch (error) {
        return toolResult(error instanceof Error ? error.message : String(error), true);
      }
    }
    default:
      return undefined;
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message;
    try { message = JSON.parse(trimmed); } catch { continue; }
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') continue;

    // 通知没有 id，不回包
    if (message.id === undefined || message.id === null) continue;

    const result = await dispatch(message.method, message.params);
    if (result === undefined) {
      writeMessage({
        jsonrpc: '2.0', id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });
      continue;
    }
    writeMessage({ jsonrpc: '2.0', id: message.id, result });
  }
}

main().catch((error) => {
  process.stderr.write(`vaultdeck-mcp fatal: ${error?.stack ?? error}\n`);
  process.exit(1);
});
