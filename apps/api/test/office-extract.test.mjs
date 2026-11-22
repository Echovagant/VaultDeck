import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import {
  buildStoredZip,
  extractDocxText,
  extractXlsxText,
  readZipEntries,
} from '../src/infrastructure/extract/office-extract.ts';

function docxOf(paragraphs) {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join('');
  return buildStoredZip([
    {
      name: 'word/document.xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    },
  ]);
}

function xlsxOf(shared, rows) {
  const sharedXml = Buffer.from(
    `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
  );
  const sheetXml = Buffer.from(
    `<?xml version="1.0"?><worksheet>${rows
      .map(
        (cells) =>
          `<row>${cells
            .map((c) =>
              typeof c === 'number' && c >= 0
                ? `<c t="s"><v>${c}</v></c>`
                : `<c><v>${c}</v></c>`,
            )
            .join('')}</row>`,
      )
      .join('')}</worksheet>`,
  );
  return buildStoredZip([
    { name: 'xl/sharedStrings.xml', data: sharedXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ]);
}

describe('office-extract', () => {
  it('docx：按段落提取中文文本', () => {
    const data = docxOf(['设备采购合同', '甲方：数据治理专项工作组', '验收标准：七十二小时稳定运行。']);
    const text = extractDocxText(data);
    assert.ok(text.includes('设备采购合同'));
    assert.ok(text.includes('七十二小时稳定运行'));
    assert.equal(text.split('\n').length, 3);
  });

  it('xlsx：sharedStrings 引用还原单元格', () => {
    const data = xlsxOf(
      ['设备采购与维保服务第 1 轮评审', '通过'],
      [
        ['2026-11-03', 0, 1],
        ['2026-11-10', 0, 1],
      ],
    );
    const text = extractXlsxText(data);
    assert.ok(text.includes('设备采购与维保服务第 1 轮评审'));
    assert.ok(text.includes('通过'));
  });

  it('deflate 压缩条目可解包', () => {
    // 手工构造 method=8（deflate）的完整 zip：真实 Office 文件都是这种形态
    const xml = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="urn:doc"><w:body><w:p><w:r><w:t>压缩正文内容</w:t></w:r></w:p></w:body></w:document>',
    );
    const deflated = deflateRawSync(xml);
    const name = Buffer.from('word/document.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(xml.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); // deflate
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(xml.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42); // local header offset
    const localTotal = local.length + name.length + deflated.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(localTotal, 16);
    const zip = Buffer.concat([local, name, deflated, central, name, end]);
    assert.equal(extractDocxText(zip), '压缩正文内容');
  });

  it('加密标记或损坏 zip 返回 null 不抛错', () => {
    assert.equal(readZipEntries(Buffer.from('not a zip at all')), null);
    assert.equal(extractDocxText(Buffer.alloc(64, 7)), null);
    assert.equal(extractXlsxText(Buffer.alloc(0)), null);
  });
});
