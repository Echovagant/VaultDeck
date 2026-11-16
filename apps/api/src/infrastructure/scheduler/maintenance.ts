import type { StorePort } from '../../application/ports/store.port';
import { objectStorage, sweepExpiredUploadSessions } from '../memory/upload-sessions';
import { purgeOldBundles } from '../storage/bundle-store';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** tick 周期与维护执行间隔可用环境变量覆盖（测试/演示用），生产保持默认：分钟级 tick、每小时维护。 */
const TICK_MS = Number(process.env['VD_MAINTENANCE_TICK_MS'] ?? MINUTE_MS);
const MAINTENANCE_INTERVAL_MS = Number(
  process.env['VD_MAINTENANCE_INTERVAL_MS'] ?? HOUR_MS,
);

function log(line: string): void {
  process.stdout.write(`[vaultdeck:maintenance] ${line}\n`);
}

export interface MaintenanceReport {
  purgedFiles: number;
  reclaimedObjects: number;
  expiredSessions: number;
  expiredBundles: number;
}

/** 删除 ref_count 归零对象的磁盘文件；失败只记录，磁盘残留交由对象巡检兜底（遗留项 B7） */
async function reclaimObjects(objectPaths: string[]): Promise<number> {
  let reclaimed = 0;
  for (const objectPath of objectPaths) {
    await objectStorage
      .deleteObject(objectPath)
      .then(() => {
        reclaimed += 1;
      })
      .catch((error: unknown) => {
        log(
          `磁盘对象删除失败：${objectPath} ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
  return reclaimed;
}

/** 到期清理的单次执行：回收站到期文件（含对象回收与磁盘删除）、过期上传会话、过期打包件。全部幂等。 */
export async function runMaintenanceOnce(store: StorePort): Promise<MaintenanceReport> {
  const purge = await store.purgeExpired();
  const reclaimedObjects = await reclaimObjects(purge.reclaimedObjectPaths);
  const expiredSessions = await sweepExpiredUploadSessions();
  const expiredBundles = await purgeOldBundles();

  const report: MaintenanceReport = {
    purgedFiles: purge.purgedFiles,
    reclaimedObjects,
    expiredSessions,
    expiredBundles,
  };
  if (
    report.purgedFiles > 0 ||
    report.reclaimedObjects > 0 ||
    report.expiredSessions > 0 ||
    report.expiredBundles > 0
  ) {
    log(
      `purge_files=${report.purgedFiles} reclaimed_objects=${report.reclaimedObjects} expired_sessions=${report.expiredSessions} expired_bundles=${report.expiredBundles}`,
    );
  }
  return report;
}

/**
 * 应用内维护调度（ADR-005）：分钟级 tick + 墙钟时间比对，Windows 休眠恢复后按墙钟自动补跑；
 * 启动时立即执行一次。job_run 台账、连续失败告警与完整补执行属 B5/B6 范围，后续接入。
 */
export function startMaintenanceScheduler(store: StorePort): { stop(): void } {
  let lastRunAt = 0;
  let running = false;

  void runMaintenanceOnce(store)
    .then(() => {
      lastRunAt = Date.now();
    })
    .catch((error: unknown) => {
      log(`启动首跑失败：${error instanceof Error ? error.message : String(error)}`);
    });

  const timer = setInterval(() => {
    if (running) return;
    if (Date.now() - lastRunAt < MAINTENANCE_INTERVAL_MS) return;
    running = true;
    lastRunAt = Date.now();
    void runMaintenanceOnce(store)
      .catch((error: unknown) => {
        log(`维护任务执行失败：${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        running = false;
      });
  }, TICK_MS);
  timer.unref();

  log(`scheduler started tick=${TICK_MS}ms interval=${MAINTENANCE_INTERVAL_MS}ms`);
  return { stop: () => clearInterval(timer) };
}
