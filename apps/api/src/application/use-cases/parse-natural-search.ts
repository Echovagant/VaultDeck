/**
 * 自然语言 → 结构化搜索条件。
 *
 * ## 纯模块约束（故意为零依赖）
 *
 * node --test 靠 Node 24 的类型剥离直跑本文件：这里只能有类型 import 或完全自包含，
 * 任何运行时 import / 装饰器 / 枚举都会让类型剥离失败。数据清洗逻辑全部手写在本文件内。
 *
 * ## 降级语义（与契约 ParseSearchResult 对齐）
 *
 * AI 出任何岔子都不让搜索挂掉：filters 返回 null 并带一句 notice，
 * 前端据此退回普通关键词搜索。
 */

/** 与契约 ParsedSearchFilters 同构（全字段可空，全空等价于「没有条件」） */
export interface ParsedSearchFilters {
  keyword: string | null;
  uploadedFrom: string | null;
  uploadedTo: string | null;
  minSizeBytes: number | null;
  maxSizeBytes: number | null;
  extensions: string[] | null;
}

export interface NaturalSearchParseResult {
  filters: ParsedSearchFilters | null;
  notice: string | null;
}

/** 模型对话函数：输入提示词，返回回话正文。由调用方注入（ai-engine 包一层 chatOnce） */
export type ChatFn = (prompt: string) => Promise<string>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXT_RE = /^[a-z0-9]{1,10}$/;

/**
 * 构造解析提示词。
 *
 * 今天日期必须写进提示词：模型不知道现在几号，「上周」「最近三天」全靠它换算。
 */
export function buildParsePrompt(query: string, todayIso: string): string {
  return [
    '你是文件搜索条件解析器。把用户的一句话解析成 JSON 搜索条件，只输出 JSON，不要输出任何解释文字。',
    `今天是 ${todayIso}。`,
    '',
    '输出 JSON 的字段：',
    '- keyword: 字符串或 null，文件名关键词（可以是短句，不要自己编造文件名）',
    '- uploadedFrom / uploadedTo: "YYYY-MM-DD" 或 null，上传日期区间（含端点）',
    '- minSizeBytes / maxSizeBytes: 整数或 null，文件大小，单位字节',
    '- extensions: 字符串数组或 null，文件扩展名，小写、不带点',
    '',
    '规则：',
    '- 相对时间（今天、昨天、上周、最近 N 天）按今天的日期换算成具体区间',
    '- 大小换算成字节整数（100MB = 104857600，超过 1GB 才能用 MB 以上单位描述）',
    '- 用户没提到的字段一律填 null，不要编造',
    `- 用户输入：${query}`,
  ].join('\n');
}

/**
 * 从模型回话里截出 JSON 正文。
 *
 * 模型爱包 ```json 围栏、爱在前后夹说明文字：先剥围栏，再截首个 { 到末个 }。
 * 截不出来返回 null（调用方降级，不抛错）。
 */
export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced && fenced[1] ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

function normalizeDate(value: unknown): string | null {
  return typeof value === 'string' && DATE_RE.test(value) ? value : null;
}

function normalizeSize(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeExtensions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim().toLowerCase().replace(/^\./, '');
    if (!EXT_RE.test(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    if (seen.size >= 8) break;
  }
  return seen.size > 0 ? [...seen] : null;
}

/**
 * 校验并清洗模型给出的条件。
 *
 * - 日期：必须是 YYYY-MM-DD；from > to 时交换（模型偶尔说反，不值得为它报错）
 * - 大小：取整、负数按 0 处理
 * - 扩展名：小写去点、白名单 [a-z0-9]{1,10}、去重、最多 8 个
 * - 关键词：trim 后不足 2 字丢弃，超过 60 截断
 * - 全部为空返回 null（这句里没有可用的搜索条件）
 */
export function normalizeFilters(raw: unknown): ParsedSearchFilters | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;

  const keywordRaw = typeof source['keyword'] === 'string' ? source['keyword'].trim() : '';
  const keyword = keywordRaw.length >= 2 ? keywordRaw.slice(0, 60) : null;

  let uploadedFrom = normalizeDate(source['uploadedFrom']);
  let uploadedTo = normalizeDate(source['uploadedTo']);
  if (uploadedFrom && uploadedTo && uploadedFrom > uploadedTo) {
    [uploadedFrom, uploadedTo] = [uploadedTo, uploadedFrom];
  }

  const minSizeBytes = normalizeSize(source['minSizeBytes']);
  const maxSizeBytes = normalizeSize(source['maxSizeBytes']);
  const extensions = normalizeExtensions(source['extensions']);

  const filters: ParsedSearchFilters = {
    keyword,
    uploadedFrom,
    uploadedTo,
    minSizeBytes,
    maxSizeBytes,
    extensions,
  };
  const hasAny =
    filters.keyword !== null ||
    filters.uploadedFrom !== null ||
    filters.uploadedTo !== null ||
    filters.minSizeBytes !== null ||
    filters.maxSizeBytes !== null ||
    filters.extensions !== null;
  return hasAny ? filters : null;
}

/** 模型彻底没给可解析内容时的统一降级提示 */
const NOTICE_PARSE_FAILED = 'AI 没能解析出搜索条件，请换个说法或直接用关键词搜索';
/** 解析成功但一个可用条件都没有 */
const NOTICE_EMPTY = '这句话里没有提取到可用的搜索条件，试试加上时间、大小或文件类型';
/** 模型调用本身失败（网络断、接口错、超时） */
export const NOTICE_CHAT_FAILED = 'AI 服务暂时不可用，已退回普通搜索';

/**
 * 主入口：一句话 → 搜索条件。
 *
 * 任何失败都降级为 { filters: null, notice }，绝不向上抛错。
 */
export async function parseNaturalSearch(
  query: string,
  chat: ChatFn,
  today: Date = new Date(),
): Promise<NaturalSearchParseResult> {
  let reply: string;
  try {
    reply = await chat(buildParsePrompt(query, today.toISOString().slice(0, 10)));
  } catch {
    return { filters: null, notice: NOTICE_CHAT_FAILED };
  }

  const json = extractJson(reply);
  if (!json) return { filters: null, notice: NOTICE_PARSE_FAILED };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { filters: null, notice: NOTICE_PARSE_FAILED };
  }

  const filters = normalizeFilters(parsed);
  if (!filters) return { filters: null, notice: NOTICE_EMPTY };
  return { filters, notice: null };
}
