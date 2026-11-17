# deploy/windows

Windows 单机部署件目录。发布包结构与安装流程见 `docs/ops/deployment.md`。

## 发布包结构

    <package>\
      current\              api + migrations + WinSW 服务定义
      runtime\node\         内置 Node 运行时
      tools\nginx\          Nginx 与前端静态资源
      tools\postgresql\     PostgreSQL 服务器运行时（bin/lib/share）
      tools\winsw\          WinSW 可执行文件
      tools\setup\          证书生成脚本与 node-forge
      setup.ps1             管理员一键部署入口
      install.ps1           仅解包（setup.ps1 内部调用）
      upgrade.ps1           升级
      rollback.ps1          回滚

目标机器上的 `certs\`、`secrets\`、`data\pgdata\` 由 `setup.ps1` 生成，不进入发布包。

## 职责边界

| 组件     | 职责                                                |
| -------- | --------------------------------------------------- |
| WinSW    | 守护后端与 Nginx，崩溃重启、免登录运行、日志重定向  |
| Nginx    | TLS 终止、静态资源、/api 反代、限流；不下发文件正文 |
| 后端     | 文件流式下发、Range、业务与权限、应用层加密         |
| 安装脚本 | 初始化 PostgreSQL、生成密钥/证书、迁移、服务与冒烟  |
| 回滚脚本 | 切换 `current.txt` 指针并重启                       |

## 约束

- 全部离线：依赖、运行时、安装件随包提供，安装过程不访问公网。
- 服务注册、证书生成、防火墙规则需要管理员权限。
- 路径不得写死盘符，使用 `%VAULTDECK_HOME%` 占位。
- 发布包不得包含任何证书、私钥、数据库口令或本机路径。
