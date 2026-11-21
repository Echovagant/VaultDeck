import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';

import { AppModule } from './app.module';
import { configureComposition } from './composition/root';
import { logger } from './infrastructure/logging/logger';
import { reconcileUploadStaging } from './infrastructure/ops/startup-integrity';
import { ProblemDetailsFilter } from './interfaces/http/errors/problem-details.filter';
import { DomainError, toProblem } from './interfaces/http/errors/problem-details';
import { installRateLimit } from './interfaces/http/rate-limit';
import { installClientCertGate } from './interfaces/http/client-cert';
import { ensureRequestId, type RequestWithId } from './interfaces/http/request-context';
import { installSecurityHeaders } from './interfaces/http/security-headers';
import { startMaintenanceScheduler } from './infrastructure/scheduler/maintenance';
import { prepareStore, store, storeKind } from './infrastructure/store';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ trustProxy: false, bodyLimit: 16 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );
  fastify.addHook('onRequest', (request, reply, done) => {
    const requestId = ensureRequestId(request as RequestWithId);
    void reply.header('x-request-id', requestId);
    // HttpOnly Cookie 会话：没有 Authorization 头时，从 vd_session Cookie 恢复 Bearer
    if (!request.headers.authorization && request.headers.cookie) {
      const match = /(?:^|;\s*)vd_session=([^;]+)/.exec(request.headers.cookie);
      const rawToken = match?.[1] ?? '';
      const token = rawToken ? decodeURIComponent(rawToken) : '';
      if (/^[A-Za-z0-9_-]+$/.test(token)) {
        request.headers.authorization = `Bearer ${token}`;
      }
    }
    done();
  });

  // 只读 Agent 授权的写操作拦截：统一在协议层挡住，控制器不用各自判。
  // /ai/parse-search 虽是 POST 但语义是读（AI 解析），只读授权必须放行。
  const READ_ONLY_ALLOWED_POSTS = ['/api/v1/ai/parse-search'];
  fastify.addHook('preHandler', async (request, reply) => {
    const header = request.headers.authorization;
    const token =
      typeof header === 'string' ? (/^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? null) : null;
    if (!token || !token.startsWith('vdak_')) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (READ_ONLY_ALLOWED_POSTS.some((pathName) => request.url.split('?')[0] === pathName)) return;

    const identity = await store.userByAgentToken(token);
    if (identity?.grant.readOnly) {
      const requestId = ensureRequestId(request as RequestWithId);
      void reply
        .code(403)
        .header('content-type', 'application/problem+json')
        .send(
          toProblem(
            new DomainError('AUTH', 'VD-AUTH-403', '该 Agent 授权为只读，无权执行写操作', {
              status: 403,
            }),
            requestId,
          ),
        );
    }
  });

  fastify.addHook('onSend', (request, reply, payload, done) => {
    if (reply.statusCode !== 404) {
      done(null, payload);
      return;
    }
    const contentType = String(reply.getHeader('content-type') ?? '');
    if (contentType.includes('application/problem+json')) {
      done(null, payload);
      return;
    }
    const requestId = ensureRequestId(request as RequestWithId);
    const problem = toProblem(
      new DomainError('AUTH', 'VD-AUTH-404', '资源不存在', { status: 404, title: 'Not Found' }),
      requestId,
    );
    reply.header('content-type', 'application/problem+json');
    reply.header('x-request-id', requestId);
    done(null, JSON.stringify(problem));
  });

  configureComposition(app);
  installRateLimit(fastify);
  installSecurityHeaders(fastify);
  installClientCertGate(fastify);

  fastify.addHook('onResponse', (request, reply, done) => {
    logger.info('api.request', {
      requestId: ensureRequestId(request as RequestWithId),
      method: request.method,
      path: request.url.split('?')[0],
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ip: request.ip,
    });
    done();
  });

  await prepareStore();
  const stagingRemoved = await reconcileUploadStaging();
  startMaintenanceScheduler(store);

  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '127.0.0.1';
  await app.listen({ port, host });
  logger.info('api.started', { store: storeKind, host, port, stagingRemoved });
}

void bootstrap();
