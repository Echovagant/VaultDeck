import path from 'node:path';

/**
 * 迁移目录的唯一事实源：migrate-cli（应用迁移）与 prepareStore（启动门禁）必须指向同一目录。
 * 以仓库根为基准（与 migrate-cli 的运行约定一致：服务与 CLI 均从仓库根启动）。
 */
export const migrationsDir = path.resolve('apps/api/src/infrastructure/db/migrations');
