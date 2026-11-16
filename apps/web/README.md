# apps/web

前端应用模块。M0-01 仅建立目录约定，分层在 M0-03 落地。

## 规划分层

| 层         | 目录           | 允许依赖                  |
| ---------- | -------------- | ------------------------- |
| 页面层     | `src/pages`    | features、ui、api、router |
| 业务组件   | `src/features` | ui、api                   |
| 基础组件   | `src/ui`       | 无业务依赖                |
| API 客户端 | `src/api`      | 生成的契约类型            |

约束：

- `ui` 不得引用 `features`、`pages`、`api`、Pinia、router 或业务枚举。
- `features` 不得引用 `pages`。
- 组件库替换只改 `ui` 层，页面与业务组件仅做适配。
- API 类型只来自 `packages/shared` 的生成产物，禁止手写第二份。

## 待建内容（M0-03）

Vite 配置、路由壳、基础布局、三档空页面、lint 依赖方向规则。
