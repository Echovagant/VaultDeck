import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import type { PipeTransform } from '@nestjs/common';

import { DomainError, type FieldError } from '../errors/problem-details';

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  removeAdditional: false,
  coerceTypes: false,
});

addFormats(ajv);

export class StrictBodyPipe<T> implements PipeTransform<unknown, T> {
  private readonly validate: ValidateFunction;

  constructor(schema: object) {
    this.validate = ajv.compile(schema);
  }

  transform(value: unknown): T {
    if (this.validate(value)) {
      return value as T;
    }

    const errors: FieldError[] = (this.validate.errors ?? []).map((item) => ({
      field:
        item.instancePath === ''
          ? (item.params['missingProperty'] ?? item.instancePath)
          : item.instancePath,
      message: item.message ?? '不符合契约',
    }));

    throw new DomainError('VAL', 'VD-VAL-001', '请求体不符合契约', { errors });
  }
}

export function createStrictBodyPipe(schema: object): StrictBodyPipe<unknown> {
  return new StrictBodyPipe<unknown>(schema);
}
