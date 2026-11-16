# api

前端 API 客户端层：由 OpenAPI 契约生成的类型 + 薄 fetch 封装。

## 约束

- 类型只来自 `packages/shared` 的生成产物，禁止手写第二份 DTO。
- 只做请求、鉴权头、错误归一化；不写业务规则。
- 不得引用 `pages`、`features`、`ui`。

## 待建内容（M0-06、M0-07）

契约生成类型、请求封装、Problem Details 错误映射、请求标识透传。
