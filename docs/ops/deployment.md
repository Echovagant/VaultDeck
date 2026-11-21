# 部署手册（Windows 单机）

## 1 目录布局

    %VAULTDECK_HOME%
      current\              当前版本（api、web、migrations）
      releases\<version>\   历史版本，回滚目标
      current.txt           指针文件，内容为当前版本目录名
      runtime\node\         内置 Node 运行时
      tools\nginx\          Nginx for Windows
      tools\libreoffice\    LibreOffice（可选；仅 pptx/老式 Office 高保真预览需要）
      tools\winsw\          WinSW 可执行文件
      data\storage\         文件分片与对象（应用层加密后的密文）
      data\previews\        LibreOffice 转 PDF 缓存（同样按应用层加密落盘）
      data\pgdata\          内置 PostgreSQL 数据目录（由 setup.ps1 初始化）
      certs\                服务器证书与 CA（安装时本机生成）
      logs\                 服务日志
      secrets\              数据库连接串、数据库口令、加密密钥（不提交、不共享）

不使用符号链接：普通用户创建符号链接受限，切换版本改 `current.txt` 并更新服务的 workingdirectory 或复制目录。

## 2 前置组件

| 组件             | 用途                              | 备注                                                             |
| ---------------- | --------------------------------- | ---------------------------------------------------------------- |
| Node.js 24       | 运行后端                          | 随发布包内置，不依赖系统安装                                     |
| PostgreSQL 16    | 数据存储                          | 程序与数据均在非系统盘，`initdb` 初始化                          |
| Nginx 1.30.x     | TLS、静态资源、反代               | Windows 构建为单 worker                                          |
| LibreOffice 26.x | 可选：pptx/老式 Office 高保真预览 | 默认包不包含；需要时用 `msiexec /a` 解包并配置 `VD_SOFFICE_PATH` |
| WinSW 2.x        | 服务守护                          | 从 NuGet 获取，需 .NET Framework 4.8                             |
| restic           | 备份                              | 与 pg_dump 配合，见备份章节                                      |

### 2.1 安全前置（必须）

1. **数据目录 ACL**：`data\storage`、`data\previews`、`secrets`、`certs`、`logs`、PostgreSQL 数据目录只授予 `Administrators`、`SYSTEM` 与实际运行服务的账号；移除 `Authenticated Users` 与 `Users`。修改前备份 ACL，修改后逐个目录用 `icacls` 复核，并验证 API、PostgreSQL 与备份任务仍可读写。
2. **磁盘加密**：系统盘与数据盘启用 BitLocker，恢复密钥离线保存。未加密磁盘被拿走时，文件对象与数据库文件可直接读取，应视为数据泄露。
3. **网络边界**：8443/80 防火墙规则限制为 `LocalSubnet`；不要做公网端口映射。远程访问应通过 VPN 或受控反向代理。
4. **证书**：客户端导入 CA，不要绕过浏览器证书警告；否则 TLS 的中间人防护会失效。
5. **备份凭据**：restic 仓库口令单独保存，ACL 不低于数据目录；仓库与口令不要放在同一块可移动介质上。
6. **应用层加密密钥**：`secrets\encryption.key`（32 字节，安装时生成）用于对象、分片、预览缓存、头像与 MFA 密钥的 AES-256-GCM 加密。密钥丢失即无法解密数据，必须与备份分开保存；不要把密钥提交到仓库或随发布包分发。
7. **MFA**：账号可在“系统设置 → 账号安全”启用 TOTP；启用后登录需要 6 位动态码。MFA 密钥只以加密形式保存在数据库。
8. **双向 TLS（可选）**：需要更强边界时，用 `setup.ps1 -RequireClientCert -ClientName <name>` 生成客户端 CA 与客户端证书，并设置 `VD_REQUIRE_CLIENT_CERT=true`；未携带有效客户端证书的 `/api` 请求会被拒绝（健康检查除外）。

### 2.2 一键部署

离线包可解压到本机任意目录，不要求固定盘符。在包根目录以**管理员** PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

默认 `PackageDir` 为脚本所在目录，`TargetHome` 为 `<PackageDir>\VaultDeck`，目录不存在时自动创建；需要换位置时显式指定：

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1 -TargetHome <部署目录>
```

- **耗时**：通常 3–8 分钟，控制台按 `[n/10]` 输出步骤与已用时间；首次初始化 PostgreSQL 与等待服务启动占大部分时间。
- **环境预检**：第一步检查 64 位 Windows 10 1809+/Windows 11、.NET Framework 4.8（WinSW 依赖）、Windows Firewall 服务是否运行，以及包内 PostgreSQL/Node/Nginx 能否启动；缺 Visual C++ 运行库等系统依赖会在修改任何文件前直接报错。
- **管理员权限用途**：注册 `vaultdeck-api`、`vaultdeck-web` 与 PostgreSQL 服务，写两条 `LocalSubnet` 防火墙规则，写机器级环境变量，收紧 `secrets`/`certs` 的 ACL。除此之外不改系统设置。
- **不会做的事**：不重启电脑、不删除部署目录以外的文件、不把端口开放给公网、不修改已有同名但指向其他数据目录的 PostgreSQL 服务（检测到会直接报错）。
- **中断与重试**：可随时 Ctrl+C；重新执行同一命令会复用已生成的口令与密钥，不会重复初始化。
- **只看计划**：加 `-DryRun`，只打印步骤与目标路径，不做任何修改。
- **开机自启验证**：不要为了验收而重启机器。执行 `Get-Service vaultdeck-api,vaultdeck-web,VaultDeckPostgres | Format-Table Name,Status,StartType`，`StartType` 为 `Automatic` 即表示随 Windows 启动；实际重启验证请在方便时安排。

`setup.ps1` 依次完成：解包（`releases\<version>` 只保留 `current` 快照用于回滚）、初始化 `data\pgdata`、注册 PostgreSQL 服务（默认 `VaultDeckPostgres`，随机器自启）、生成数据库口令与 `secrets\encryption.key`、生成本机 TLS 证书、运行迁移、创建初始领队（`leader`，口令写入 `secrets\initial-admin.txt`，仅空库时执行）、注册 WinSW 服务、配置防火墙、冒烟检查。常用参数：

- `-TargetHome <dir>`：部署目录，默认 `<PackageDir>\VaultDeck`。
- `-DryRun`：只打印计划与目标路径，不做修改。
- `-Force`：目标目录非空且不像 VaultDeck 部署目录时，确认后强制继续。
- `-PgPort 55432`：内置 PostgreSQL 端口，默认避开系统已占用的 5432。
- `-PgServiceName VaultDeckPostgres`：PostgreSQL 的 Windows 服务名；已有同名服务时复用。
- `-HttpsPort 8443 -HttpPort 80`：对外端口。
- `-ApiPort 3000`：后端本机监听端口，同时写入 API 服务定义与 Nginx 反代；被占用时改这里，不要只改 Nginx。
- `-ApiServiceName` / `-WebServiceName`：WinSW 服务名，默认 `vaultdeck-api` / `vaultdeck-web`；同机部署第二套实例时改。
- `-FirewallRulePrefix`：防火墙规则名前缀，默认 `VaultDeck`；同名规则端口不一致时脚本会报错而不是静默跳过。
- `-ServerDns <name> -ServerIp <ip>`：追加证书 SAN，便于局域网 IP 访问。
- `-RequireClientCert -ClientName <name>`：启用双向 TLS。
- `-SkipFirewall -SkipServices -SkipMachineEnv -SkipPgService`：只做准备，不碰对应系统项。

发布包不包含任何证书、私钥或数据库口令；这些都在目标机器上生成，位于 `secrets\` 与 `certs\`。

## 3 证书

服务器证书与 CA 只放在 `certs/`，不提交仓库。安装时由 `setup.ps1` 调用 `gen-certs.mjs` 在本机生成，默认 SAN 为 `localhost`、`vaultdeck.local` 与 `127.0.0.1`；需要局域网 IP 时加 `-ServerDns` / `-ServerIp`。

- CA：自签，10 年有效期，`basicConstraints=critical,CA:TRUE`。
- 服务器证书：825 天有效期，`extKeyUsage=serverAuth`。
- 客户端证书（可选）：独立客户端 CA，`extKeyUsage=clientAuth`；私钥只交给对应设备。
- 通配命名（如 `*.local`）不建议：客户端信任范围过大。

客户端导入（Windows 家庭版无组策略）：

1. 双击 `ca.crt` → 安装证书 → 当前用户 → 放入“受信任的根证书颁发机构”。
2. Chrome / Edge 使用系统证书库，导入后重启浏览器。
3. Firefox 使用独立证书库，需在“隐私与安全 → 证书 → 查看证书 → 证书颁发机构”中单独导入。

浏览器首次访问仍可能提示，属正常；导入后应消失。不要把私钥（`server.key`、`ca.key`）发给任何客户端。

## 4 数据库

`setup.ps1` 会自动初始化 `data\pgdata`、创建 `vaultdeck` 角色与数据库并执行迁移。手工兜底：

1. 初始化数据目录（`initdb`，UTF8，scram-sha-256）。
2. 创建数据库与角色。
3. 执行迁移：

```powershell
$env:VD_DATABASE_URL = "<连接串>"
$env:VD_MIGRATIONS_DIR = "<VAULTDECK_HOME>\current\migrations"
& "<VAULTDECK_HOME>\runtime\node\node.exe" "<VAULTDECK_HOME>\current\api\infrastructure\db\migrate-cli.js"
```

迁移不完整时后端拒绝启动，提示“请先运行 db:migrate”。回滚用 `npm run db:migrate -- --down`（会删除业务表，慎用）。

## 5 服务注册（需要管理员）

WinSW 注册服务、写防火墙规则、导入计算机级证书需要管理员权限。

```powershell
# 以管理员身份运行
& "$env:VAULTDECK_HOME\tools\winsw\WinSW.NET461.exe" install "$env:VAULTDECK_HOME\current\vaultdeck-api.xml"
& "$env:VAULTDECK_HOME\tools\winsw\WinSW.NET461.exe" install "$env:VAULTDECK_HOME\current\vaultdeck-web.xml"
```

环境变量需在系统级设置（`setup.ps1` 会自动写入）：

- `VAULTDECK_HOME`
- `VAULTDECK_DB_URL`（连接串，含口令，只放本机）
- `VD_ENCRYPTION_KEY_FILE`（指向 `secrets\encryption.key`）
- `VD_REQUIRE_CLIENT_CERT`（可选，启用双向 TLS 时设为 `true`）
- `VD_AI_TIMEOUT_MS`（可选，模型调用超时毫秒数，默认 60000；夜间/高峰时段响应慢可调大）

非管理员环境不要注册服务：前台运行 `node current\api\main.js` 与 `nginx.exe`，仅用于开发验证，不作为交付形态。

### 5.1 AI 能力配置

AI 功能（找文件、总结、分类建议）使用 BYOK：模型密钥由使用者在 Web 界面「设置 → AI 服务」中自行填写（领队权限）；服务端以 `encryption.key` 密封存储，界面不回显。

- 供应商从内置目录选择（MiniMax / 智谱 / DeepSeek / 本机 Ollama 等 10 条 OpenAI 兼容接入线），也可自定义端点。
- 保存 API Key 需要 `encryption.key` 存在（即 `VD_ENCRYPTION_KEY_FILE` 指向的文件）；缺失时界面会拒绝保存。
- 查询语句与待总结内容会发送给所选厂商；选择「本机 Ollama / vLLM」则数据不出局域网。
- 模型调用超时或失败均自动降级为普通搜索，不影响核心功能。

### 5.2 Agent 接入（可选）

「后台 → Agent 接入」为外部 Agent（MCP 客户端、Skill 包）发放授权：授权码一次性、15 分钟内有效；Agent 兑换得到访问令牌（`vdak_` 前缀），令牌绑定角色档位与项目范围，撤销立即失效；只读授权的写操作在服务端被拦截。创建、兑换与使用均进审计日志。

离线包 `current\mcp\` 目录内置 MCP Server（零依赖单文件）与安装说明 `MCP-INSTALL.md`；Skill 包从 Releases 页下载，安装步骤见包内 `SKILL.md`。

## 6 启动与回滚

- 启动：`net start vaultdeck-api`、`net start vaultdeck-web`（或 WinSW `start`）。
- 停止：`net stop vaultdeck-api`、`net stop vaultdeck-web`。
- 升级：把新版本解压到 `releases\<version>`，更新 `current.txt` 与服务工作目录，重启两个服务。
- 回滚：`current.txt` 改回上一版本目录，重启服务。数据目录不变。

## 7 防火墙

只放行 8443/TLS（以及可选的 80 跳转）。数据库端口与后端 3000 不对外，仅本机监听。

```powershell
New-NetFirewallRule -DisplayName "VaultDeck HTTPS" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName "VaultDeck HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -RemoteAddress LocalSubnet
```

如未启用 HTTPS，不要直接放行 3000。

## 8 验证清单

1. `https://<host>:8443/` 返回前端页面。
2. `https://<host>:8443/api/v1/system/health` 返回 200。
3. 用三个角色分别登录，项目与文件可见性符合权限矩阵。
4. 上传 10 MB 以上文件，断网 30 秒后续传成功。
5. 下载同一文件，`Range` 请求返回 206。
6. 上传 docx/xlsx，预览应在浏览器内直接渲染（不依赖服务端 LibreOffice）；PDF 用浏览器查看器打开。
7. 若安装了可选 LibreOffice，再验证 pptx 的服务端预览。
8. 删除文件进回收站，恢复后回到原文件夹。
9. 重启两个服务（不是重启电脑），数据仍在（文件数、账号数、审计条数）。
10. 检查 `data\storage\objects` 中对象文件头为 `VDEN1`（应用层加密）；用配置的密钥无法解密时，服务端应明确报错而不是返回明文。
11. 在“系统设置 → 账号安全”启用 TOTP，退出后重新登录，确认需要动态码；停用后恢复仅口令登录。
12. 若启用双向 TLS：无客户端证书访问 `/api/v1/projects` 应返回 401，安装客户端证书后恢复正常。

## 9 已知限制

| 限制                                 | 影响                           | 缓解                                                                          |
| ------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------- |
| Nginx Windows 单 worker、无 sendfile | 高并发下延迟上升               | 文件正文由 Node 流式下发，Nginx 只做反代                                      |
| pptx/老式 Office 需可选 LibreOffice  | 未启用时只能下载               | 默认 docx/xlsx/pdf 已可浏览器预览；需要高保真时再安装并配置 `VD_SOFFICE_PATH` |
| 无 RAID（单机单盘）                  | 磁盘故障即数据丢失             | 每日增量 + 每周全量备份到外置介质                                             |
| 无 UPS                               | 断电可能损坏阵列               | 停机前正常关服务；避免写入高峰断电                                            |
| 加密密钥丢失                         | 历史对象无法解密               | 密钥与备份分开离线保存；迁移前先导出密钥                                      |
| MFA 依赖服务器时间                   | 时间偏差导致验证码失败         | 开启 Windows 时间同步；TOTP 允许前后一个时间窗                                |
| 数据库与预览元数据未应用层加密       | 磁盘被拿走仍可能读到结构化数据 | 依赖 BitLocker + ACL；高敏场景再加数据库加密                                  |
| 主机同时承担开发与服务               | 编译会打断访问                 | 开发实例与演示实例使用不同端口与数据目录                                      |

## 10 数据丢失边界（不可恢复）

VaultDeck 是单机资料管理工具，不是备份系统。回收站与 `scripts/backup` 只能覆盖误删和短时故障；以下情形没有软件层恢复手段：

| 情形                                | 结果                                         | 应对                                                        |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| 删除文件并清空回收站/彻底删除       | 对象与数据库记录一起删除，系统内无副本       | 删除前确认；重要资料保留系统外副本                          |
| 部署机器磁盘损坏、丢失或整机报废    | 文件、数据库、密钥同时不可用                 | 备份到另一块物理介质或另一台机器，定期做恢复演练            |
| `secrets\encryption.key` 丢失或损坏 | 对象、分片、预览、头像无法解密，即使文件仍在 | 密钥离线保存多份，且与备份分开存放                          |
| 数据库损坏且没有 `pg_dump` 备份     | 账号、项目、权限、审计、文件索引无法重建     | 每日 `pg_dump` + restic 备份；定期验证可恢复                |
| 备份仓库口令丢失                    | restic 仓库无法打开，等同于没有备份          | 口令单独保存，ACL 不低于数据目录                            |
| 部署目录被手工清空或格式化          | 运行文件、数据、密钥全部丢失                 | 部署目录不放在临时盘；升级与清理只操作 `current`/`releases` |

对外说明中应明确：**VaultDeck 不能作为资料的唯一副本**。装机验收与交付时应向使用者说明上述边界。
