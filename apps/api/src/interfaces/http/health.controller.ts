import { Controller, Get } from '@nestjs/common';

import {
  countErrors24h,
  evaluateAlerts,
  readDiskUsage,
  shouldBlockWrites,
  type RuntimeAlert,
} from '../../infrastructure/ops/alert-state';
import { previewAdapter } from '../../infrastructure/preview';
import { store } from '../../infrastructure/store';

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  activeSessions: number;
  storageVolumeFreeBytes: number | null;
  storage: {
    totalBytes: number;
    freeBytes: number;
    usedPercent: number;
    writeBlocked: boolean;
  } | null;
  errors24h: number;
  alerts: RuntimeAlert[];
  preview: {
    officeServer: boolean;
  };
}

@Controller('system/health')
export class HealthController {
  @Get()
  async check(): Promise<HealthResponse> {
    const disk = readDiskUsage();
    const alerts = evaluateAlerts(disk);
    const critical = alerts.some((alert) => alert.level === 'critical');

    return {
      status: critical ? 'degraded' : 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      activeSessions: await store.countActiveSessions(),
      storageVolumeFreeBytes: disk ? disk.freeBytes : null,
      storage: disk
        ? {
            totalBytes: disk.totalBytes,
            freeBytes: disk.freeBytes,
            usedPercent: disk.usedPercent,
            writeBlocked: shouldBlockWrites(disk),
          }
        : null,
      errors24h: countErrors24h(),
      alerts,
      preview: { officeServer: previewAdapter.capabilities().supported },
    };
  }
}
