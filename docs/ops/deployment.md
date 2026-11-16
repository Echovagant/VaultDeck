# 部署手册（Windows 单机）

## 1 目录布局

    %VAULTDECK_HOME%
      current\              当前版本（api、web、migrations）
      releases\<version>\   历史版本，回滚目标
      current.txt           指针文件，内容为当前版本目录名
      runtime\node\         内置 Node 运行时
      tools\nginx\          Nginx for Windows
      tools\libreoffice\    LibreOffice（Office 预览）
      tools\winsw\          WinSW 可执行文件
      data\storage\         文件分片与对象
      data\previews\        Office 转 PDF 缓存
      certs\                服务器证书与 CA
      logs\                 服务日志
      secrets\              数据库连接串（不提交、不共享）

不使用符号链接：普通用户创建符号链接受限，切换版本改 `current.txt` 并更新服务的 workingdirectory 或复制目录。

## 2 前置组件

| 组件             | 用途                | 备注                                    |
| ---------------- | ------------------- | --------------------------------------- |
| Node.js 24       | 运行后端            | 随发布包内置，不依赖系统安装            |
| PostgreSQL 16    | 数据存储            | 程序与数据均在非系统盘，`initdb` 初始化 |
| Nginx 1.30.x     | TLS、静态资源、反代 | Windows 构建为单 worker                 |
| LibreOffice 26.x | Office 转 PDF       | 用 `msiexec /a` 解包，无需管理员        |
| WinSW 2.x        | 服务守护            | 从 NuGet 获取，需 .NET Framework 4.8    |
| restic           | 备份                | 与 pg_dump 配合，见备份章节             |

## 3 证书

服务器证书与 CA 只放在 `certs/`，不提交仓库。生成方式：

- CA：自签，10 年有效期，`basicConstraints=critical,CA:TRUE`。
- 服务器证书：SAN 包含 `localhost`、内网主机名与 `127.0.0.1`，825 天有效期。
- 通配命名（如 `*.local`）不建议：客户端信任范围过大。

客户端导入（Windows 家庭版无组策略）：

1. 双击 `ca.crt` → 安装证书 → 当前用户 → 放入“受信任的根证书颁发机构”。
2. Chrome / Edge 使用系统证书库，导入后重启浏览器。
3. Firefox 使用独立证书库，需在“隐私与安全 → 证书 → 查看证书 → 证书颁发机构”中单独导入。

浏览器首次访问仍可能提示，属正常；导入后应消失。不要把私钥（`server.key`、`ca.key`）发给任何客户端。

## 4 数据库

1. 初始化数据目录（`initdb`，UTF8，scram-sha-256）。
2. 创建数据库与角色。
3. 执行迁移：

```powershell
$env:VD_DATABASE_URL = "<连接串>"
npm run db:migrate
```

迁移不完整时后端拒绝启动，提示“请先运行 db:migrate”。回滚用 `npm run db:migrate -- --down`（会删除业务表，慎用）。

## 5 服务注册（需要管理员）

WinSW 注册服务、写防火墙规则、导入计算机级证书需要管理员权限。

```powershell
# 以管理员身份运行
& "$env:VAULTDECK_HOME\tools\winsw\WinSW.NET461.exe" install "$env:VAULTDECK_HOME\current\vaultdeck-api.xml"
& "$env:VAULTDECK_HOME\tools\winsw\WinSW.NET461.exe" install "$env:VAULTDECK_HOME\current\vaultdeck-web.xml"
```

环境变量需在系统级设置：

- `VAULTDECK_HOME`
- `VAULTDECK_DB_URL`（连接串，含口令，只放本机）

非管理员环境不要注册服务：前台运行 `node current\api\main.js` 与 `nginx.exe`，仅用于开发验证，不作为交付形态。

## 6 启动与回滚

- 启动：`net start vaultdeck-api`、`net start vaultdeck-web`（或 WinSW `start`）。
- 停止：`net stop vaultdeck-api`、`net stop vaultdeck-web`。
- 升级：把新版本解压到 `releases\<version>`，更新 `current.txt` 与服务工作目录，重启两个服务。
- 回滚：`current.txt` 改回上一版本目录，重启服务。数据目录不变。

## 7 防火墙

只放行 8443/TLS。数据库端口与后端 3000 不对外，仅本机监听。

```powershell
New-NetFirewallRule -DisplayName "VaultDeck HTTPS" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow
```

如未启用 HTTPS，不要直接放行 3000。

## 8 验证清单

1. `https://<host>:8443/` 返回前端页面。
2. `https://<host>:8443/api/v1/system/health` 返回 200。
3. 用三个角色分别登录，项目与文件可见性符合权限矩阵。
4. 上传 10 MB 以上文件，断网 30 秒后续传成功。
5. 下载同一文件，`Range` 请求返回 206。
6. 上传 docx，等待后台预转换后预览应接近秒开。
7. 删除文件进回收站，恢复后回到原文件夹。
8. 重启两个服务，数据仍在（文件数、账号数、审计条数）。

## 9 已知限制

| 限制                                 | 影响               | 缓解                                     |
| ------------------------------------ | ------------------ | ---------------------------------------- |
| Nginx Windows 单 worker、无 sendfile | 高并发下延迟上升   | 文件正文由 Node 流式下发，Nginx 只做反代 |
| Office 首次转换约 17–22 秒           | 首次预览等待       | 上传后自动后台预转换，命中缓存约 100 ms  |
| 无 RAID（单机单盘）                  | 磁盘故障即数据丢失 | 每日增量 + 每周全量备份到外置介质        |
| 无 UPS                               | 断电可能损坏阵列   | 停机前正常关服务；避免写入高峰断电       |
| 主机同时承担开发与服务               | 编译会打断访问     | 开发实例与演示实例使用不同端口与数据目录 |
