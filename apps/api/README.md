# apps/api

后台服务模块。M0-01 仅建立目录约定，分层在 M0-02 落地。

## 规划分层

| 层       | 目录                  | 允许依赖                     |
| -------- | --------------------- | ---------------------------- |
| 接口层   | `src/interfaces/http` | application                  |
| 应用层   | `src/application`     | domain、端口接口             |
| 领域层   | `src/domain`          | 无框架、无 SDK               |
| 基础设施 | `src/infrastructure`  | domain、端口接口、第三方 SDK |
| 装配     | `src/composition`     | 全部                         |

约束：

- `domain` 与 `application` 不得引用 NestJS、infrastructure 或第三方 SDK。
- 请求链内不得同步阻塞文件 IO。
- 端口接口定义在 `src/application/ports`，实现放 `src/infrastructure`。
- 第三方类型不得跨越端口边界向上渗透。

## 待建内容（M0-02）

`tsconfig.json`、`main.ts`、健康检查、DI 装配、lint 依赖方向规则。
