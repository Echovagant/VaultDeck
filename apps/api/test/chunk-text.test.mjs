import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chunkText, cosineSimilarity } from '../src/application/use-cases/chunk-text.ts';

describe('chunkText', () => {
  it('短文本整体成一块', () => {
    const chunks = chunkText('第一段内容。\n\n第二段内容。');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].index, 0);
    assert.ok(chunks[0].text.includes('第一段'));
    assert.ok(chunks[0].text.includes('第二段'));
  });

  it('多段落按上限装箱', () => {
    const para = '这是一段用于测试的中文内容，长度约两百个字符。'.repeat(5);
    const content = Array.from({ length: 10 }, (_, i) => `第${i}节：${para}`).join('\n\n');
    const chunks = chunkText(content, 800, 100);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.text.length <= 800 + 60, `块长 ${chunk.text.length} 超限`);
      assert.ok(chunk.text.trim().length > 0);
    }
  });

  it('空白输入返回空数组', () => {
    assert.deepEqual(chunkText('   \n\n  '), []);
    assert.deepEqual(chunkText(''), []);
  });

  it('非法参数（重叠≥块长）返回空数组', () => {
    assert.deepEqual(chunkText('内容', 100, 100), []);
    assert.deepEqual(chunkText('内容', 0), []);
  });

  it('超长单段被硬切且头尾覆盖（overlap 允许跨块重复）', () => {
    const long = '字'.repeat(2000);
    const chunks = chunkText(long, 800, 100);
    const joined = chunks.map((c) => c.text).join('');
    assert.equal(chunks.length, 3);
    assert.ok(joined.startsWith('字字字'));
    assert.ok(joined.endsWith('字字字'));
    assert.ok(chunks[0].text.length === 800);
    assert.ok(chunks[2].text.length >= 400 && chunks[2].text.length <= 800, `尾块 ${chunks[2].text.length} = 剩余 400 + 重叠`);
    assert.ok(chunks[2].text.endsWith('字字字'));
  });
});

describe('cosineSimilarity', () => {
  it('同向为 1，正交为 0，零向量为 0', () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-12);
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  });

  it('维度不一致返回 0', () => {
    assert.equal(cosineSimilarity([1], [1, 2]), 0);
  });
});
