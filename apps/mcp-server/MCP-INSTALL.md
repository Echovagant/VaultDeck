# VaultDeck MCP Server 安装说明

把局域网内的 VaultDeck 资料库接入任意支持 MCP（Model Context Protocol）的客户端（Claude Desktop、Cherry Studio、Cursor 等），让 AI 助手可以直接找文件、总结内容、下载与上传。

## 前置条件

1. 本机与 VaultDeck 服务在同一内网（或 VPN）。
2. Node.js ≥ 18。
3. 一枚有效的 **Agent 访问令牌**（`vdak_` 开头）：由 VaultDeck 领队在「后台 → Agent 接入」创建授权码，Agent 用授权码兑换令牌；或领队直接发放令牌。
4. 本目录下的 `vaultdeck-mcp.mjs`（零第三方依赖，无需 npm install）。

## 客户端配置示例

在 MCP 客户端的配置文件中加入（以 Claude Desktop 为例，其它客户端字段相同）：

```json
{
  "mcpServers": {
    "vaultdeck": {
      "command": "node",
      "args": ["<路径>/current/mcp/vaultdeck-mcp.mjs"],
      "env": {
        "VD_VAULTDECK_URL": "https://<主机地址>:8443",
        "VD_VAULTDECK_TOKEN": "<vdak_ 开头的访问令牌>"
      }
    }
  }
}
```

保存后重启客户端，即可在对话中使用以下工具：

| 工具 | 说明 |
| --- | --- |
| list_projects | 列出你有权访问的项目 |
| search_files | 按文件名 / 日期 / 大小 / 扩展名条件搜索 |
| ai_find_files | 一句话自然语言找文件（模型能力由 VaultDeck 服务端提供） |
| ai_summarize_file | 总结一个纯文本类文件的内容 |
| ai_classify_project | 对项目内文件批量给出分类建议 |
| download_file / upload_file | 下载 / 上传（上传需读写授权） |

## 安全说明

- 权限在 VaultDeck 服务端按授权范围过滤：Agent 拿不到范围外的任何数据。
- 只读授权的全部写操作在服务端被拦截。
- 授权被撤销后令牌立即失效。
- `ai_find_files` / `ai_summarize_file` 会把查询语句或文件内容发送给 VaultDeck 服务端配置的模型厂商（本机 Ollama 不出局域网）；其余工具纯内网。
- 令牌即身份：不要写入仓库或日志，泄露后请领队立即撤销。
