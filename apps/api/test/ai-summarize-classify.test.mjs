import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSummarizePrompt,
  isSummarizable,
  summarizeFile,
} from '../src/application/use-cases/summarize-file.ts';
import {
  buildClassifyPrompt,
  classifyFiles,
  normalizeSuggestions,
  toClassifyInputs,
} from '../src/application/use-cases/classify-files.ts';

describe('isSummarizable', () => {
  it('文本扩展名与 text/* 可总结，二进制拒绝', () => {
    assert.equal(isSummarizable('纪要.txt', 'text/plain'), true);
    assert.equal(isSummarizable('报告.md', undefined), true);
    assert.equal(isSummarizable('数据.csv', 'application/octet-stream'), true);
    assert.equal(isSummarizable('照片.jpg', 'image/jpeg'), false);
    assert.equal(isSummarizable('大文件.bin', 'application/octet-stream'), false);
  });
});

describe('summarizeFile', () => {
  it('提示词带文件名与内容', () => {
    const prompt = buildSummarizePrompt('纪要.txt', '正文内容');
    assert.ok(prompt.includes('纪要.txt'));
    assert.ok(prompt.includes('正文内容'));
    assert.ok(prompt.includes('只输出 JSON'));
  });

  it('正常解析摘要与关键词', async () => {
    const chat = async () =>
      '```json\n{"summary":"这是一份会议纪要。","keywords":["会议","归档","整改"]}\n```';
    const result = await summarizeFile('纪要.txt', '内容', chat);
    assert.equal(result?.summary, '这是一份会议纪要。');
    assert.deepEqual(result?.keywords, ['会议', '归档', '整改']);
  });

  it('模型抛错返回 null 并回调 onError', async () => {
    let captured = null;
    const result = await summarizeFile('a.txt', 'b', async () => {
      throw new Error('boom');
    }, (e) => { captured = e; });
    assert.equal(result, null);
    assert.ok(captured.message.includes('boom'));
  });

  it('垃圾回复返回 null', async () => {
    const result = await summarizeFile('a.txt', 'b', async () => '我看不懂');
    assert.equal(result, null);
  });
});

describe('classifyFiles', () => {
  const items = [
    { fileId: 'f1', fileName: '会议纪要_周一.txt', excerpt: '关于归档策略的讨论' },
    { fileId: 'f2', fileName: '数据导出.csv' },
    { fileId: 'f3', fileName: '值班日志.log' },
  ];

  it('提示词包含文件清单序号与摘录', () => {
    const prompt = buildClassifyPrompt(items);
    assert.ok(prompt.includes('会议纪要_周一.txt'));
    assert.ok(prompt.includes('关于归档策略的讨论'));
    assert.ok(prompt.includes('3. 文件名：值班日志.log'));
  });

  it('正常解析建议并按 index 对回文件', async () => {
    const chat = async () =>
      '[{"index":1,"category":"会议纪要","reason":"文件名与内容均为会议记录"},{"index":3,"category":"操作日志","reason":"log 值班记录"}]';
    const suggestions = await classifyFiles(items, chat);
    assert.equal(suggestions?.length, 2);
    assert.equal(suggestions?.[0]?.fileId, 'f1');
    assert.equal(suggestions?.[1]?.suggestedCategory, '操作日志');
  });

  it('index 越界与重复 fileId 被过滤', async () => {
    const chat = async () =>
      '[{"index":9,"category":"幻影"},{"index":1,"category":"A"},{"index":1,"category":"B"}]';
    const suggestions = await classifyFiles(items, chat);
    assert.equal(suggestions?.length, 1);
    assert.equal(suggestions?.[0]?.suggestedCategory, 'A');
  });

  it('normalizeSuggestions 忽略无类目条目', () => {
    const suggestions = normalizeSuggestions([{ index: 1, reason: '没有类目名' }], items);
    assert.deepEqual(suggestions, []);
  });

  it('toClassifyInputs 截断数量并保留摘录', () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      fileId: `f${i}`,
      fileName: `文件${i}.txt`,
      excerpt: 'x'.repeat(400),
    }));
    const inputs = toClassifyInputs(many);
    assert.equal(inputs.length, 60);
    assert.ok((inputs[0]?.excerpt ?? '').length <= 300);
  });

  it('模型抛错返回 null', async () => {
    const result = await classifyFiles(items, async () => {
      throw new Error('down');
    });
    assert.equal(result, null);
  });
});
