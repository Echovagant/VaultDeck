import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { DomainError, toProblem } from './errors/problem-details';
import { ensureRequestId, type RequestWithId } from './request-context';

/**
 * 应用层限流（B11）：内存固定窗口，按「客户端 IP + 规则桶」计数。
 * Nginx 仍是第一道；这里是进程内兜底，覆盖直连 3000 与反代失效的场景。
 */
interface Bucket {
  name: string;
  limit: number;
  windowMs: number;
}

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

const AUTH_BUCKET: Bucket = {
  name: 'auth',
  limit: envLimit('VD_RATE_LIMIT_LOGIN', 10),
  windowMs: 60_000,
};
const UPLOAD_BUCKET: Bucket = {
  name: 'upload',
  limit: envLimit('VD_RATE_LIMIT_UPLOAD', 6000),
  windowMs: 60_000,
};
const DEFAULT_BUCKET: Bucket = {
  name: 'default',
  limit: envLimit('VD_RATE_LIMIT_DEFAULT', 600),
  windowMs: 60_000,
};

const hits = new Map<string, { count: number; resetAt: number }>();

function bucketFor(url: string): Bucket | null {
  if (url.startsWith('/api/v1/system/health')) return null;
  if (url.startsWith('/api/v1/auth/login')) return AUTH_BUCKET;
  if (url.startsWith('/api/v1/auth/mfa')) return AUTH_BUCKET;
  if (url.includes('/upload-sessions/')) return UPLOAD_BUCKET;
  return DEFAULT_BUCKET;
}

function prune(now: number): void {
  if (hits.size < 5000) return;
  for (const [key, value] of hits) {
    if (value.resetAt <= now) hits.delete(key);
  }
}

export function installRateLimit(fastify: FastifyInstance): void {
  fastify.addHook(
    'onRequest',
    (request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void) => {
      const bucket = bucketFor(request.url);
      if (!bucket) {
        done();
        return;
      }

      const now = Date.now();
      prune(now);
      const key = `${bucket.name}:${request.ip}`;
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + bucket.windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;

      if (entry.count > bucket.limit) {
        const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        const problem = toProblem(
          new DomainError('SYS', 'VD-RATE-429', '请求过于频繁，请稍后重试', {
            status: 429,
            title: 'Too Many Requests',
          }),
          ensureRequestId(request as RequestWithId),
        );
        void reply
          .status(429)
          .header('content-type', 'application/problem+json')
          .header('retry-after', String(retryAfter))
          .send(problem);
        return;
      }
      done();
    },
  );
}

/** 仅供测试：清空计数 */
export function resetRateLimit(): void {
  hits.clear();
}

export const RATE_LIMITS = { AUTH_BUCKET, UPLOAD_BUCKET, DEFAULT_BUCKET };
