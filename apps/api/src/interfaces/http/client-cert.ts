import type { FastifyInstance } from 'fastify';

import { DomainError, toProblem } from './errors/problem-details';
import { ensureRequestId, type RequestWithId } from './request-context';

/**
 * 可选的双向 TLS 网关：Nginx 校验客户端证书后写入 X-Client-Verify。
 * 仅当 VD_REQUIRE_CLIENT_CERT=true 时启用；健康检查放行，便于本机与监控探活。
 * 注意：API 默认只监听 127.0.0.1，直连端口不应暴露到局域网。
 */
export function installClientCertGate(fastify: FastifyInstance): void {
  if (process.env['VD_REQUIRE_CLIENT_CERT'] !== 'true') return;

  fastify.addHook('onRequest', (request, reply, done) => {
    if (!request.url.startsWith('/api/v1')) {
      done();
      return;
    }
    if (request.url.startsWith('/api/v1/system/health')) {
      done();
      return;
    }

    const verify = String(request.headers['x-client-verify'] ?? '').toUpperCase();
    if (verify === 'SUCCESS') {
      done();
      return;
    }

    const problem = toProblem(
      new DomainError('AUTH', 'VD-AUTH-401', '需要有效的客户端证书', {
        status: 401,
        title: 'Unauthorized',
      }),
      ensureRequestId(request as RequestWithId),
    );
    void reply.status(401).header('content-type', 'application/problem+json').send(problem);
  });
}
