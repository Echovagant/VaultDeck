# features

业务组件层：上传队列、文件树、预览器、统计表等。

## 约束

- 可以引用 `ui` 与 `api`。
- 不得引用 `pages`。
- 不直接操作路由；导航由页面层负责。
- 业务状态放本层或页面层的 composable，基础组件不得持有业务状态。

## 依赖方向

    pages → features → ui
    pages → api
    features → api

替换 UI 组件库时只改 `ui`，本层仅做适配。
