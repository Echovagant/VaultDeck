import { Body, Controller, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';

import { findProvider } from '@vaultdeck/llm';

import type { AiSettingsPatchInput } from '../../../application/ports/store.port';
import { parseNaturalSearch } from '../../../application/use-cases/parse-natural-search';
import { encryptionEnabled } from '../../../infrastructure/crypto/at-rest';
import { logger } from '../../../infrastructure/logging/logger';
import { aiProvidersCatalog, chatWith, pullModelIds, resolveAiConfig } from '../../../infrastructure/llm/ai-engine';
import { store, storeKind } from '../../../infrastructure/store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

interface AiSettingsBody {
  providerId?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  effort?: string | null;
  apiKey?: string;
  clearApiKey?: boolean;
}

const aiSettingsSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    providerId: { type: ['string', 'null'], maxLength: 40 },
    baseUrl: { type: ['string', 'null'], maxLength: 300 },
    model: { type: ['string', 'null'], maxLength: 120 },
    effort: { type: ['string', 'null'], maxLength: 20 },
    apiKey: { type: 'string', maxLength: 300 },
    clearApiKey: { type: 'boolean' },
  },
};

interface ParseSearchBody {
  query: string;
}

const parseSearchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 300 },
  },
};

@Controller('ai')
export class AiController {
  @Get('settings')
  async get(@Headers('authorization') authorization?: string) {
    await requireUser(authorization);
    return {
      settings: await store.getAiSettings(),
      providers: aiProvidersCatalog(),
      encryptionEnabled: encryptionEnabled(),
    };
  }

  @Patch('settings')
  async update(
    @Body(new StrictBodyPipe<AiSettingsBody>(aiSettingsSchema)) body: AiSettingsBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    const current = await store.getAiSettings();

    // 业务校验：providerId 必须在目录内；custom 必须带接入点；effort 必须是目录里认的档位
    const targetProviderId =
      body.providerId !== undefined ? body.providerId : (current.providerId ?? null);
    const provider = targetProviderId ? findProvider(targetProviderId) : null;
    if (targetProviderId !== null && !provider) {
      throw new DomainError('VAL', 'VD-VAL-012', '供应商不在目录内', { status: 400 });
    }
    if (provider?.customEndpoint) {
      const baseUrl = body.baseUrl !== undefined ? body.baseUrl : current.baseUrl;
      if (!baseUrl || !baseUrl.trim()) {
        throw new DomainError('VAL', 'VD-VAL-012', '自定义端点必须填写接入点地址', { status: 400 });
      }
    }
    if (body.effort !== undefined && body.effort !== null) {
      if (!provider?.effortLevels || !provider.effortLevels.includes(body.effort)) {
        throw new DomainError('VAL', 'VD-VAL-012', '思考档位不在该供应商支持的范围内', {
          status: 400,
        });
      }
    }

    const patch: AiSettingsPatchInput = {};
    if (body.providerId !== undefined) patch.providerId = body.providerId;
    if (body.baseUrl !== undefined) patch.baseUrl = body.baseUrl;
    if (body.model !== undefined) patch.model = body.model;
    if (body.effort !== undefined) patch.effort = body.effort;

    // 密钥：clearApiKey 优先；写入前必须确认有加密能力
    let keyChanged = false;
    if (body.clearApiKey === true) {
      patch.apiKey = null;
      keyChanged = true;
    } else if (body.apiKey !== undefined) {
      const trimmed = body.apiKey.trim();
      if (trimmed.length < 8) {
        throw new DomainError('VAL', 'VD-VAL-012', 'API Key 至少 8 个字符', { status: 400 });
      }
      if (storeKind === 'postgres' && !encryptionEnabled()) {
        throw new DomainError(
          'VAL',
          'VD-VAL-012',
          '未配置加密密钥（VD_ENCRYPTION_KEY），无法保存 API Key',
          { status: 400 },
        );
      }
      patch.apiKey = trimmed;
      keyChanged = true;
    }

    const updated = await store.updateAiSettings(patch);
    await store.recordAudit({
      actor: user,
      action: 'ai.settings.update',
      objectType: 'setting',
      objectId: 'ai',
      result: 'success',
      // 审计红线：绝不记录 API Key 本身
      detail: JSON.stringify({ providerId: updated.providerId, model: updated.model, keyChanged }),
    });
    return updated;
  }

  @Post('models')
  @HttpCode(200)
  async models(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    const settings = await store.getAiSettings();
    const config = resolveAiConfig(settings, await store.aiApiKey());
    if (!config || !settings.providerId) {
      throw new DomainError('VAL', 'VD-AI-409', '请先选择供应商并保存 API Key', { status: 409 });
    }
    return pullModelIds(config, settings.providerId);
  }

  @Post('parse-search')
  @HttpCode(200)
  async parseSearch(
    @Body(new StrictBodyPipe<ParseSearchBody>(parseSearchSchema)) body: ParseSearchBody,
    @Headers('authorization') authorization?: string,
  ) {
    await requireUser(authorization);

    const settings = await store.getAiSettings();
    const config = resolveAiConfig(settings, await store.aiApiKey());
    if (!config) {
      // 未配置不是错误：降级为提示，前端退回普通搜索
      return { filters: null, notice: 'AI 服务未配置，请先用关键词搜索' };
    }

    return parseNaturalSearch(body.query, chatWith(config), undefined, (error) => {
      // 模型错误消息出 llm 包前已过 redactSecrets，这里只落日志不回传
      logger.warn('ai.parse_chat_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
