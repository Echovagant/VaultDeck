/**
 * AI 文件总结：读取文本类文件内容 → 摘要 + 关键词。
 *
 * ## 纯模块约束（同 parse-natural-search）
 *
 * node --test 靠 Node 24 类型剥离直跑：零运行时 import，全部自包含。
 *
 * ## 语义
 *
 * - 成功返回 { summary, keywords }；模型侧任何失败返回 null（调用方转 502）。
 * - 二进制/不支持的类型在进入本模块前由调用方用 isSummarizable 拦截。
 */

export interface FileSummary {
  summary: string;
  keywords: string[];
}

export type ChatFn = (prompt: string) => Promise<string>;

/** 可总结的扩展名（纯文本家族）；二进制格式 v1 不支持，明确拒绝而非硬猜 */
const SUMMARIZABLE_EXTENSIONS = ['.txt', '.md', '.csv', '.log', '.json'];
export const MAX_SUMMARY_INPUT_BYTES = 512 * 1024;

export function isSummarizable(fileName: string, contentType: string | undefined): boolean {
  const lower = fileName.toLowerCase();
  if (SUMMARIZABLE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  return Boolean(contentType && contentType.startsWith('text/'));
}

export function buildSummarizePrompt(fileName: string, content: string): string {
  return [
    '你是资料库的文档分析器。阅读下面的文件内容，输出 JSON，只输出 JSON。',
    '输出格式：{"summary": "不超过200字的内容摘要", "keywords": ["关键词3到5个"]}',
    '要求：摘要用中文概括这份材料是什么、核心内容与结论；关键词从内容中提取，不要编造。',
    '',
    `文件名：${fileName}`,
    '文件内容：',
    content,
  ].join('\n');
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced && fenced[1] ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

function normalizeSummary(raw: unknown): FileSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const summary = typeof source['summary'] === 'string' ? source['summary'].trim().slice(0, 500) : '';
  if (!summary) return null;
  const keywords = Array.isArray(source['keywords'])
    ? source['keywords']
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 30))
        .slice(0, 6)
    : [];
  return { summary, keywords };
}

/** 主入口；失败返回 null 并回调 onError（错误消息已由 llm 包脱敏） */
export async function summarizeFile(
  fileName: string,
  content: string,
  chat: ChatFn,
  onError?: (error: unknown) => void,
): Promise<FileSummary | null> {
  let reply: string;
  try {
    reply = await chat(buildSummarizePrompt(fileName, content));
  } catch (error) {
    onError?.(error);
    return null;
  }

  const json = extractJson(reply);
  if (!json) {
    onError?.(new Error('模型回话里没有可解析的 JSON'));
    return null;
  }
  try {
    const normalized = normalizeSummary(JSON.parse(json));
    if (!normalized) onError?.(new Error('摘要字段缺失或为空'));
    return normalized;
  } catch {
    onError?.(new Error('模型回话的 JSON 解析失败'));
    return null;
  }
}
