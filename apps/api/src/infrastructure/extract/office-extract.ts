/**
 * Office（docx/xlsx）与通用 stored-zip 的读写与文本提取。
 *
 * ## 纯模块约束（同 parse-natural-search）
 *
 * node --test 靠 Node 24 类型剥离直跑：运行时只依赖 node 内建模块（zlib 解 deflate），
 * 全部自包含。rich-demo 的演示 docx 也用这里的 buildStoredZip 生成，读写互为验证。
 *
 * ## 能力边界（如实说）
 *
 * 只处理 stored（无压缩）与 deflate（常规压缩）两种条目；加密 zip 返回 null。
 * docx 提取 word/document.xml 的文本节点；xlsx 提取 sharedStrings 与首个工作表的
 * 单元格文本。样式、批注、图片忽略——目标是给 AI 总结提供纯文本输入。
 */
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function crc32(data: Buffer): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  let result = 0xffffffff;
  for (const byte of data) result = table[(result ^ byte) & 0xff]! ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}

/** 无压缩（stored）zip 打包：生成最小合法 zip，供 docx/xlsx 样例构建与测试使用 */
export function buildStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + entry.data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIG, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

/** 解包 zip（stored / deflate），加密或不完整返回 null */
export function readZipEntries(data: Buffer): Map<string, Buffer> | null {
  // 从尾部找 End of Central Directory 签名（兼容注释尾部）
  let eocd = -1;
  for (let i = data.length - 22; i >= 0 && i >= data.length - 22 - 65536; i -= 1) {
    if (data.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = data.readUInt16LE(eocd + 10);
  const centralOffset = data.readUInt32LE(eocd + 16);

  const entries = new Map<string, Buffer>();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== CENTRAL_SIG) return null;
    const method = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const nameLen = data.readUInt16LE(cursor + 28);
    const extraLen = data.readUInt16LE(cursor + 30);
    const commentLen = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const name = data.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8');

    // local header 的文件名/额外字段长度可能与 central 不同，按 local 实际值定位数据
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== LOCAL_SIG) return null;
    const localNameLen = data.readUInt16LE(localOffset + 26);
    const localExtraLen = data.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = data.slice(dataStart, dataStart + compressedSize);

    let content: Buffer;
    try {
      if (method === 0) content = compressed;
      else if (method === 8) content = inflateRawSync(compressed);
      else return null; // 未支持的压缩方法：整体按不可提取处理
    } catch {
      return null;
    }
    entries.set(name, content);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function stripXmlTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const text = match[1]
      ?.replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
    if (text) results.push(text);
  }
  return results;
}

/** docx → 纯文本：word/document.xml 的段落文本，段落间换行 */
export function extractDocxText(data: Buffer): string | null {
  const entries = readZipEntries(data);
  const documentXml = entries?.get('word/document.xml');
  if (!documentXml) return null;
  const xml = documentXml.toString('utf8');
  const paragraphs = xml
    .split(/<w:p[ >]/)
    .slice(1)
    .map((section) => stripXmlTags(section, 'w:t').join(''))
    .filter((text) => text.length > 0);
  if (paragraphs.length === 0) {
    const texts = stripXmlTags(xml, 'w:t');
    return texts.length > 0 ? texts.join('\n') : null;
  }
  return paragraphs.join('\n');
}

/** xlsx → 纯文本：sharedStrings + 首个工作表的单元格，行内制表符分隔 */
export function extractXlsxText(data: Buffer): string | null {
  const entries = readZipEntries(data);
  if (!entries) return null;
  const sharedXml = entries.get('xl/sharedStrings.xml');
  const shared = sharedXml ? stripXmlTags(sharedXml.toString('utf8'), 't') : [];
  const sheetName = [...entries.keys()].find(
    (name) => name.startsWith('xl/worksheets/') && name.endsWith('.xml'),
  );
  const sheetXml = sheetName ? entries.get(sheetName)?.toString('utf8') : null;
  if (!sheetXml) return null;

  const rows: string[] = [];
  for (const rowSection of sheetXml.split(/<row[ >]/).slice(1)) {
    const cells: string[] = [];
    const cellRe = /<c(?:\s[^>]*)?>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowSection)) !== null) {
      // cellMatch[0] 含开标签（t="s" 属性在那里），cellMatch[1] 只有值部分
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(cellMatch[0]);
      if (!valueMatch) continue;
      const value = valueMatch[1] ?? '';
      if (/t="s"/.test(cellMatch[0].split('<v>')[0] ?? '')) {
        const index = Number(value);
        cells.push(shared[index] ?? '');
      } else {
        cells.push(value);
      }
    }
    if (cells.some((cell) => cell.length > 0)) rows.push(cells.join('\t'));
  }
  if (rows.length === 0) {
    const inline = stripXmlTags(sheetXml, 't');
    return inline.length > 0 ? inline.join('\n') : null;
  }
  return rows.join('\n');
}

/** PDF 文件判定与提取由 unpdf 承担（纯 JS，pdf.js 包装）；这里只做指纹与类型判定 */
export function isPdfFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf');
}

/** 内容哈希（下载去重与测试比对用） */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
