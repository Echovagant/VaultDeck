import { statfsSync } from 'node:fs';

import { Controller, Get } from '@nestjs/common';

import { store } from '../../infrastructure/store';

interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  storageVolumeFreeBytes?: number;
  activeSessions?: number;
}

@Controller('system/health')
export class HealthController {
  @Get()
  async check(): Promise<HealthResponse> {
    let storageVolumeFreeBytes: number | undefined;
    try {
      const stats = statfsSync(process.cwd());
      storageVolumeFreeBytes = Number(stats.bavail) * Number(stats.bsize);
    } catch {
      storageVolumeFreeBytes = undefined;
    }

    const response: HealthResponse = {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      activeSessions: await store.countActiveSessions(),
    };
    if (storageVolumeFreeBytes !== undefined) {
      response.storageVolumeFreeBytes = storageVolumeFreeBytes;
    }
    return response;
  }
}
