/**
 * 文本分块：把提取出的文档文本切成适合嵌入模型的块（语义检索用）。
 *
 * ## 纯模块约束（同 parse-natural-search）
 *
 * node --test 靠 Node 24 类型剥离直跑：零运行时 import，全部自包含。
 *
 * ## 策略
 *
 * 段落优先：按空行（\n\n）切自然段，自然段超过块上限时再按单换行切，
 * 仍超长按字符硬切；相邻块之间带 overlap 字符的尾部重叠，保证跨块语境不丢。
 * 空白为主的输入返回 []。
 */

export interface TextChunk {
  index: number;
  text: string;
}

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 100;

export function chunkText(
  content: string,
  size = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): TextChunk[] {
  if (size <= 0 || overlap < 0 || overlap >= size) return [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!normalized) return [];

  // 先按空行聚成自然段；超长段再按单换行切；仍超长硬切
  const paragraphs: string[] = [];
  for (const para of normalized.split(/\n{2,}/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.length <= size) {
      paragraphs.push(trimmed);
      continue;
    }
    for (const line of trimmed.split('\n')) {
      const lineTrimmed = line.trim();
      if (!lineTrimmed) continue;
      if (lineTrimmed.length <= size) paragraphs.push(lineTrimmed);
      else for (const piece of hardSplit(lineTrimmed, size)) paragraphs.push(piece);
    }
  }
  if (paragraphs.length === 0) return [];

  // 段落聚合进块：贪心装箱，段落间用 \n\n 连接
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (!current) {
      current = para;
      continue;
    }
    if (current.length + 2 + para.length <= size) {
      current = `${current}\n\n${para}`;
      continue;
    }
    chunks.push(current);
    // 重叠：上一块尾部 overlap 字符 + 当前段
    const tail = current.slice(-overlap);
    current = para.length + tail.length + 2 <= size ? `${tail}\n\n${para}` : para;
    // 超长单段本身已被切短，不会超过 size
  }
  if (current) chunks.push(current);

  return chunks.map((text, index) => ({ index, text }));
}

function hardSplit(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    pieces.push(text.slice(offset, offset + size));
  }
  return pieces;
}

/** 余弦相似度；零向量返回 0 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
