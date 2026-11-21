import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildParsePrompt,
  extractJson,
  normalizeFilters,
  parseNaturalSearch,
} from '../src/application/use-cases/parse-natural-search.ts';

const TODAY = new Date('2026-11-21T08:00:00Z');

describe('buildParsePrompt', () => {
  it('提示词包含今天的日期与用户原话', () => {
    const prompt = buildParsePrompt('上周的视频', '2026-11-21');
    assert.ok(prompt.includes('2026-11-21'));
    assert.ok(prompt.includes('上周的视频'));
    assert.ok(prompt.includes('只输出 JSON'));
  });
});

describe('extractJson', () => {
  it('剥掉 json 围栏', () => {
    assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it('截出夹在说明文字中间的 JSON', () => {
    assert.equal(extractJson('好的，解析结果：{"a":1} 请查收'), '{"a":1}');
  });

  it('垃圾回复返回 null', () => {
    assert.equal(extractJson('我听不懂你在说什么'), null);
    assert.equal(extractJson('{ 不完整'), null);
  });
});

describe('normalizeFilters', () => {
  it('日期说反了自动交换', () => {
    const filters = normalizeFilters({ uploadedFrom: '2026-11-20', uploadedTo: '2026-11-01' });
    assert.equal(filters.uploadedFrom, '2026-11-01');
    assert.equal(filters.uploadedTo, '2026-11-20');
  });

  it('扩展名小写去点、去重、白名单清洗', () => {
    const filters = normalizeFilters({ extensions: ['.PDF', 'pdf', 'Doc', '坏/名', '.mp4'] });
    assert.deepEqual(filters.extensions, ['pdf', 'doc', 'mp4']);
  });

  it('关键词不足 2 字丢弃', () => {
    assert.equal(normalizeFilters({ keyword: 'a' }), null);
    assert.equal(normalizeFilters({ keyword: '  合同 ' }).keyword, '合同');
  });

  it('大小取整且负数归零', () => {
    assert.equal(normalizeFilters({ minSizeBytes: 104857600.7 }).minSizeBytes, 104857601);
    assert.equal(normalizeFilters({ minSizeBytes: -5 }).minSizeBytes, 0);
  });

  it('全空返回 null', () => {
    assert.equal(normalizeFilters({ keyword: null, extensions: [] }), null);
    assert.equal(normalizeFilters('不是对象'), null);
  });
});

describe('parseNaturalSearch', () => {
  it('正常解析出条件', async () => {
    const chat = async () =>
      '```json\n{"keyword":"验收报告","uploadedFrom":"2026-11-14","uploadedTo":"2026-11-21","minSizeBytes":null,"maxSizeBytes":null,"extensions":["docx"]}\n```';
    const result = await parseNaturalSearch('上周的验收报告', chat, TODAY);
    assert.equal(result.notice, null);
    assert.equal(result.filters.keyword, '验收报告');
    assert.deepEqual(result.filters.extensions, ['docx']);
  });

  it('模型抛错降级，不向上抛', async () => {
    const chat = async () => {
      throw new Error('boom');
    };
    const result = await parseNaturalSearch('上周的视频', chat, TODAY);
    assert.equal(result.filters, null);
    assert.equal(result.notice, 'AI 服务暂时不可用，已退回普通搜索');
  });

  it('垃圾回复降级', async () => {
    const chat = async () => '我听不懂';
    const result = await parseNaturalSearch('上周的视频', chat, TODAY);
    assert.equal(result.filters, null);
    assert.equal(result.notice, 'AI 没能解析出搜索条件，请换个说法或直接用关键词搜索');
  });

  it('解析成功但没有可用条件时给提示', async () => {
    const chat = async () => '{"keyword":null,"uploadedFrom":null,"uploadedTo":null}';
    const result = await parseNaturalSearch('随便看看', chat, TODAY);
    assert.equal(result.filters, null);
    assert.equal(result.notice, '这句话里没有提取到可用的搜索条件，试试加上时间、大小或文件类型');
  });
});
