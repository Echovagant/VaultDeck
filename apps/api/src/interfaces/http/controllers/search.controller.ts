import { Controller, Get, Headers, Query } from '@nestjs/common';

import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { requireUser } from './auth.controller';

@Controller('search')
export class SearchController {
  @Get()
  async search(
    @Query('q') keywordRaw: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @Query('categoryId') categoryId: string | undefined,
    @Query('uploaderId') uploaderId: string | undefined,
    @Query('page') pageRaw: string | undefined,
    @Query('pageSize') pageSizeRaw: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);

    const keyword = (keywordRaw ?? '').trim().toLowerCase();
    if (keyword.length < 2) {
      throw new DomainError('VAL', 'VD-VAL-010', '搜索关键词至少 2 个字符', { status: 400 });
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
        if (!file.fileName.toLowerCase().includes(keyword)) continue;
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
