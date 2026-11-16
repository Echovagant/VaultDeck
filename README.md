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
    docs            设计、决策与运维文档

## 文档索引

- 实现方案：`docs/design/design.md`
- 架构决策：`docs/decisions/`
- 运维文档：`docs/ops/`

## 开发前置

- Node.js 24
- PostgreSQL 16
- git
