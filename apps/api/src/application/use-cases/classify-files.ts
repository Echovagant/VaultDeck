/**
 * AI 分类建议：对项目内一批文件给出类目建议与理由（只提议，不自动落库）。
 *
 * ## 纯模块约束（同 parse-natural-search）
 *
 * node --test 靠 Node 24 类型剥离直跑：零运行时 import，全部自包含。
 *
 * ## 语义
 *
 * 输入是文件名 + 可选内容摘录（纯文本类带前 300 字节，其余只有文件名）。
 * 模型返回建议数组；任何失败返回 null（调用方降级为空清单 + notice）。
 */

export interface ClassifyInputItem {
  fileId: string;
  fileName: string;
  excerpt?: string;
}

export interface ClassifySuggestion {
  fileId: string;
  fileName: string;
  suggestedCategory: string;
  reason: string;
}

export type ChatFn = (prompt: string) => Promise<string>;

/** 单次批量上限：控制提示词规模与模型输出稳定性 */
export const MAX_CLASSIFY_FILES = 60;
const EXCERPT_BYTES = 300;

export function buildClassifyPrompt(items: ClassifyInputItem[]): string {
  const lines = items.map((item, index) => {
    const excerpt = item.excerpt ? ` 内容摘录：${item.excerpt.replace(/\s+/g, ' ').slice(0, 150)}` : '';
    return `${index + 1}. 文件名：${item.fileName}${excerpt}`;
  });
  return [
    '你是资料库的文档整理助手。下面是一批文件的清单，请为每个文件建议一个合适的中文类目名，并给一句话理由。',
    '类目名要简洁通用（如「会议纪要」「验收报告」「测量数据」「合同文本」「操作日志」），同类文件用同一个类目名。',
    '只输出 JSON 数组，格式：',
    '[{"index": 1, "category": "类目名", "reason": "一句话理由"}]',
    'index 对应下面清单的序号；不要给清单以外的序号，不要输出其他文字。',
    '',
    '文件清单：',
    ...lines,
  ].join('\n');
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced && fenced[1] ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

export function normalizeSuggestions(
  raw: unknown,
  items: ClassifyInputItem[],
): ClassifySuggestion[] {
  if (!Array.isArray(raw)) return [];
  const byIndex = new Map(items.map((item, index) => [index + 1, item]));
  const suggestions: ClassifySuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const source = entry as Record<string, unknown>;
    const index = typeof source['index'] === 'number' ? source['index'] : Number.NaN;
    const item = byIndex.get(index);
    if (!item || seen.has(item.fileId)) continue;
    const category = typeof source['category'] === 'string' ? source['category'].trim().slice(0, 30) : '';
    const reason = typeof source['reason'] === 'string' ? source['reason'].trim().slice(0, 120) : '';
    if (!category) continue;
    seen.add(item.fileId);
    suggestions.push({ fileId: item.fileId, fileName: item.fileName, suggestedCategory: category, reason });
  }
  return suggestions;
}

/** 主入口；失败返回 null（调用方降级为空建议 + notice） */
export async function classifyFiles(
  items: ClassifyInputItem[],
  chat: ChatFn,
  onError?: (error: unknown) => void,
): Promise<ClassifySuggestion[] | null> {
  if (items.length === 0) return [];
  let reply: string;
  try {
    reply = await chat(buildClassifyPrompt(items.slice(0, MAX_CLASSIFY_FILES)));
  } catch (error) {
    onError?.(error);
    return null;
  }

  const json = extractJson(reply);
  if (!json) {
    onError?.(new Error('模型回话里没有可解析的 JSON 数组'));
    return null;
  }
  try {
    return normalizeSuggestions(JSON.parse(json), items);
  } catch (error) {
    onError?.(error);
    return null;
  }
}

/** 为一批文件准备分类输入：纯文本类带内容摘录，其余只有文件名 */
export function toClassifyInputs(
  files: Array<{ fileId: string; fileName: string; excerpt: string | null }>,
): ClassifyInputItem[] {
  return files.slice(0, MAX_CLASSIFY_FILES).map((file) => ({
    fileId: file.fileId,
    fileName: file.fileName,
    ...(file.excerpt ? { excerpt: file.excerpt.slice(0, EXCERPT_BYTES) } : {}),
  }));
}
