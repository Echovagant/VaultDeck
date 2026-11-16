# VaultDeck

本地部署、局域网使用的团队资料管理系统。支持大文件分片上传与断点续传、文件夹管理、文件名搜索、Office/PDF 在线预览、项目与类型分类、三级权限、操作审计、10 天回收站、按项目统计与 CSV 导出。

## 技术栈

| 层     | 选型                                    |
| ------ | --------------------------------------- |
| 前端   | Vue3 + TypeScript + Element Plus        |
| 后端   | NestJS（TypeScript）                    |
| 数据库 | PostgreSQL                              |
| 接入层 | Nginx（TLS 终止、静态资源、限流、反代） |
| 预览   | pdf.js + LibreOffice headless 转 PDF    |
| 备份   | restic + pg_dump                        |
| 部署   | Windows 单机 + WinSW 服务               |

## 目录

    apps/api        后端服务
    apps/web        前端应用
    packages/shared 契约生成类型与共享常量
    contracts       对外契约
    deploy/windows  Windows 发布包与服务定义
    docs            需求、设计、决策、计划、运维与验收
    tasks.md        任务清单

## 文档索引

- 需求规格：`docs/specs/requirements.md`
- 实现方案：`docs/design/design.md`
- 架构决策：`docs/decisions/`
- 项目计划：`docs/plans/project-plan.md`
- 任务清单：`tasks.md`

## 开发前置

- Node.js 24
- PostgreSQL 16
- git

## 约定

- 公开仓库，不得提交设备型号、采购信息、网段、主机名、盘符、真实账号与真实姓名。
- 私有信息统一放 `_private/`，该目录已被 `.gitignore` 排除。
- 文档与目录命名使用英文小写；代码标识符使用英文。
- 契约以 `contracts/openapi/v1.yaml` 为唯一事实源，DTO 类型由它生成，禁止手写第二份。
