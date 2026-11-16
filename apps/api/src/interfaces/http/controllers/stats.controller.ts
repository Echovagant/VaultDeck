import { randomUUID } from 'node:crypto';

import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import type { StoreUser } from '../../../application/ports/store.port';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

interface ExportBody {
  projectId?: string;
  dims?: string[];
}

const exportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    dims: {
      type: 'array',
      items: { type: 'string', enum: ['project', 'category', 'uploader'] },
    },
  },
};

interface TypeGroup {
  type: string;
  count: number;
  totalBytes: number;
}

interface ProjectStat {
  projectId: string;
  projectCode: string;
  projectName: string;
  totalFiles: number;
  totalBytes: number;
  trashFiles: number;
  trashBytes: number;
  groups: TypeGroup[];
}

interface ExportRecord {
  ownerId: string;
  csv: string;
  expiresAt: number;
}

const exportRecords = new Map<string, ExportRecord>();

function extensionOf(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '').toLowerCase() : 'unknown';
}

async function collect(
  user: StoreUser,
  projectId?: string,
): Promise<{ generatedAt: string; rows: ProjectStat[] }> {
  const visible = await store.visibleProjectIds(user);
  const projects = await store.listProjects();
  const rows: ProjectStat[] = [];

  for (const project of projects) {
    if (projectId && project.projectId !== projectId) continue;
    if (visible !== null && !visible.includes(project.projectId)) continue;

    const files = await store.listFiles(project.projectId);
    const groupMap = new Map<string, TypeGroup>();
    let totalFiles = 0;
    let totalBytes = 0;
    let trashFiles = 0;
    let trashBytes = 0;

    for (const file of files) {
      if (file.status !== 'active') {
        trashFiles += 1;
        trashBytes += file.sizeBytes;
        continue;
      }
      if (!(await store.canReadFile(user, file))) continue;

      const key = extensionOf(file.fileName);
      const group = groupMap.get(key) ?? { type: key, count: 0, totalBytes: 0 };
      group.count += 1;
      group.totalBytes += file.sizeBytes;
      groupMap.set(key, group);
      totalFiles += 1;
      totalBytes += file.sizeBytes;
    }

    rows.push({
      projectId: project.projectId,
      projectCode: project.projectCode,
      projectName: project.projectName,
      totalFiles,
      totalBytes,
      trashFiles,
      trashBytes,
      groups: [...groupMap.values()].sort((left, right) => right.count - left.count),
    });
  }

  return { generatedAt: new Date().toISOString(), rows };
}

function toCsv(rows: ProjectStat[]): string {
  const header = '项目编码,项目名称,资料类型,数量,总字节数';
  const lines = [header];
  for (const row of rows) {
    if (row.groups.length === 0) {
      lines.push(`${row.projectCode},${row.projectName},-,-,-`);
      continue;
    }
    for (const group of row.groups) {
      lines.push(
        `${row.projectCode},${row.projectName},${group.type},${group.count},${group.totalBytes}`,
      );
    }
  }
  return lines.join('\n');
}

@Controller('stats')
export class StatsController {
  @Get('projects')
  async projectStats(
    @Query('projectId') projectId: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (projectId && !(await store.canAccessProject(user, projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }
    const result = await collect(user, projectId);
    return { generatedAt: result.generatedAt, items: result.rows };
  }

  @Post('exports')
  @HttpCode(201)
  async createExport(
    @Body(new StrictBodyPipe<ExportBody>(exportSchema)) body: ExportBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (body.projectId && !(await store.canAccessProject(user, body.projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }

    const result = await collect(user, body.projectId);
    const exportId = randomUUID();
    exportRecords.set(exportId, {
      ownerId: user.userId,
      csv: toCsv(result.rows),
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    return {
      exportId,
      status: 'ready',
      statusUrl: `/api/v1/stats/exports/${exportId}`,
    };
  }

  @Get('exports/:exportId/content')
  async downloadExport(
    @Param('exportId') exportId: string,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await requireUser(authorization);
    const record = exportRecords.get(exportId);
    if (!record || record.ownerId !== user.userId || record.expiresAt < Date.now()) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '导出不存在或已过期', { status: 404 });
    }

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="vaultdeck-stats-${exportId}.csv"`);
    return `\ufeff${record.csv}`;
  }
}
