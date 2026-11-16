import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { DomainError, toProblem, type ProblemDetails } from './problem-details';

interface RequestWithId extends FastifyRequest {
  requestId?: string;
}

function titleForStatus(status: number): string {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    410: 'Gone',
    416: 'Range Not Satisfiable',
    422: 'Unprocessable Content',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    503: 'Service Unavailable',
  };
  return titles[status] ?? 'Error';
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const reply = context.getResponse<FastifyReply>();
    const requestId = request.requestId ?? randomUUID();

    const problem = this.normalize(exception, requestId);

    if (problem.status >= 500) {
      this.logger.error(`[${requestId}] ${problem.code} ${problem.detail ?? problem.title}`);
    }

    reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .header('x-request-id', requestId)
      .send(problem);
  }

  private normalize(exception: unknown, requestId: string): ProblemDetails {
    if (exception instanceof DomainError) {
      return toProblem(exception, requestId);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : typeof response === 'object' && response !== null && 'message' in response
            ? String((response as { message: unknown }).message)
            : exception.message;

      return {
        type: 'about:blank',
        title: titleForStatus(status),
        status,
        detail,
        code: status === 404 ? 'VD-AUTH-404' : `VD-SYS-${String(status).padStart(3, '0')}`,
        requestId,
      };
    }

    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: '服务器内部错误',
      code: 'VD-SYS-500',
      requestId,
    };
  }
}
