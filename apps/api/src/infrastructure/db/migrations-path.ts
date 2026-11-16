import path from 'node:path';

/**
 * 迁移目录的唯一事实源：migrate-cli（应用迁移）与 prepareStore（启动门禁）必须指向同一目录。
 * - 开发态：仓库根为基准（与 migrate-cli 的运行约定一致：服务与 CLI 均从仓库根启动）。
 * - 部署态：发布包把迁移放在 %VAULTDECK_HOME%\current\migrations，由 VD_MIGRATIONS_DIR 指定
 *   （见 deploy/windows/vaultdeck-api.xml 与 build-offline-package.mjs）。
 */
export const migrationsDir = process.env['VD_MIGRATIONS_DIR']
  ? path.resolve(process.env['VD_MIGRATIONS_DIR'])
  : path.resolve('apps/api/src/infrastructure/db/migrations');
