#!/usr/bin/env node
/**
 * VaultDeck Skill 命令行（零第三方依赖，Node ≥ 18）。
 *
 * 所有请求的权限过滤都在 VaultDeck 服务端按 Agent 授权范围执行。
 * 访问令牌只从环境变量 VD_VAULTDECK_TOKEN 或 --token 参数读取，不落盘、不打印完整值。
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  let key = null;
  for (const item of argv) {
    if (item.startsWith('--')) {
      key = item.slice(2);
      args[key] = true;
    } else if (key) {
      args[key] = item;
      key = null;
    } else {
      args._.push(item);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

const baseUrl = (args.url ?? process.env['VD_VAULTDECK_URL'] ?? '').replace(/\/+$/, '');
const token = args.token ?? process.env['VD_VAULTDECK_TOKEN'] ?? '';

async function api(pathname, init = {}) {
  if (!token) fail('缺少访问令牌：先执行 exchange，或设置环境变量 VD_VAULTDECK_TOKEN');
  const headers = { authorization: `Bearer ${token}`, ...(init.headers ?? {}) };
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) fail(body?.detail ?? `HTTP ${response.status}`);
  return body;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes ?? 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(1)} ${units[index]}`;
}

// ---------- 子命令 ----------

async function exchange() {
  const code = args.code;
  if (!baseUrl || !code) fail('用法：exchange --url <VaultDeck地址> --code vda-xxxx');
  const response = await fetch(`${baseUrl}/api/v1/agent/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: String(code).trim() }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) fail(body?.detail ?? `HTTP ${response.status}`);
  console.log('授权成功。请把下面的令牌保存为环境变量 VD_VAULTDECK_TOKEN（不要写进文件）：');
  console.log(body.token);
  console.log(`绑定：${body.displayName}｜角色 ${body.role}｜${body.scopeAll ? '全部项目' : `${body.projectIds.length} 个项目`}｜${body.readOnly ? '只读' : '读写'}`);
}

async function projects() {
  const list = await api('/projects');
  const items = Array.isArray(list) ? list : (list.items ?? []);
  if (items.length === 0) { console.log('（没有任何项目）'); return; }
  for (const item of items) {
    console.log(`${item.projectId}  ${item.projectName}（${item.projectCode ?? ''}）文件 ${item.fileCount ?? '?'} 个，容量 ${formatBytes(item.totalBytes ?? 0)}`);
  }
}

function buildSearchParams(args, keyword) {
  const params = new URLSearchParams();
  if (keyword && keyword.trim().length >= 2) params.set('q', keyword.trim());
  const pick = (name, flag) => {
    const value = args[flag];
    if (value === undefined || value === true || value === '') return;
    params.set(name, String(value));
  };
  pick('projectId', 'project');
  pick('uploadedFrom', 'from');
  pick('uploadedTo', 'to');
  pick('minSizeBytes', 'min-size');
  pick('maxSizeBytes', 'max-size');
  pick('extensions', 'ext');
  params.set('pageSize', String(Math.min(50, Math.max(1, Number(args.limit ?? 20) || 20))));
  return params;
}

function renderSearch(result) {
  if (result.total === 0) { console.log('没有匹配的文件。'); return; }
  console.log(`共 ${result.total} 条，列出 ${result.items.length} 条：`);
  for (const item of result.items) {
    console.log(`${item.fileId}  ${item.fileName}（${formatBytes(item.sizeBytes)}，${item.projectName}，${item.createdAt.slice(0, 10)} 上传）`);
  }
}

async function search() {
  const params = buildSearchParams(args, args.keyword ?? args._[1]);
  if (![...params.keys()].some((key) => key !== 'pageSize')) {
    fail('请至少提供一个条件：--keyword / --from / --to / --min-size / --max-size / --ext / --project');
  }
  renderSearch(await api(`/search?${params}`));
}

async function aiFind() {
  const query = args._[1];
  if (!query) fail('用法：ai-find "上周上传的超过100MB的视频"');
  const parsed = await api('/ai/parse-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: String(query).slice(0, 300) }),
  });
  const filters = parsed.filters;
  if (parsed.notice && !filters) { console.log(`AI 没解析出可用条件：${parsed.notice}`); return; }
  const params = new URLSearchParams({ pageSize: '20' });
  if (filters.keyword) params.set('q', filters.keyword);
  if (filters.uploadedFrom) params.set('uploadedFrom', filters.uploadedFrom);
  if (filters.uploadedTo) params.set('uploadedTo', filters.uploadedTo);
  if (filters.minSizeBytes !== null && filters.minSizeBytes !== undefined) params.set('minSizeBytes', String(filters.minSizeBytes));
  if (filters.maxSizeBytes !== null && filters.maxSizeBytes !== undefined) params.set('maxSizeBytes', String(filters.maxSizeBytes));
  if (filters.extensions && filters.extensions.length > 0) params.set('extensions', filters.extensions.join(','));
  renderSearch(await api(`/search?${params}`));
}

async function download() {
  const fileId = args._[1];
  const savePath = args._[2];
  if (!fileId || !savePath) fail('用法：download <fileId> <保存路径>');
  if ((await stat(savePath).catch(() => null))?.isDirectory()) {
    fail('保存路径是一个目录，请给完整文件名');
  }
  const response = await fetch(`${baseUrl}/api/v1/files/${fileId}/content`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    fail(problem?.detail ?? `下载失败（HTTP ${response.status}）`);
  }
  await mkdir(path.dirname(path.resolve(savePath)), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(savePath, buffer);
  console.log(`已下载 ${formatBytes(buffer.length)} 到 ${path.resolve(savePath)}`);
}

async function summarize() {
  const fileId = args._[1];
  if (!fileId) fail('用法：summarize <fileId>');
  const result = await api('/ai/summarize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  console.log(`摘要：${result.summary}`);
  console.log(`关键词：${(result.keywords ?? []).join('、') || '（无）'}`);
}

async function classify() {
  const projectId = args.project;
  if (!projectId) fail('用法：classify --project <projectId>');
  const result = await api('/ai/classify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  if (result.notice) console.log(`提示：${result.notice}`);
  if (!result.suggestions || result.suggestions.length === 0) {
    console.log('（没有分类建议）');
    return;
  }
  console.log(`共 ${result.suggestions.length} 条分类建议：`);
  for (const item of result.suggestions) {
    console.log(`${item.fileId}  ${item.fileName} → ${item.suggestedCategory}（${item.reason}）`);
  }
}

async function upload() {
  const filePath = args._[1];
  const projectId = args.project;
  if (!filePath || !projectId) fail('用法：upload <本地文件> --project <projectId>');
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) fail(`本地文件不存在：${filePath}`);
  if (info.size > 20 * 1024 * 1024 * 1024) fail('超过单文件 20GB 上限');

  const folderList = await api(`/folders?projectId=${projectId}`);
  const folders = Array.isArray(folderList) ? folderList : (folderList.items ?? []);
  let folderId;
  if (folders.length > 0) {
    folderId = folders[0].folderId;
  } else {
    const created = await api('/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, folderName: 'Agent 上传', parentId: null }),
    });
    folderId = created.folderId;
  }

  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  const sha256 = digest.digest('hex');

  const precheck = await api('/upload-sessions/precheck', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      folderId,
      fileName: path.basename(filePath),
      sizeBytes: info.size,
      sha256,
      clientFingerprint: 'vaultdeck-skill',
    }),
  });
  if (precheck.kind === 'instant') {
    console.log(`秒传完成（服务端已有相同内容），fileId=${precheck.fileId}`);
    return;
  }

  const sessionId = precheck.sessionId;
  const chunkSize = precheck.chunkSize ?? 8 * 1024 * 1024;
  const chunkCount = precheck.chunkCount ?? Math.ceil(info.size / chunkSize);
  const received = new Set(precheck.receivedChunks ?? []);
  for (let index = 0; index < chunkCount; index++) {
    if (received.has(index)) continue;
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, info.size);
    const chunk = Buffer.alloc(end - start);
    let read = 0;
    for await (const piece of createReadStream(filePath, { start, end: end - 1 })) {
      piece.copy(chunk, read);
      read += piece.length;
    }
    await api(`/upload-sessions/${sessionId}/chunks/${index}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        digest: `sha-256=${createHash('sha256').update(chunk).digest('base64')}`,
      },
      body: new Uint8Array(chunk),
    });
    console.log(`分片 ${index + 1}/${chunkCount} 已传`);
  }
  const file = await api(`/upload-sessions/${sessionId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });
  console.log(`上传完成：${file.fileName}（${formatBytes(file.sizeBytes)}），fileId=${file.fileId}`);
}

async function semanticSearch() {
  const query = args._[1];
  if (!query) fail('用法：semantic-search "磁盘告警的处置流程" [--project <projectId>] [--limit 10]');
  const body = { query: String(query).slice(0, 300) };
  if (args.project) body.projectId = args.project;
  if (args.limit) body.limit = Number(args.limit) || 10;
  const result = await api('/ai/semantic-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (result.notice) console.log(`提示：${result.notice}`);
  if (!result.items || result.items.length === 0) {
    console.log('（语义检索没有找到相关内容）');
    return;
  }
  console.log(`共 ${result.items.length} 条语义命中：`);
  for (const item of result.items) {
    console.log(`${item.fileId}  ${item.fileName}（相似度 ${(item.score * 100).toFixed(0)}%）`);
    console.log(`    摘录：${item.excerpt.slice(0, 120)}`);
  }
}

const HANDLERS = {
  exchange,
  projects,
  search,
  'ai-find': aiFind,
  summarize,
  classify,
  'semantic-search': semanticSearch,
  download,
  upload,
};
const handler = HANDLERS[command];
if (!handler) {
  console.log('用法：node vaultdeck.mjs <命令>\n  exchange   授权码换令牌（--url --code）\n  projects   项目清单\n  search     条件搜索（--keyword --from --to --min-size --max-size --ext --project）\n  ai-find    AI 自然语言找文件\n  summarize  AI 总结一个文件（<fileId>）\n  classify   AI 分类建议（--project <projectId>）\n  semantic-search 语义搜索（语义索引需领队先建，--project --limit）\n  download   下载（<fileId> <保存路径>）\n  upload     上传（<本地文件> --project <projectId>）');
  process.exit(command ? 1 : 0);
}
await handler();
