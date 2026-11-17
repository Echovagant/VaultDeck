import { Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';

import { getLastIntegrityReport, runIntegrityScan } from '../../../infrastructure/ops/integrity-scan';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { requireUser } from './auth.controller';

@Controller('system/integrity')
export class SystemIntegrityController {
  @Get()
  async last(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }
    return getLastIntegrityReport() ?? { status: 'never-run' };
  }

  @Post('scan')
  @HttpCode(200)
  async scan(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }
    try {
      return await runIntegrityScan(store);
    } catch (error) {
      if (error instanceof Error && error.message === 'INTEGRITY_SCAN_RUNNING') {
        throw new DomainError('VAL', 'VD-VAL-409', '巡检正在进行中', { status: 409 });
      }
      throw error;
    }
  }
}
