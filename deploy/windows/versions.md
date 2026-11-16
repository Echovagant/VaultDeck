# Windows 部署件版本锁定

本文件记录发布包依赖的外部组件版本与校验值。二进制不入库，开发期存放在 `_private/downloads/`，上线期随发布包离线分发。

## 版本

| 组件              | 版本             | 渠道           | 下载物               | SHA256                                                             |
| ----------------- | ---------------- | -------------- | -------------------- | ------------------------------------------------------------------ |
| Nginx for Windows | 1.30.6（Stable） | nginx.org 官方 | `nginx-1.30.6.zip`   | `c6ee35edb0a861063323f709192ae50d1eefaf2ea7d00678bd2b22d8542dc61e` |
| WinSW             | 2.11.0           | NuGet 官方源   | `winsw-2.11.0.nupkg` | `b73c6c10ee634a782cb74024a4d802a6214647e44c432a2cc34b360c64f84766` |

## 使用说明

- Nginx：解压后取 `nginx.exe` 与 `conf/`，发布包内作为服务运行；仅承担 TLS、静态资源、反代与限流，文件正文由后端流式下发。
- WinSW：`.nupkg` 实为 zip，解压后取 `lib/net461-full/WinSW.NET461.exe`（Windows 10/11 自带 .NET Framework 4.8）；同一目录放服务 XML，重命名为 `vaultdeck-api.exe` + `vaultdeck-api.xml` 即可注册服务。
- 安装脚本必须校验 SHA256，不匹配立即中止。
- 版本变更须同时更新本文件与发布包内的 `SHA256SUMS`。

## 获取路径备注

- GitHub 直连在本机不可达，WinSW 从 NuGet 官方源获取，不要从第三方镜像或博客附件下载。
- NuGet 版本索引会 302 跳转，`curl` 必须带 `-L`。
- 不按"版本号最大"选 Nginx，须认官网 Stable 区块（当前为 1.30.x 偶数系列）。
