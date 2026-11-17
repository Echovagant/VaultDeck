# VaultDeck

本地部署、局域网使用的团队资料管理系统。面向需要把项目资料集中存放、按权限共享、可审计、可备份的团队场景。

![项目总览](docs/assets/screenshots/projects.png)

## 功能特性

- **大文件传输**：分片上传、断点续传、Range 下载、同哈希秒传、ZIP 打包下载
- **内容寻址存储**：文件按 SHA-256 去重，对象与数据库记录分离，删除进入回收站
- **在线预览**：PDF、图片、文本由浏览器原生打开；docx 用 `docx-preview`、xlsx 用 `ExcelJS` 在浏览器渲染；pptx 与老式 Office 格式可选 LibreOffice 服务端转换
- **资料组织**：项目、文件夹、分类、文件名搜索、类型筛选
- **权限与审计**：领队 / 执行领队 / 队员三级角色，项目成员隔离，操作日志追加写入
- **账号管理**：不开放注册，领队可创建账号、重置口令、停用账号
- **统计与导出**：按项目统计文件数、体积、类型分布，支持 CSV 导出
- **回收站**：默认保留 10 天，支持恢复与彻底删除
- **单机部署**：Windows + WinSW 服务 + Nginx TLS，可打离线发布包

## 界面预览

| 示例项目 | 队员视角 |
| --- | --- |
| ![示例项目](docs/assets/screenshots/files.png) | ![队员视角](docs/assets/screenshots/member-files.png) |

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3 + TypeScript + Ant Design Vue |
| 后端 | NestJS 11 + Fastify |
| 数据库 | PostgreSQL 16 |
| 接入层 | Nginx（TLS 终止、静态资源、限流、反向代理） |
| 预览 | 浏览器原生 + docx-preview + ExcelJS；pptx 可选 LibreOffice |
| 备份 | restic + pg_dump |
| 部署 | Windows 单机 + WinSW 服务 |

## 快速开始

环境要求：Node.js 24、npm、Git；使用 PostgreSQL 时另需 PostgreSQL 16。

```bash
npm install
```

### 本地体验（内存存储，重启后数据清空）

```bash
VD_BOOTSTRAP_DEMO=true npm run dev --workspace @vaultdeck/api
npm run dev --workspace @vaultdeck/web
```

Windows PowerShell：

```powershell
$env:VD_BOOTSTRAP_DEMO='true'
npm run dev --workspace @vaultdeck/api
npm run dev --workspace @vaultdeck/web
```

前端默认 `http://localhost:5173`，后端 `http://127.0.0.1:3000`，Vite 会把 `/api` 代理到后端。

### 使用 PostgreSQL

```bash
export VD_STORE=postgres
export VD_DATABASE_URL='postgresql://user:password@127.0.0.1:5432/vaultdeck'
npm run db:migrate
export VD_BOOTSTRAP_DEMO=true
npm run dev --workspace @vaultdeck/api
npm run dev --workspace @vaultdeck/web
```

Windows PowerShell 中把 `export NAME=value` 写成 `$env:NAME='value'`。

首次在空库启动时，`VD_BOOTSTRAP_DEMO=true` 会创建演示账号：

| 账号 | 初始口令 | 角色 |
| --- | --- | --- |
| `leader` | `leader123` | 领队 |
| `deputy` | `deputy123` | 执行领队 |
| `member` | `member123` | 队员 |

演示账号仅用于首次初始化，登录后请立即修改口令；正式环境不要长期保留默认口令。

生产部署、证书、服务注册、升级与回滚见 `docs/ops/deployment.md`。

## 目录

```
apps/api         后端服务
apps/web         前端应用
packages/shared  契约生成类型与共享常量
contracts        对外契约（OpenAPI）
deploy/windows   Windows 发布包与服务定义
docs             设计、决策与运维文档
scripts          开发、验收、备份与发布脚本
```

## 性能参考

同一套代码在不同硬件环境下的传输速度存在明显差异。以下为参考环境实测值，仅作量级参考：

| 环境 | 数据量 | 上传 | 下载 | 备份 |
| --- | --- | --- | --- | --- |
| 内置盘 | 20 × 1 GB，10 并发 | 204.5 MB/s | 526.9 MB/s | 266.2 MB/s |
| 外置盘（USB） | 1 GB，单文件 | 23.0 MB/s | 187.3 MB/s | 38.4 MB/s |
| 外置盘（USB） | 10 × 10 GB，10 并发 | 22.8 MB/s | — | — |
| 外置盘（USB） | 20 GB，单文件 | 30.6 MB/s | — | — |

- 表中内置盘的实测环境为 NVMe SSD，外置盘为 USB 接口；机械硬盘、SATA SSD、不同 USB 版本的速度会明显不同，请以目标机器实测为准。
- 实际速度还受 CPU、内存、网络、文件大小、并发数、杀毒或索引软件等因素影响。
- 上传完成后，服务端还需要合并分片并校验哈希；文件越大、磁盘越慢，这一步耗时越明显。该步骤采用异步任务，客户端会轮询合并状态。
- 秒传仅对系统中已存在的相同文件生效，不会改变首次上传的速度。

## 文档

- 实现方案：`docs/design/design.md`
- 架构决策：`docs/decisions/`
- 运维文档：`docs/ops/`

## License

[MIT](LICENSE)
