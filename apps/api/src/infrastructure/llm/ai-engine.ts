/**
 * AI 引擎：把 store 里的 AI 设置解析成可调用配置，并包出对话 / 拉清单两个入口。
 *
 * 密钥红线：apiKey 只在内存里流转（store 取出 → chatOnce 请求头），
 * 不进日志、不回传前端；错误消息出引擎前一律过 redactSecrets。
 */
import {
  LLM_PROVIDERS,
  listModelIds,
  pickModelsAfterFailure,
  redactSecrets,
  chatOnce,
  findProvider,
  type ChatOptions,
  type LlmProviderEntry,
} from '@vaultdeck/llm';

import type { AiSettingsView } from '../../application/ports/store.port';

/** 一次模型调用所需的完整配置（apiKey 由调用方从 store 现取） */
export interface ResolvedAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  effort?: string;
}

/**
 * 设置 + 明文密钥 → 可调用配置；缺一项就返回 null（上层据此走「未配置」分支）。
 * baseUrl/model 允许用户手填覆盖目录值；手填都没有时退回目录默认。
 */
export function resolveAiConfig(
  settings: AiSettingsView,
  apiKey: string | null,
): ResolvedAiConfig | null {
  if (!apiKey || !settings.providerId) return null;
  const provider = findProvider(settings.providerId);
  const baseUrl = settings.baseUrl?.trim() || provider?.baseUrl || '';
  const model = settings.model?.trim() || provider?.fallbackModels?.[0] || '';
  if (!baseUrl || !model) return null;
  const effort = settings.effort?.trim();
  return effort ? { apiKey, baseUrl, model, effort } : { apiKey, baseUrl, model };
}

/** 模型调用超时：默认 60s（实测 max 档思考 + JSON 输出在慢时段会超过 20s，
 *  交接期定值被证伪）；可用 VD_AI_TIMEOUT_MS 覆盖——夜间/高峰时段慢是真实用户会遇到的。 */
const AI_TIMEOUT_MS = Number(process.env['VD_AI_TIMEOUT_MS'] ?? 60_000);
const timeoutFetch: ChatOptions['fetchImpl'] = (url, init) =>
  fetch(url, { ...(init as RequestInit), signal: AbortSignal.timeout(AI_TIMEOUT_MS) });

/** 文本嵌入调用配置：嵌入模型可由设置页指定，缺省取目录里该线的第一个嵌入模型 */
export interface ResolvedEmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  wire: 'openai' | 'minimax';
  storeBody?: Record<string, unknown>;
  queryBody?: Record<string, unknown>;
}

export function resolveEmbeddingConfig(
  settings: AiSettingsView,
  apiKey: string | null,
): ResolvedEmbeddingConfig | null {
  if (!apiKey || !settings.providerId) return null;
  const provider = findProvider(settings.providerId);
  const baseUrl = settings.baseUrl?.trim() || provider?.baseUrl || '';
  const model = settings.embeddingModel?.trim() || provider?.embeddingsModels?.[0] || '';
  if (!baseUrl || !model) return null;
  return {
    apiKey,
    baseUrl,
    model,
    wire: provider?.embeddingsWire ?? 'openai',
    ...(provider?.embeddingStoreBody ? { storeBody: { ...provider.embeddingStoreBody } } : {}),
    ...(provider?.embeddingQueryBody ? { queryBody: { ...provider.embeddingQueryBody } } : {}),
  };
}

/** 批量嵌入：OpenAI 兼容 /embeddings，input 数组一次请求；厂商特有附加体按用途合并 */
export async function embedTexts(
  config: ResolvedEmbeddingConfig,
  texts: readonly string[],
  purpose: 'store' | 'query',
): Promise<number[][]> {
  const extraBody = purpose === 'store' ? config.storeBody : config.queryBody;
  const { embedOnce } = await import('@vaultdeck/llm');
  const result = await embedOnce({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    input: texts,
    wire: config.wire,
    ...(extraBody ? { extraBody } : {}),
    fetchImpl: (url, init) =>
      fetch(url, { ...(init as RequestInit), signal: AbortSignal.timeout(AI_TIMEOUT_MS) }),
  });
  return result.embeddings.map((vector) => [...vector]);
}

/** 把配置包成「提示词 → 回话正文」的对话函数（parse-natural-search 的 ChatFn 形态） */
export function chatWith(config: ResolvedAiConfig): (prompt: string) => Promise<string> {
  // exactOptionalPropertyTypes 下 effort?: string 不允许显式赋 undefined，条件展开
  const options: ChatOptions = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    fetchImpl: timeoutFetch,
    ...(config.effort !== undefined ? { effort: config.effort } : {}),
  };

  return async (prompt: string) => {
    const result = await chatOnce({ ...options, prompt });
    return result.reply;
  };
}

/** 契约 AiProviderEntry 形态：目录的可选字段补齐为显式 null / 空数组 */
export interface AiProviderCatalogEntry {
  id: string;
  displayName: string;
  baseUrl: string;
  modelsSupported: boolean;
  family: string;
  effortLevels: string[] | null;
  effortSupported: boolean;
  customEndpoint: boolean;
  note: string;
  fallbackModels: string[];
}

function toCatalogEntry(entry: LlmProviderEntry): AiProviderCatalogEntry {
  return {
    id: entry.id,
    displayName: entry.displayName,
    baseUrl: entry.baseUrl,
    modelsSupported: entry.modelsSupported,
    family: entry.family,
    effortLevels: entry.effortLevels ? [...entry.effortLevels] : null,
    effortSupported: entry.effortSupported ?? false,
    customEndpoint: entry.customEndpoint ?? false,
    note: entry.note ?? '',
    fallbackModels: entry.fallbackModels ? [...entry.fallbackModels] : [],
  };
}

/** 厂商目录透传（前端下拉框数据源），永不携带任何密钥 */
export function aiProvidersCatalog(): AiProviderCatalogEntry[] {
  return LLM_PROVIDERS.map(toCatalogEntry);
}

export interface AiModelsOutcome {
  models: string[];
  source: 'api' | 'stale' | 'fallback';
  warning: string | null;
}

/**
 * 拉模型清单；失败不抛错，走三级降级（api → 上次成功 → 离线兜底）。
 * 错误消息先过 redactSecrets 再进 warning，密钥不出引擎。
 */
export async function pullModelIds(
  config: ResolvedAiConfig,
  providerId: string,
): Promise<AiModelsOutcome> {
  const options: ChatOptions = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    fetchImpl: timeoutFetch,
    ...(config.effort !== undefined ? { effort: config.effort } : {}),
  };

  try {
    const models = await listModelIds(options);
    return { models: [...models], source: 'api', warning: null };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const warning = redactSecrets(`实时清单拉取失败：${rawMessage}`, [config.apiKey]);
    const provider = findProvider(providerId);
    const outcome = pickModelsAfterFailure({
      lastSuccessful: null,
      fallback: provider?.fallbackModels ?? [],
      warning,
    });
    return { models: [...outcome.models], source: outcome.source, warning: outcome.warning };
  }
}
