import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';

import { AppModule } from './app.module';
import { configureComposition } from './composition/root';
import { ProblemDetailsFilter } from './interfaces/http/errors/problem-details.filter';
import { DomainError, toProblem } from './interfaces/http/errors/problem-details';
import { ensureRequestId, type RequestWithId } from './interfaces/http/request-context';
import { prepareStore, storeKind } from './infrastructure/store';

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
    done();
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

  await prepareStore();

  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '127.0.0.1';
  await app.listen({ port, host });
  process.stdout.write(`[vaultdeck] store=${storeKind} listening ${host}:${port}\n`);
}

void bootstrap();
