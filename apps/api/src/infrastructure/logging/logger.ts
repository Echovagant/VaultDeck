/**
 * 结构化 JSON 日志（B8）：单行 JSON、字段脱敏、供 WinSW 按大小滚动。
 * 事件名用点分小写（api.request / maintenance.run / integrity.scan ...）。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEY = /(password|passwd|token|authorization|cookie|secret|database_url|db_url)/i;
const MAX_STRING = 512;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth-limit]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrub(item, depth + 1);
    }
    return result;
  }
  return value;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveMinLevel(): LogLevel {
  const raw = process.env['VD_LOG_LEVEL'];
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

const MIN_LEVEL = resolveMinLevel();

/** 输出单行 JSON 日志；敏感字段与超长字符串会先脱敏。 */
export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(scrub(fields) as Record<string, unknown>),
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields),
};

/** 把未知异常转成可读字符串，供日志与错误响应使用。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
