/**
 * 富化演示数据（VD_BOOTSTRAP_DEMO=rich 时启用，仅内存模式）。
 *
 * 目的：给 AI 找文件 / 搜索 / MCP / Skill 的规模化实测提供足量语料——
 * 6 个项目 × 约 50 个文件，全部带真实可读的中文文本内容（落成存储对象，
 * 可下载、可预览），覆盖纪要 / 报告 / 数据 / 日志 / 规范等常见资料类型。
 *
 * 内容全部是模板合成的虚构材料；对象按内容寻址落盘（与上传同一存储层），
 * 重复启动不会重复写对象。这不是生产数据，生产部署走 PostgreSQL 不经过这里。
 */
import { createHash, randomUUID } from 'node:crypto';

import { store } from '../store';
import { objectStorage } from './upload-sessions';
import { logger } from '../logging/logger';

interface RichProjectSpec {
  code: string;
  name: string;
  folders: string[];
  themes: string[];
}

const PROJECTS: RichProjectSpec[] = [
  {
    code: 'RICH-01',
    name: '数据治理专项',
    folders: ['会议纪要', '阶段报告'],
    themes: ['元数据标准', '数据质量整改', '权限梳理', '归档策略', '指标口径', '质量巡检'],
  },
  {
    code: 'RICH-02',
    name: '现场勘察一组',
    folders: ['勘察记录', '测量数据'],
    themes: ['控制点复测', '地形图修测', '界址点采集', '无人机航测', '水深测量', '断面观测'],
  },
  {
    code: 'RICH-03',
    name: '合同与采购档案',
    folders: ['合同文本', '评审记录'],
    themes: ['维保服务合同', '设备采购', '外包开发', '框架协议', '租赁合同', '咨询顾问'],
  },
  {
    code: 'RICH-04',
    name: '研发资料库',
    folders: ['设计说明', '测试记录'],
    themes: ['分片上传优化', '预览服务重构', '审计模块', '备份策略', '全文检索', '权限模型'],
  },
  {
    code: 'RICH-05',
    name: '会议与纪要',
    folders: ['周例会', '专题会'],
    themes: ['里程碑评审', '风险跟踪', '资源协调', '验收准备', '供应商对账', '培训计划'],
  },
  {
    code: 'RICH-06',
    name: '运维与值班',
    folders: ['值班日志', '故障报告'],
    themes: ['磁盘告警', '证书更换', '数据库巡检', '服务重启', '网络抖动', '备份校验'],
  },
];

const BASE_DATE = new Date('2026-11-21T09:00:00+08:00');

// ---------- Office/PDF 预览样例生成 ----------
// 目的：给前端预览弹层（docx-preview / ExcelJS / 浏览器原生 PDF）提供真实可渲染的样本。
// 不依赖 LibreOffice：docx = 手写 OOXML 打 stored-zip；pdf = 手写最小 PDF 1.4（英文，
// 中文需嵌入字体，成本不成比例）；xlsx = exceljs（web 工作区依赖被 hoist 到根，dev 环境可用）。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** 无压缩（stored）zip 打包：docx/xlsx 这类 XML 小包足够，避免引入 zip 依赖 */
function buildStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 name flag
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
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
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildDocxSample(): Buffer {
  const paragraphs = [
    '设备采购合同（示例文档，用于预览功能验证）',
    '甲方：数据治理专项工作组    乙方：维保服务商',
    '一、采购范围：档案库专用存储服务器一台，含三年维保服务。',
    '二、交付要求：自合同生效之日起三十个自然日内完成到货、安装与验收。',
    '三、验收标准：设备连续稳定运行七十二小时，无告警与降速记录。',
    '四、本合同一式两份，双方各执一份，自双方签字盖章之日起生效。',
  ];
  const body = paragraphs
    .map((text, index) =>
      index === 0
        ? '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t xml:space="preserve">设备采购合同</w:t></w:r></w:p>'
        : `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
    )
    .join('');
  const documentXml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    'utf8',
  );
  const contentTypes = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    'utf8',
  );
  const rels = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'utf8',
  );
  return buildStoredZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    {
      name: 'word/_rels/document.xml.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
        'utf8',
      ),
    },
    { name: 'word/document.xml', data: documentXml },
  ]);
}

/** 手写最小 PDF 1.4（Helvetica 英文示例；中文预览需嵌入字体，不在示例范围） */
function buildPdfSample(): Buffer {
  const content = [
    'BT /F1 18 Tf 60 780 Td (VaultDeck PDF Preview Sample) Tj ET',
    'BT /F1 11 Tf 60 752 Td (Generated by rich demo seed - purchase & acceptance notes.) Tj ET',
    'BT /F1 11 Tf 60 724 Td (Item 1: storage server, 3-year maintenance, 30-day delivery.) Tj ET',
    'BT /F1 11 Tf 60 706 Td (Item 2: acceptance = 72h stable run without warnings.) Tj ET',
    'BT /F1 11 Tf 60 688 Td (Item 3: contract in duplicate, effective on signature.) Tj ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function buildXlsxSample(): Promise<Buffer> {
  // exceljs 是 web 工作区依赖（hoist 到根 node_modules）；生产离线包不含它，
  // 但 rich 演示只跑在开发环境（内存模式），因此这里动态 import 是安全的。
  // CJS 包经 ESM 包装后 Workbook 可能在 default 或顶层，两种形态都兼容。
  const mod = (await import('exceljs')) as unknown as Record<string, unknown>;
  const ExcelJS = (mod.default ?? mod) as {
    Workbook: new () => {
      addWorksheet: (name: string) => {
        columns: Array<{ header: string; key: string; width: number }>;
        addRow: (row: Record<string, string>) => void;
      };
      xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
    };
  };
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('评审记录');
  sheet.columns = [
    { header: '日期', key: 'date', width: 14 },
    { header: '评审事项', key: 'item', width: 28 },
    { header: '结论', key: 'result', width: 12 },
    { header: '参与人', key: 'owner', width: 12 },
  ];
  ['2026-11-03', '2026-11-10', '2026-11-17'].forEach((date, index) => {
    sheet.addRow({
      date,
      item: `设备采购与维保服务第 ${index + 1} 轮评审`,
      result: index === 2 ? '通过' : '有条件通过',
      owner: ['王工', '李工', '张工'][index]!,
    });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function shiftDate(days: number): string {
  const date = new Date(BASE_DATE.getTime() - days * 86400000);
  return date.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 生成一份 2~6KB 的虚构中文文本内容；index 决定日期与数值变化 */
function buildContent(kind: string, theme: string, projectName: string, index: number): string {
  const date = shiftDate(index % 30);
  const deadline = shiftDate((index % 30) + 14);
  const sizeMb = 100 + ((index * 37) % 900);
  const percent = 40 + ((index * 13) % 60);
  const count = 12 + (index % 88);
  const author = ['王工', '李工', '张工', '刘工', '陈工'][index % 5];
  const lines: string[] = [];

  if (kind === 'minutes') {
    lines.push(
      `${projectName}——${theme}专题会议纪要`,
      `时间：${date} 14:00-15:30 | 地点：三楼会议室 | 主持：${author}`,
      '参会：领队、执行领队、各组骨干（名单见签到表）',
      '',
      '一、上期事项跟进',
      `1. ${theme}相关资料归档完成率 ${percent}%，剩余部分预计 ${deadline} 前补齐。`,
      `2. 上一轮提出的大文件传输问题已解决，实测上传 ${sizeMb}MB 稳定。`,
      '',
      '二、本期讨论',
      `1. ${theme}工作方案经讨论通过，责任分工见附表。`,
      `2. 本周期共处理文件 ${count} 份，其中需重点复核 ${Math.ceil(count / 5)} 份。`,
      '3. 各组反馈的检索体验问题（关键词命中率、筛选维度）转研发跟进。',
      '',
      '三、决议',
      `1. ${theme}进入下一阶段，里程碑节点 ${deadline}。`,
      '2. 所有对外提交材料必须先归档再外发。',
      '3. 下次会议时间另行通知。',
    );
  } else if (kind === 'report') {
    lines.push(
      `# ${projectName} ${theme}阶段报告（第 ${index % 9 + 1} 期）`,
      '',
      `报告日期：${date} | 编制：${author}`,
      '',
      '## 一、总体进展',
      `本期围绕「${theme}」完成既定工作量的 ${percent}%。核心产出包括：`,
      `- 整理并归档资料 ${count} 份，累计容量约 ${sizeMb}MB；`,
      '- 完成两轮内部评审，问题清单闭环率 85%；',
      '- 与相关方完成一次范围对齐，变更请求 2 项已登记。',
      '',
      '## 二、质量与风险',
      '1. 抽检发现 3 份材料命名不符合规范，已现场整改。',
      `2. ${theme}涉及的外部依赖交付延迟 2 天，总体进度风险可控。`,
      '3. 建议下期增加一次跨组交叉复核。',
      '',
      '## 三、下期计划',
      `1. 完成 ${theme}剩余工作并在 ${deadline} 前提交评审。`,
      '2. 补齐操作日志与台账，做到可追溯。',
    );
  } else if (kind === 'data') {
    lines.push('date,item,owner,size_mb,status,note');
    for (let row = 0; row < 60; row += 1) {
      const day = shiftDate(row % 30);
      lines.push(
        `${day},${theme}-条目${row + 1},${author},${20 + ((row * 53 + index) % 480)},${row % 7 === 0 ? 'pending' : 'done'},序号${index}${pad(row)}`,
      );
    }
  } else if (kind === 'log') {
    lines.push(`# ${projectName} 值班与操作日志（${theme}）`);
    for (let row = 0; row < 40; row += 1) {
      const day = shiftDate(row % 30);
      lines.push(
        `${day} ${pad(8 + (row % 10))}:${pad((row * 17) % 60)} [INFO] ${theme} 例行检查第 ${row + 1} 项：通过`,
      );
      if (row % 9 === 0) {
        lines.push(`${day} ${pad(8 + (row % 10))}:${pad((row * 23) % 60)} [WARN] 磁盘余量低于阈值，已触发清理任务`);
      }
    }
    lines.push(`# 截至 ${date}，本期无未闭环告警`);
  } else {
    lines.push(
      `${projectName}——${theme}操作规范（v${(index % 5) + 1}.${index % 9}）`,
      '',
      `生效日期：${date}`,
      '',
      '1. 目的与适用范围',
      `   本规范用于约束「${theme}」相关资料的命名、归档与权限管理。`,
      '',
      '2. 命名规则',
      '   文件名 = 项目编号_主题_日期_版本，禁止使用「最终版」「新建文件夹」等无信息量名称。',
      '',
      '3. 归档要求',
      `   - 单文件超过 ${sizeMb}MB 时必须走分片上传并校验哈希；`,
      '   - 涉密与涉外材料一律不放本库；',
      '   - 阶段成果在评审通过后 24 小时内归档。',
      '',
      '4. 权限与审计',
      `   - 按项目成员授权，跨项目访问需领队审批；`,
      `   - 全部下载与删除操作进入操作日志，只增不改。`,
      '',
      `5. 本规范由 ${author} 维护，修订记录见文末。`,
    );
  }
  return lines.join('\n');
}

const KINDS: Array<{ kind: string; ext: string; folderHint: number }> = [
  { kind: 'minutes', ext: 'txt', folderHint: 0 },
  { kind: 'report', ext: 'md', folderHint: 1 },
  { kind: 'data', ext: 'csv', folderHint: 1 },
  { kind: 'log', ext: 'log', folderHint: 0 },
  { kind: 'spec', ext: 'txt', folderHint: 0 },
];

/** MB/GB 量级压测样本（RICH-04 压测样本文件夹）：内容为重复块，sha 稳定可秒传 */
const BIG_FILES: Array<{ fileName: string; sizeBytes: number }> = [
  { fileName: 'RICH-04_压测样本_64MB.bin', sizeBytes: 64 * 1024 * 1024 },
  { fileName: 'RICH-04_压测样本_128MB.bin', sizeBytes: 128 * 1024 * 1024 },
  { fileName: 'RICH-04_压测样本_512MB.bin', sizeBytes: 512 * 1024 * 1024 },
  { fileName: 'RICH-04_压测样本_1GB.bin', sizeBytes: 1024 * 1024 * 1024 },
];
const BIG_BLOCK_BYTES = 64 * 1024 * 1024;

/** 富化种子入口：在基础 demo seed 之上追加。幂等对象落盘（按内容寻址）。 */
export async function seedRichDemo(): Promise<void> {
  const users = await store.listUsers();
  const findUser = (username: string) => users.find((user) => user.username === username);
  const leader = findUser('leader');
  const deputy = findUser('deputy');
  const member = findUser('member');
  if (!leader || !deputy || !member) {
    logger.warn('rich_demo.skipped', { reason: 'demo users missing' });
    return;
  }

  let filesCreated = 0;
  let objectsWritten = 0;
  const started = Date.now();
  let fileIndex = 0;
  const projectIds: Record<string, string> = {};
  const foldersOf: Record<string, Array<{ folderId: string }>> = {};

  for (const spec of PROJECTS) {
    const project = await store.createProject({ projectCode: spec.code, projectName: spec.name });
    projectIds[spec.code] = project.projectId;
    await store.addMember({ projectId: project.projectId, userId: deputy.userId, memberRole: 'DEPUTY_LEADER' });
    await store.addMember({ projectId: project.projectId, userId: member.userId, memberRole: 'MEMBER' });

    const folders = [];
    for (const folderName of spec.folders) {
      folders.push(
        await store.createFolder({
          projectId: project.projectId,
          folderName,
          parentId: null,
          createdBy: leader.userId,
        }),
      );
    }
    foldersOf[spec.code] = folders;

    for (const theme of spec.themes) {
      for (let variant = 0; variant < 2; variant += 1) {
        for (const { kind, ext, folderHint } of KINDS) {
          fileIndex += 1;
          const folder = folders[folderHint % folders.length]!;
          const content = buildContent(kind, theme, spec.name, fileIndex);
          const buffer = Buffer.from(content, 'utf8');
          const sha256 = createHash('sha256').update(buffer).digest('hex');
          const fileName = `${spec.code}_${theme}_${shiftDate(fileIndex % 30)}_${pad(fileIndex % 20)}${variant > 0 ? '_v2' : ''}.${ext}`;

        let objectPath = '';
        if (!(await objectStorage.objectExists(sha256))) {
          const sessionId = randomUUID();
          await objectStorage.saveChunk(sessionId, 0, buffer);
          const stored = await objectStorage.mergeChunks(sessionId, 1, sha256, buffer.byteLength);
          await objectStorage.cleanupSession(sessionId);
          objectPath = stored.objectPath;
          objectsWritten += 1;
        } else {
          objectPath = `objects/${sha256.slice(0, 2)}/${sha256}.bin`;
        }

        await store.addFile({
          projectId: project.projectId,
          folderId: folder.folderId,
          fileName,
          sizeBytes: buffer.byteLength,
          contentType: ext === 'md' ? 'text/markdown' : 'text/plain',
          uploaderId: fileIndex % 3 === 0 ? member.userId : leader.userId,
          sha256,
          objectPath,
        });
        filesCreated += 1;
        }
      }
    }
  }

  logger.info('rich_demo.seeded', {
    projects: PROJECTS.length,
    files: filesCreated,
    objectsWritten,
    durationMs: Date.now() - started,
  });

  // ---------- MB/GB 量级压测样本 ----------
  // 内容 = 重复的 64MB 确定性块：内存峰值有界（不整块分配 GB 级 Buffer），
  // sha 跨启动稳定（objectExists 命中后跳过写盘，但 sha 计算每次启动都要做）。
  const bigFolder = await store.createFolder({
    projectId: projectIds['RICH-04']!,
    folderName: '压测样本',
    parentId: null,
    createdBy: leader.userId,
  });
  const block = Buffer.alloc(BIG_BLOCK_BYTES);
  const pattern = Buffer.from(
    `VaultDeck 压测样本块 ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(12)}\n`,
    'utf8',
  );
  for (let offset = 0; offset < BIG_BLOCK_BYTES; offset += pattern.length) {
    pattern.copy(block, offset);
  }

  for (const big of BIG_FILES) {
    const chunkCount = big.sizeBytes / BIG_BLOCK_BYTES;
    const hash = createHash('sha256');
    for (let i = 0; i < chunkCount; i += 1) hash.update(block);
    const sha256 = hash.digest('hex');

    if (!(await objectStorage.objectExists(sha256))) {
      const sessionId = randomUUID();
      for (let i = 0; i < chunkCount; i += 1) {
        await objectStorage.saveChunk(sessionId, i, block);
      }
      await objectStorage.mergeChunks(sessionId, chunkCount, sha256, big.sizeBytes);
      await objectStorage.cleanupSession(sessionId);
      objectsWritten += 1;
      logger.info('rich_demo.big_object_written', { fileName: big.fileName, sizeBytes: big.sizeBytes });
    }

    await store.addFile({
      projectId: projectIds['RICH-04']!,
      folderId: bigFolder.folderId,
      fileName: big.fileName,
      sizeBytes: big.sizeBytes,
      contentType: 'application/octet-stream',
      uploaderId: leader.userId,
      sha256,
      objectPath: `objects/${sha256.slice(0, 2)}/${sha256}.bin`,
    });
    filesCreated += 1;
  }

  logger.info('rich_demo.big_files_seeded', {
    count: BIG_FILES.length,
    objectsWritten,
    filesTotal: filesCreated,
    durationMs: Date.now() - started,
  });

  // ---------- Office/PDF 预览样例（RICH-03 合同文本文件夹） ----------
  // docx/xlsx/pdf 各一份：给前端预览弹层（docx-preview / ExcelJS / 浏览器原生 PDF）真实样本。
  const contractFolder = foldersOf['RICH-03']?.[0];
  if (!contractFolder) {
    logger.warn('rich_demo.preview_samples_skipped', { reason: 'RICH-03 folder missing' });
    return;
  }
  const previewSamples: Array<{ fileName: string; contentType: string; data: Buffer }> = [
    {
      fileName: 'RICH-03_设备采购合同_v1.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: buildDocxSample(),
    },
    {
      fileName: 'RICH-03_采购说明_v1.pdf',
      contentType: 'application/pdf',
      data: buildPdfSample(),
    },
    {
      fileName: 'RICH-03_评审记录表_v1.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: await buildXlsxSample(),
    },
  ];
  for (const sample of previewSamples) {
    const sha256 = createHash('sha256').update(sample.data).digest('hex');
    if (!(await objectStorage.objectExists(sha256))) {
      const sessionId = randomUUID();
      await objectStorage.saveChunk(sessionId, 0, sample.data);
      await objectStorage.mergeChunks(sessionId, 1, sha256, sample.data.byteLength);
      await objectStorage.cleanupSession(sessionId);
      objectsWritten += 1;
    }
    await store.addFile({
      projectId: projectIds['RICH-03']!,
      folderId: contractFolder.folderId,
      fileName: sample.fileName,
      sizeBytes: sample.data.byteLength,
      contentType: sample.contentType,
      uploaderId: leader.userId,
      sha256,
      objectPath: `objects/${sha256.slice(0, 2)}/${sha256}.bin`,
    });
    filesCreated += 1;
  }
  logger.info('rich_demo.preview_samples_seeded', { count: previewSamples.length });
}
