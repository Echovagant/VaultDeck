import { Controller, Get, Headers, Query } from '@nestjs/common';

import { memoryStore } from '../../../infrastructure/memory/memory-store';
import { DomainError } from '../errors/problem-details';
import { requireUser } from './auth.controller';

@Controller('audit')
export class AuditController {
  @Get()
  list(
    @Query('page') pageRaw: string | undefined,
    @Query('pageSize') pageSizeRaw: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    const user = requireUser(authorization);
    if (!memoryStore.canViewAudit(user)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    const page = Math.max(1, Number(pageRaw ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(pageSizeRaw ?? 50) || 50));
    const entries = memoryStore.listAudit(user);
    const start = (page - 1) * pageSize;

    return {
      items: entries.slice(start, start + pageSize),
      total: entries.length,
      page,
      pageSize,
    };
  }
}
