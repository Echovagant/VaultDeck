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

| 示例项目                                       | 队员视角                                              |
| ---------------------------------------------- | ----------------------------------------------------- |
| ![示例项目](docs/assets/screenshots/files.png) | ![队员视角](docs/assets/screenshots/member-files.png) |

## 技术栈

| 层     | 选型                                                       |
| ------ | ---------------------------------------------------------- |
| 前端   | Vue 3 + TypeScript + Ant Design Vue                        |
| 后端   | NestJS 11 + Fastify                                        |
| 数据库 | PostgreSQL 16                                              |
| 接入层 | Nginx（TLS 终止、静态资源、限流、反向代理）                |
| 预览   | 浏览器原生 + docx-preview + ExcelJS；pptx 可选 LibreOffice |
| 备份   | restic + pg_dump                                           |
| 部署   | Windows 单机 + WinSW 服务                                  |

## 快速开始

环境要求：Node.js 24、npm、Git；使用 PostgreSQL 时另需 PostgreSQL 16。

### 离线包一键部署（推荐）

把发布包解压到本机任意目录（盘符与路径不限），在包根目录以**管理员** PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

- 默认部署目录为 `<发布包目录>\VaultDeck`，不存在时自动创建；需要换位置时加 `-TargetHome <部署目录>`。
- 预计 3–8 分钟，控制台按 `[n/9]` 显示当前步骤与已用时间。
- 需要管理员权限：注册 `vaultdeck-api`、`vaultdeck-web` 与 PostgreSQL 三个 Windows 服务，添加两条本地子网防火墙规则，写机器级环境变量，收紧 `secrets`/`certs` 目录 ACL。
- 脚本不会重启电脑、不会删除部署目录以外的文件、不会把端口开放给公网。可随时 Ctrl+C 中断，重新执行会复用已生成的口令与密钥。
- 只想先看它准备做什么：加 `-DryRun`，只打印计划，不做任何修改。

脚本会初始化内置 PostgreSQL、生成数据库口令与加密密钥、生成本机 TLS 证书、执行迁移、创建初始领队 `leader`（口令写入 `secrets\initial-admin.txt`）、注册服务并做冒烟检查。数据库口令、加密密钥、证书都在部署目录内自动生成，不依赖固定盘符，也不需要预先创建目录；详细参数见 `docs/ops/deployment.md`。

### 源码开发（clone 后本地运行）

```bash
npm install
```

`npm install` 约 1–3 分钟，随后按下方“本地体验”启动即可，开发模式不需要管理员权限。注意：**从源码构建离线发布包还需要 Nginx、PostgreSQL、WinSW、restic 的官方安装件，仓库不包含这些二进制**；面向实际使用的部署请直接下载 Release 页面的离线包。

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

| 账号     | 初始口令    | 角色     |
| -------- | ----------- | -------- |
| `leader` | `leader123` | 领队     |
| `deputy` | `deputy123` | 执行领队 |
| `member` | `member123` | 队员     |

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

| 环境          | 数据量              | 上传       | 下载       | 备份       |
| ------------- | ------------------- | ---------- | ---------- | ---------- |
| 内置盘        | 20 × 1 GB，10 并发  | 204.5 MB/s | 526.9 MB/s | 266.2 MB/s |
| 外置盘（USB） | 1 GB，单文件        | 23.0 MB/s  | 187.3 MB/s | 38.4 MB/s  |
| 外置盘（USB） | 10 × 10 GB，10 并发 | 22.8 MB/s  | —          | —          |
| 外置盘（USB） | 20 GB，单文件       | 30.6 MB/s  | —          | —          |

- 表中内置盘的实测环境为 NVMe SSD，外置盘为 USB 接口；机械硬盘、SATA SSD、不同 USB 版本的速度会明显不同，请以目标机器实测为准。
- 实际速度还受 CPU、内存、网络、文件大小、并发数、杀毒或索引软件等因素影响。
- 上传完成后，服务端还需要合并分片并校验哈希；文件越大、磁盘越慢，这一步耗时越明显。该步骤采用异步任务，客户端会轮询合并状态。
- 秒传仅对系统中已存在的相同文件生效，不会改变首次上传的速度。

## 安全说明

- 传输：HTTPS/TLS 1.2+、HSTS、CSP；登录会话使用 HttpOnly + SameSite=Strict Cookie。
- 权限：三角色、项目成员隔离、操作审计、登录限流；文件下载、预览与打包都校验权限。
- 存储：文件对象、上传分片、预览缓存与头像使用 AES-256-GCM 应用层加密，密钥保存在部署目录的 `secrets\encryption.key`，不随仓库或发布包分发。
- 登录：支持 TOTP 双重验证（MFA），可在“系统设置 → 账号安全”启用；MFA 密钥加密后存入数据库。
- 边界：可选双向 TLS（客户端证书）；8443/80 防火墙规则限制为局域网；数据库与后端端口只监听本机。
- 部署前置：数据目录 ACL 仅授予 Administrators、SYSTEM 与服务账号；启用 BitLocker 并离线保存恢复密钥；备份口令与备份仓库分开保存。
- 数据库中的结构化元数据未做应用层加密，依赖 BitLocker 与 ACL；不要把 8443 直接暴露到公网。加密密钥丢失后历史对象无法解密，必须与备份分开离线保存。

## 数据丢失与不可恢复

本项目不是云盘，也不是备份系统；回收站和备份脚本只能覆盖部分误删与短时故障。以下情形**数据无法通过本系统恢复**，请提前知悉：

- **主动删除且清空回收站**：在界面中删除文件后，如果又清空了回收站或执行“彻底删除”，文件对象与数据库记录会一并删除，系统内没有副本。
- **部署机器损坏、丢失或报废**：单机部署没有副本机制；如果同时没有可用的备份，文件和元数据都会永久丢失。请把备份放到另一块物理介质或另一台机器，并定期做恢复演练。
- **加密密钥丢失**：`secrets\encryption.key` 一旦丢失或损坏，磁盘上的对象、分片、预览、头像即使还在也无法解密。密钥必须与备份分开、离线保存多份。
- **数据库损坏且没有备份**：账号、项目、权限、审计与文件索引无法重建；文件对象可能仍在 `data\storage` 下，但已失去可用的对应关系。
- **备份仓库口令丢失**：restic 仓库内的备份无法打开，等同于没有备份。

因此：不要把 VaultDeck 当作唯一副本；重要资料至少保留一份系统外的独立备份。备份与恢复方法见 `docs/ops/deployment.md`。

## 文档

- 实现方案：`docs/design/design.md`
- 架构决策：`docs/decisions/`
- 运维文档：`docs/ops/`

## License

[MIT](LICENSE)
