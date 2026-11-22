---
name: vaultdeck
description: 操作局域网内的 VaultDeck 资料库：按项目找文件（支持 AI 自然语言检索）、下载与上传文件。当用户要求访问 VaultDeck、内网资料库、团队归档文件，或要在内网检索、取回、存放文件时使用。需要管理员发放的授权码或访问令牌。
---

# VaultDeck 资料库

局域网内自托管的团队资料库。所有操作的权限过滤都在 VaultDeck 服务端完成：你能看到什么，由管理员发授权时绑定的角色与项目范围决定。

环境要求：Node ≥ 18，且本机与 VaultDeck 服务在同一内网（或 VPN）。

## 授权（一次性，先做这个）

从安装指令或管理员处拿到两样东西：**VaultDeck 地址** 与 **授权码**（`vda-` 开头，15 分钟内有效、只能用一次）。

```bash
node scripts/vaultdeck.mjs exchange --url https://<主机>:8443 --code vda-xxxxxx
```

成功会输出一个 `vdak_` 开头的访问令牌。把它保存到环境变量 `VD_VAULTDECK_TOKEN`（不要写进任何文件）；之后的所有命令自动读取，也可用 `--token` 显式传入。授权码用一次即作废；令牌丢失请找管理员撤销重发。

## 能做什么

```bash
# 项目清单（名称、编码、文件数、容量）
node scripts/vaultdeck.mjs projects

# 条件搜文件（全部条件可选组合；关键词至少 2 个字符）
node scripts/vaultdeck.mjs search --keyword 合同 --from 2026-11-01 --to 2026-11-21 --ext pdf,docx --min-size 104857600

# AI 找文件：一句话描述，服务端用已配置的模型解析成条件再检索（无需自带模型 key）
node scripts/vaultdeck.mjs ai-find "上周上传的超过100MB的视频"

# AI 总结：对单个纯文本类文件（txt/md/csv/log/json）输出摘要与关键词
node scripts/vaultdeck.mjs summarize <fileId>

# AI 分类建议：对项目内文件批量给出类目建议与理由（只提议，不自动落库）
node scripts/vaultdeck.mjs classify --project <projectId>

# 下载（fileId 来自 search / ai-find 的输出）
node scripts/vaultdeck.mjs download <fileId> ./保存位置.bin

# 上传（需要读写授权；支持秒传与断点续传，单文件上限 20GB）
node scripts/vaultdeck.mjs upload ./本地文件.xlsx --project <projectId>
```

命令输出里都能拿到 `fileId` 与 `projectId`，下一步直接引用。

## 约束（违反了会被服务端拒绝）

- 只读授权执行上传等写操作会被服务端 403 拦截；这是设计行为，不是故障。
- 授权被管理员撤销后令牌立即失效（报「令牌无效或已撤销」）。
- `ai-find` 会把你这句话发送给 VaultDeck 服务端配置的模型厂商；`search` / `download` / `upload` 纯内网。对数据边界敏感的用户优先用 `search`。
- 令牌即身份：不要发给无关的人，不要写进仓库或日志。
