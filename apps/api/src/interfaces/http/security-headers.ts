import type { FastifyInstance } from 'fastify';

/** 通用安全响应头（B11）；页面级 CSP 由 Nginx 下发。 */
export function installSecurityHeaders(fastify: FastifyInstance): void {
  fastify.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header('permissions-policy', 'geolocation=(), microphone=(), camera=()');
    void reply.header('cross-origin-resource-policy', 'same-origin');
    done(null, payload);
  });
}
