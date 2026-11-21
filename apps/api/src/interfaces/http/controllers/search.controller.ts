import { Controller, Get, Headers, Query } from '@nestjs/common';

import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { requireUser } from './auth.controller';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXT_RE = /^[a-z0-9]{1,10}$/;

@Controller('search')
export class SearchController {
  @Get()
  async search(
    @Query('q') keywordRaw: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @Query('categoryId') categoryId: string | undefined,
    @Query('uploaderId') uploaderId: string | undefined,
    @Query('uploadedFrom') uploadedFromRaw: string | undefined,
    @Query('uploadedTo') uploadedToRaw: string | undefined,
    @Query('minSizeBytes') minSizeRaw: string | undefined,
    @Query('maxSizeBytes') maxSizeRaw: string | undefined,
    @Query('extensions') extensionsRaw: string | undefined,
    @Query('page') pageRaw: string | undefined,
    @Query('pageSize') pageSizeRaw: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);

    // 关键词可选，但给了就必须 ≥2（AI 解析出的条件没有关键词时也能搜）
    const keyword = (keywordRaw ?? '').trim().toLowerCase();
    if (keyword.length > 0 && keyword.length < 2) {
      throw new DomainError('VAL', 'VD-VAL-010', '搜索关键词至少 2 个字符', { status: 400 });
    }

    // 日期条件：格式必须是 YYYY-MM-DD，与 file.createdAt 的日期部分做字符串比较（含端点）
    const uploadedFrom = (uploadedFromRaw ?? '').trim();
    if (uploadedFrom && !DATE_RE.test(uploadedFrom)) {
      throw new DomainError('VAL', 'VD-VAL-011', '上传日期下限格式应为 YYYY-MM-DD', { status: 400 });
    }
    const uploadedTo = (uploadedToRaw ?? '').trim();
    if (uploadedTo && !DATE_RE.test(uploadedTo)) {
      throw new DomainError('VAL', 'VD-VAL-011', '上传日期上限格式应为 YYYY-MM-DD', { status: 400 });
    }

    // 大小条件：整数、≥0
    const parseSize = (raw: string | undefined, label: string): number | null => {
      if (raw === undefined || raw.trim() === '') return null;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        throw new DomainError('VAL', 'VD-VAL-011', `${label}应为不小于 0 的整数（字节）`, {
          status: 400,
        });
      }
      return value;
    };
    const minSizeBytes = parseSize(minSizeRaw, '文件大小下限');
    const maxSizeBytes = parseSize(maxSizeRaw, '文件大小上限');

    // 扩展名白名单：逗号拆分、去点、小写、白名单字符
    const extensions = (extensionsRaw ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/^\./, ''))
      .filter((item) => EXT_RE.test(item));

    // 一个条件都没有就拒绝：避免全库扫描式的「空搜索」
    const hasAnyCondition =
      keyword.length > 0 ||
      uploadedFrom !== '' ||
      uploadedTo !== '' ||
      minSizeBytes !== null ||
      maxSizeBytes !== null ||
      extensions.length > 0 ||
      Boolean(projectId) ||
      Boolean(uploaderId);
    if (!hasAnyCondition) {
      throw new DomainError('VAL', 'VD-VAL-011', '请至少提供一个搜索条件', { status: 400 });
    }

    const page = Math.max(1, Number(pageRaw ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(pageSizeRaw ?? 50) || 50));

    const visible = await store.visibleProjectIds(user);
    const projects = await store.listProjects();

    const hits = [];
    for (const project of projects) {
      if (projectId && project.projectId !== projectId) continue;
      if (visible !== null && !visible.includes(project.projectId)) continue;

      const files = await store.listFiles(project.projectId);
      for (const file of files) {
        if (file.status !== 'active') continue;
        if (keyword && !file.fileName.toLowerCase().includes(keyword)) continue;
        const createdDate = file.createdAt.slice(0, 10);
        if (uploadedFrom && createdDate < uploadedFrom) continue;
        if (uploadedTo && createdDate > uploadedTo) continue;
        if (minSizeBytes !== null && file.sizeBytes < minSizeBytes) continue;
        if (maxSizeBytes !== null && file.sizeBytes > maxSizeBytes) continue;
        if (extensions.length > 0) {
          const dot = file.fileName.lastIndexOf('.');
          const ext = dot >= 0 ? file.fileName.slice(dot + 1).toLowerCase() : '';
          if (!extensions.includes(ext)) continue;
        }
        if (uploaderId && file.uploaderId !== uploaderId) continue;
        if (categoryId && categoryId.length === 0) continue;
        if (!(await store.canReadFile(user, file))) continue;

        hits.push({
          fileId: file.fileId,
          fileName: file.fileName,
          sizeBytes: file.sizeBytes,
          contentType: file.contentType,
          projectId: project.projectId,
          projectName: project.projectName,
          folderId: file.folderId,
          uploaderId: file.uploaderId,
          createdAt: file.createdAt,
          hasContent: file.objectPath.length > 0,
        });
      }
    }

    hits.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const start = (page - 1) * pageSize;

    return {
      items: hits.slice(start, start + pageSize),
      total: hits.length,
      page,
      pageSize,
      asOf: new Date().toISOString(),
    };
  }
}
