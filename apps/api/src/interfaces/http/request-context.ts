import { randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

export interface RequestWithId extends FastifyRequest {
  requestId?: string;
}

const MAX_REQUEST_ID_LENGTH = 128;

export function ensureRequestId(request: RequestWithId): string {
  const header = request.headers['x-request-id'];
  const candidate = typeof header === 'string' ? header.trim() : '';

  const requestId =
    candidate.length > 0 && candidate.length <= MAX_REQUEST_ID_LENGTH ? candidate : randomUUID();

  request.requestId = requestId;
  return requestId;
}
