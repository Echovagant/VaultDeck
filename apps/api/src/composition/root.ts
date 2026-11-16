import type { INestApplication } from '@nestjs/common';

/**
 * Composition Root：所有端口到实现的装配只允许发生在这里。
 * M0-09 接入 5 个 Adapter 的 fake 实现；M1/M2/M3 替换为真实实现。
 */
export function configureComposition(_app: INestApplication): void {
  // 装配点预留：Adapter 与用例在此绑定，业务模块不得自行 new 实现。
}
