# 仓储切换说明（Memory / PostgreSQL）

## 两种模式

| 模式     | 触发方式              | 数据位置   | 用途                         |
| -------- | --------------------- | ---------- | ---------------------------- |
| memory   | 默认，不设 `VD_STORE` | 进程内存   | 快速开发、演示、无数据库环境 |
| postgres | `VD_STORE=postgres`   | PostgreSQL | 实际使用、重启不丢数据       |

业务代码与 API 契约在两种模式下完全一致，控制器统一依赖 `StorePort` 接口，切换只改实现。

## 必填环境变量（postgres 模式）

| 变量                      | 说明                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| `VD_STORE`                | 固定为 `postgres`                                                    |
| `VD_DATABASE_URL`         | PostgreSQL 连接串，真实值放 `_private/db.env`                        |
| `VD_BOOTSTRAP_DEMO`       | 设为 `true` 时，用户表为空会创建演示账号与示例项目；正式环境不要开启 |
| `VD_TRASH_RETENTION_DAYS` | 回收站保留天数，默认 10                                              |

## 启动前检查

- 迁移必须已执行，否则启动直接报错：`数据库未初始化：请先运行 npm run db:migrate`。
- 迁移未完整（少于 3 个版本）同样拒绝启动，避免半迁移状态对外服务。

## 迁移

```bash
npm run db:migrate
```

回滚：

```bash
npm run db:migrate -- --down
```

生产口令与连接串不写入本文件，统一在 `_private/` 维护。

## 认证变化

| 项       | memory 模式 | postgres 模式                          |
| -------- | ----------- | -------------------------------------- |
| 口令     | 演示明文    | scrypt（`scrypt$salt$hash`）           |
| 会话     | 内存 Map    | `user_session` 表，存 token 的 SHA-256 |
| 停用账号 | 内存状态    | `app_user.status`，每次请求校验        |

## 回退

设置 `VD_STORE=memory` 重启即可回到内存模式，数据库数据保留，不影响回退后的功能验证。
