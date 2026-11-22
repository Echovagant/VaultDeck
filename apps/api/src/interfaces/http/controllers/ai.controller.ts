import { Body, Controller, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';
import { readFile } from 'node:fs/promises';

import { findProvider } from '@vaultdeck/llm';

import type { AiSettingsPatchInput } from '../../../application/ports/store.port';
import { classifyFiles, toClassifyInputs } from '../../../application/use-cases/classify-files';
import { parseNaturalSearch } from '../../../application/use-cases/parse-natural-search';
import {
  MAX_EXTRACT_SOURCE_BYTES,
  summarizableKind,
  summarizeFile,
} from '../../../application/use-cases/summarize-file';
import { encryptionEnabled } from '../../../infrastructure/crypto/at-rest';
import { extractDocxText, extractXlsxText } from '../../../infrastructure/extract/office-extract';
import { logger } from '../../../infrastructure/logging/logger';
import { aiProvidersCatalog, chatWith, pullModelIds, resolveAiConfig } from '../../../infrastructure/llm/ai-engine';
import { objectStorage } from '../../../infrastructure/memory/upload-sessions';
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

interface FileIdBody {
  fileId: string;
}

const fileIdSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileId'],
  properties: {
    fileId: { type: 'string', format: 'uuid' },
  },
};

interface ProjectIdBody {
  projectId: string;
}

const projectIdSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['projectId'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
  },
};

const SUMMARY_INPUT_LIMIT = 512 * 1024;
const CLASSIFY_EXCERPT_BYTES = 300;
const CLASSIFY_BATCH_LIMIT = 60;

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

  /** 读一个文件的明文片段（text 类）；对象缺失等异常返回 null */
  private async readTextExcerpt(
    objectPath: string,
    limitBytes: number,
  ): Promise<string | null> {
    try {
      const stream = await objectStorage.openRange(objectPath, 0, limitBytes - 1);
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks).toString('utf8');
    } catch {
      return null;
    }
  }

  /** 按类型提取文本：纯文本直接读，docx/xlsx 走 OOXML 解包，pdf 走 unpdf 文本层 */
  private async extractFileText(
    file: { fileName: string; objectPath: string },
    kind: 'text' | 'docx' | 'xlsx' | 'pdf',
    sourceBytes: number,
  ): Promise<string | null> {
    const materialized = await objectStorage.materializePlaintext(file.objectPath, file.fileName);
    try {
      if (kind === 'text') {
        const limit = Math.min(sourceBytes, SUMMARY_INPUT_LIMIT);
        return await this.readTextExcerpt(file.objectPath, limit);
      }
      if (kind === 'docx') {
        const data = await readFile(materialized.path);
        return extractDocxText(data);
      }
      if (kind === 'xlsx') {
        const data = await readFile(materialized.path);
        return extractXlsxText(data);
      }
      const { extractText, getDocumentProxy } = await import('unpdf');
      const buffer = await readFile(materialized.path);
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join('\n') : text;
      return merged && merged.trim() ? merged : null;
    } catch (error) {
      logger.warn('ai.extract_failed', {
        file: file.fileName,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      await objectStorage.cleanupMaterialized(materialized);
    }
  }

  @Post('summarize')
  @HttpCode(200)
  async summarize(
    @Body(new StrictBodyPipe<FileIdBody>(fileIdSchema)) body: FileIdBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    const file = await store.getFile(body.fileId);
    if (!file || !(await store.canReadFile(user, file))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件不存在', { status: 404 });
    }
    if (!file.objectPath) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '文件内容不存在', { status: 404 });
    }
    const kind = summarizableKind(file.fileName, file.contentType);
    if (!kind) {
      throw new DomainError(
        'SYS',
        'VD-SYS-501',
        '该文件类型暂不支持 AI 总结（当前支持纯文本类与 docx/xlsx/pdf）',
        { status: 415 },
      );
    }

    const settings = await store.getAiSettings();
    const config = resolveAiConfig(settings, await store.aiApiKey());
    if (!config) {
      throw new DomainError('VAL', 'VD-AI-409', '请先在设置页配置 AI 服务', { status: 409 });
    }

    const size = await objectStorage.plaintextSize(file.objectPath).catch(() => 0);
    if (kind !== 'text' && size > MAX_EXTRACT_SOURCE_BYTES) {
      throw new DomainError('SYS', 'VD-SYS-501', '文件过大，超出 AI 总结的提取上限（50MB）', {
        status: 415,
      });
    }

    const content = (await this.extractFileText(file, kind, size)) ?? '';
    if (!content.trim()) {
      throw new DomainError('SYS', 'VD-SYS-502', '文件内容为空或不可读（扫描件与纯图 PDF 无文本层）', {
        status: 502,
      });
    }
    const trimmed = content.slice(0, SUMMARY_INPUT_LIMIT);

    const result = await summarizeFile(file.fileName, trimmed, chatWith(config), (error) => {
      logger.warn('ai.summarize_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    if (!result) {
      throw new DomainError('SYS', 'VD-SYS-502', 'AI 总结暂时不可用，请稍后重试', { status: 502 });
    }

    await store.recordAudit({
      actor: user,
      action: 'ai.summarize',
      objectType: 'file',
      objectId: file.fileId,
      result: 'success',
      detail: file.fileName,
    });
    return result;
  }

  @Post('classify')
  @HttpCode(200)
  async classify(
    @Body(new StrictBodyPipe<ProjectIdBody>(projectIdSchema)) body: ProjectIdBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (!(await store.canAccessProject(user, body.projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }

    const settings = await store.getAiSettings();
    const config = resolveAiConfig(settings, await store.aiApiKey());
    if (!config) {
      // 分类是建议性功能，未配置时降级为空建议而不是报错
      return { suggestions: [], notice: 'AI 服务未配置，请先用关键词与筛选条件' };
    }

    const files = (await store.listFiles(body.projectId)).filter((f) => f.status === 'active');
    if (files.length === 0) {
      return { suggestions: [], notice: null };
    }

    const limited = files.slice(0, CLASSIFY_BATCH_LIMIT);
    const inputs = [];
    for (const file of limited) {
      const excerpt =
        file.objectPath && summarizableKind(file.fileName, file.contentType)
          ? await this.readTextExcerpt(file.objectPath, CLASSIFY_EXCERPT_BYTES)
          : null;
      inputs.push({
        fileId: file.fileId,
        fileName: file.fileName,
        excerpt,
      });
    }

    const suggestions = await classifyFiles(toClassifyInputs(inputs), chatWith(config), (error) => {
      logger.warn('ai.classify_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    if (suggestions === null) {
      return { suggestions: [], notice: 'AI 分类暂时不可用，请稍后重试' };
    }

    await store.recordAudit({
      actor: user,
      action: 'ai.classify',
      objectType: 'project',
      objectId: body.projectId,
      result: 'success',
      detail: JSON.stringify({ scanned: inputs.length, suggested: suggestions.length }),
    });
    return { suggestions, notice: files.length > CLASSIFY_BATCH_LIMIT ? `文件较多，本次仅分析前 ${CLASSIFY_BATCH_LIMIT} 个` : null };
  }
}
