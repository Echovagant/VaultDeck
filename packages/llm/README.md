# @vaultdeck/llm

BYOK（用户自带 Key）LLM 供应商接入底座：**厂商目录表 + 密钥提供方抽象 + OpenAI 兼容协议最小客户端**。零第三方依赖，Node ≥ 24，密钥一律由调用方注入（本包不含任何 API key）。

为后续的 AI 能力（帮用户整理文件、查找文件、下载文件、上传文件）提供统一的模型调用入口。

## 包含什么

| 文件 | 内容 |
|---|---|
| src/key-provider.ts | KeyProvider 接口与实现（BYOK / 会话内存 / 托管占位 / MiniMax）、KeyProviderRegistry、LlmCredentials、redactSecrets |
| src/providers.ts | LLM_PROVIDERS 厂商目录（10 条接入线）、findProvider、detectProviderByKey、OpenAiCompatibleProvider |
| src/chat-client.ts | 纯 fetch 协议客户端：listModelIds、chatOnce、两种错误体解析、清单三级降级、fetch 可注入 |

## 用法

```js
import { findProvider, detectProviderByKey, OpenAiCompatibleProvider } from '@vaultdeck/llm';
import { chatOnce } from '@vaultdeck/llm';

// 认出用户粘的 key 是哪家的（认不出返回 null，不硬猜）
detectProviderByKey('sk-cp-xxxx');

// 发请求：密钥由你注入，本包不存、不缓存、不进日志
const res = await chatOnce({
  apiKey: process.env.MY_LLM_KEY,
  baseUrl: findProvider('minimax-cn').baseUrl,
  model: 'MiniMax-M3.1-Flash',
  effort: 'max',
});
```

## 密钥红线（不得违反）

- 本包**不含任何 API key**：密钥由调用方运行时注入（环境变量 / 内存 / 请求携带），唯一的取密钥入口是构造参数里的 CredentialReader 函数。
- 密钥不落盘明文、不进日志：报错信息出包前一律过 redactSecrets(text, [key])。
- 对外只暴露布尔状态 hasCredentials()，没有取回密钥的接口。

## API 摘要

- LLM_PROVIDERS：10 条接入线（MiniMax 国内/国际、智谱 GLM、阿里百炼、火山方舟、DeepSeek、Kimi、硅基流动、本机 Ollama、自定义端点）
- findProvider(id) / detectProviderByKey(key) / LLM_FAMILY_LABELS
- KeyProvider 接口 + ByokKeyProvider / SessionKeyProvider / ManagedKeyProvider / MiniMaxProvider / KeyProviderRegistry
- OpenAiCompatibleProvider：端点与模型是取值函数，用户切换接入线立刻生效
- chatOnce / listModelIds / extractErrorMessage / parseModelIds / parseChatReply / pickModelsAfterFailure / LlmApiError（status=0 网络层失败，非 0 服务端状态码）/ DEFAULT_MAX_TOKENS=8192
- redactSecrets(text, secrets)：错误信息与日志的最后一道防线

## 接入新供应商

1. 在 key-provider.ts 的 LlmProviderId 联合类型里加 id —— 目录里写了联合类型没有的 id，编译就报错，这是故意的防呆设计。
2. 在 providers.ts 的 LLM_PROVIDERS 加一条：baseUrl、modelsSupported、family、keyPrefixes、effortLevels、note。
3. 实测后再写表（别抄文档）：GET {base}/models，401/403=端点在且要鉴权，200=清单公开，404=不支持拉清单；拿到 401 只证明端点存在，套餐有没有权限要拿真 key 再测一次。
4. keyPrefixes 只放有区分度的前缀：sk- 这种通用前缀不能当特征（DeepSeek/Kimi/硅基流动全是 sk- 开头）。同厂商多条线时按前缀长度从长到短匹配。
5. effortSupported 默认按不认处理：reasoning_effort 不是 OpenAI 兼容协议的通用标准，多数实现遇到不认识的参数直接 400——少传最多损失档位，多传是整次请求失败。

## 已沉淀的坑（接新功能不用再踩一遍）

- max_tokens 不能小：推理 token 也计入 max_tokens，太小正文被思考吃光，表现为「返回了响应但读不出内容」。
- GET 不能带 body：undici（Node 自带 fetch）直接拒绝，连空串都不行。
- Coding Plan 类套餐 key 不接 API：条款限定编程工具内使用（百炼、火山方舟），目录 note 里写明，别偷偷加回来。
- 模型名不写死：实时拉 /models 才准；静态清单只作离线兜底（pickModelsAfterFailure 三级降级 api/stale/fallback）。
- 认不出就不提示：detectProviderByKey 猜错比不猜更糟。

## 边界（如实说）

- 目录表 10 条线全是 OpenAI 兼容协议；anthropic / gemini / openai 在类型里留位但没有目录条目，Anthropic 原生协议无实现。
- 「记住密钥」（操作系统级加密存储）与服务端多来源凭证接线不在本包内，由上层应用按需实现。

## 验证

- npm run typecheck --workspace @vaultdeck/llm：0 错误
- npm run test --workspace @vaultdeck/llm：17 个用例全过（假 fetch，不联网）
- 密钥扫描：包内无真实 key（只有类型、前缀模式与兜底正则）
