export type ErrorDomain = 'VAL' | 'AUTH' | 'UPL' | 'DWN' | 'STO' | 'TRS' | 'STA' | 'IMP' | 'SYS';

export const DOMAIN_DEFAULT_STATUS: Record<ErrorDomain, number> = {
  VAL: 400,
  AUTH: 404,
  UPL: 409,
  DWN: 416,
  STO: 503,
  TRS: 410,
  STA: 422,
  IMP: 400,
  SYS: 500,
};

export interface FieldError {
  field: string;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  requestId: string;
  errors?: FieldError[];
}

const STATUS_TITLES: Record<number, string> = {
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

export interface DomainErrorOptions {
  status?: number;
  title?: string;
  errors?: FieldError[];
}

export class DomainError extends Error {
  readonly domain: ErrorDomain;
  readonly code: string;
  readonly options: DomainErrorOptions;

  constructor(
    domain: ErrorDomain,
    code: string,
    message: string,
    options: DomainErrorOptions = {},
  ) {
    super(message);
    this.name = 'DomainError';
    this.domain = domain;
    this.code = code;
    this.options = options;
  }
}

export function resolveStatus(error: DomainError): number {
  return error.options.status ?? DOMAIN_DEFAULT_STATUS[error.domain];
}

export function toProblem(error: DomainError, requestId: string): ProblemDetails {
  const status = resolveStatus(error);
  const problem: ProblemDetails = {
    type: `urn:vaultdeck:problem:${error.code.toLowerCase()}`,
    title: error.options.title ?? STATUS_TITLES[status] ?? 'Error',
    status,
    detail: error.message,
    code: error.code,
    requestId,
  };
  if (error.options.errors) {
    problem.errors = error.options.errors;
  }
  return problem;
}

export function accessDenied(): DomainError {
  return new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404, title: 'Not Found' });
}

export function validationFailed(message: string, errors?: FieldError[]): DomainError {
  return new DomainError('VAL', 'VD-VAL-001', message, errors ? { errors } : {});
}
