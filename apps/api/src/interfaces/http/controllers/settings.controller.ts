import { Body, Controller, Get, Headers, Patch } from '@nestjs/common';

import type { SettingsPatch } from '../../../application/ports/store.port';
import { store } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

interface SettingsBody {
  maxUploadBytes?: number;
  chunkSizeBytes?: number;
  trashRetentionDays?: number;
  instantUploadEnabled?: boolean;
}

const settingsSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    maxUploadBytes: { type: 'integer', minimum: 1 },
    chunkSizeBytes: { type: 'integer', minimum: 1048576 },
    trashRetentionDays: { type: 'integer', minimum: 1, maximum: 365 },
    instantUploadEnabled: { type: 'boolean' },
  },
};

@Controller('system')
export class SystemSettingsController {
  @Get('settings')
  async get(@Headers('authorization') authorization?: string) {
    await requireUser(authorization);
    return store.getSettings();
  }

  @Patch('settings')
  async update(
    @Body(new StrictBodyPipe<SettingsBody>(settingsSchema)) body: SettingsBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    const patch: SettingsPatch = {};
    if (body.maxUploadBytes !== undefined) patch.maxUploadBytes = body.maxUploadBytes;
    if (body.chunkSizeBytes !== undefined) patch.chunkSizeBytes = body.chunkSizeBytes;
    if (body.trashRetentionDays !== undefined) patch.trashRetentionDays = body.trashRetentionDays;
    if (body.instantUploadEnabled !== undefined) {
      patch.instantUploadEnabled = body.instantUploadEnabled;
    }

    const updated = await store.updateSettings(patch);
    await store.recordAudit({
      actor: user,
      action: 'settings.update',
      objectType: 'setting',
      objectId: 'system',
      result: 'success',
      detail: JSON.stringify(patch),
    });
    return updated;
  }
}
