# contracts

对外契约目录。M0-05 起，`contracts/openapi/v1.yaml` 是前后端唯一接口事实源。

## 规则

- 只有一份 `v1.yaml`，禁止在前后端各维护一套 DTO。
- 修改契约后必须重新生成类型；未重生成时 CI 失败。
- 生成产物禁止手改，生成目录在 `packages/shared/src/generated`。
- URL 版本化：破坏性变更走新版本前缀，不在原版本上改语义。
- 错误体统一使用 Problem Details，业务码前缀为 `VD-`。

## 已落地（M0-05、M0-06）

- `openapi/v1.yaml`：OpenAPI 3.1，覆盖 14 个资源前缀：auth、users、projects、categories、folders、files、upload-sessions、bundles、trash、search、stats、audit、imports、system。
- `.spectral.json`：继承 `spectral:oas`，`operationId`、`operation-tags`、`oas3-api-servers` 为 error 级。
- `packages/shared/src/generated/api.ts`：由契约生成，禁止手改。

## 命令

| 命令                     | 作用                                           |
| ------------------------ | ---------------------------------------------- |
| `npm run contract:lint`  | spectral 校验契约，要求零 error                |
| `npm run contract:gen`   | 重新生成前后端共用类型                         |
| `npm run contract:check` | 比对"重新生成结果"与已提交生成物，不一致即失败 |

## 漂移门禁

已实测：修改 `v1.yaml` 中影响类型的字段但不重新生成时，`contract:check` 返回 1；恢复后返回 0。提交前必须运行 `contract:check`。

## 已知限制

- 本机写 `.yaml` 文件时工具侧校验器异常，改用先写 `.txt` 再改名的方式落盘；不影响文件内容与后续校验。
