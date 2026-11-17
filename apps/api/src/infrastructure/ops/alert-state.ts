import { statfsSync } from 'node:fs';

import { dataRoot } from '../memory/upload-sessions';

/**
 * 运行时健康与告警状态（B5）：
 * - 磁盘容量从数据根所在卷读取（不是 cwd，避免部署目录与数据目录不同卷时误判）
 * - 5xx 错误按小时桶统计最近 24 小时
 */
const HOUR_MS = 60 * 60 * 1000;
const ERROR_WINDOW_HOURS = 24;
const ERROR_WARN_THRESHOLD = 50;
const DISK_WARN_RATIO = 0.1;
const DISK_BLOCK_RATIO = 0.05;

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface RuntimeAlert {
  code: string;
  level: 'warning' | 'critical';
  message: string;
}

let errorBuckets = new Map<number, number>();

function hourKey(now: number): number {
  return Math.floor(now / HOUR_MS);
}

export function recordServerError(): void {
  const key = hourKey(Date.now());
  errorBuckets.set(key, (errorBuckets.get(key) ?? 0) + 1);
  const oldest = hourKey(Date.now()) - ERROR_WINDOW_HOURS;
  for (const bucket of errorBuckets.keys()) {
    if (bucket < oldest) errorBuckets.delete(bucket);
  }
}

export function countErrors24h(): number {
  const oldest = hourKey(Date.now()) - ERROR_WINDOW_HOURS;
  let total = 0;
  for (const [bucket, count] of errorBuckets) {
    if (bucket >= oldest) total += count;
  }
  return total;
}

/** 仅测试注入用：生产不要设置 */
function freeBytesOverride(): number | null {
  const raw = process.env['VD_TEST_DISK_FREE_BYTES'];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function readDiskUsage(): DiskUsage | null {
  try {
    const stats = statfsSync(dataRoot);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = freeBytesOverride() ?? Number(stats.bavail) * Number(stats.bsize);
    if (totalBytes <= 0) return null;
    return {
      totalBytes,
      freeBytes,
      usedPercent: Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10,
    };
  } catch {
    return null;
  }
}

export function shouldBlockWrites(disk: DiskUsage | null): boolean {
  if (!disk) return false;
  return disk.freeBytes / disk.totalBytes < DISK_BLOCK_RATIO;
}

export function evaluateAlerts(disk: DiskUsage | null): RuntimeAlert[] {
  const alerts: RuntimeAlert[] = [];
  if (disk) {
    const freeRatio = disk.freeBytes / disk.totalBytes;
    if (freeRatio < DISK_BLOCK_RATIO) {
      alerts.push({
        code: 'VD-ALERT-DISK-FULL',
        level: 'critical',
        message: `数据卷可用空间低于 5%（剩余 ${(disk.freeBytes / 1024 ** 3).toFixed(2)} GB），已禁止写入`,
      });
    } else if (freeRatio < DISK_WARN_RATIO) {
      alerts.push({
        code: 'VD-ALERT-DISK-LOW',
        level: 'warning',
        message: `数据卷可用空间低于 10%（剩余 ${(disk.freeBytes / 1024 ** 3).toFixed(2)} GB）`,
      });
    }
  }

  const errors24h = countErrors24h();
  if (errors24h >= ERROR_WARN_THRESHOLD) {
    alerts.push({
      code: 'VD-ALERT-ERRORS',
      level: 'warning',
      message: `最近 24 小时服务端错误 ${errors24h} 次，超过阈值 ${ERROR_WARN_THRESHOLD}`,
    });
  }
  return alerts;
}

/** 仅供测试：重置内存统计 */
export function resetAlertState(): void {
  errorBuckets = new Map<number, number>();
}

export const ALERT_THRESHOLDS = {
  diskWarnRatio: DISK_WARN_RATIO,
  diskBlockRatio: DISK_BLOCK_RATIO,
  errorWarnThreshold: ERROR_WARN_THRESHOLD,
};
