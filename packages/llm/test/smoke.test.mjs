import { test } from 'node:test';
import assert from 'node:assert/strict';

const llm = await import('../dist/index.js');
const kp = llm;
const pr = llm;
const ma = llm;

test('目录表：10 条接入线，id 唯一且字段齐全', () => {
  assert.equal(pr.LLM_PROVIDERS.length, 10);
  const ids = pr.LLM_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of pr.LLM_PROVIDERS) {
    assert.equal(typeof p.displayName, 'string');
    assert.equal(typeof p.baseUrl, 'string');
    assert.equal(typeof p.modelsSupported, 'boolean');
    assert.equal(typeof p.family, 'string');
  }
});

test('findProvider：命中与不命中', () => {
  const glm = pr.findProvider('glm');
  assert.equal(glm.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(pr.findProvider('no-such-id'), null);
  assert.equal(pr.findProvider('custom').customEndpoint, true);
  assert.equal(pr.findProvider('ollama').family, 'local');
});

test('detectProviderByKey：minimax 前缀认出家族、认不出具体线', () => {
  const d1 = pr.detectProviderByKey('sk-cp-abcdef1234567890');
  assert.equal(d1.family, "minimax");
  assert.equal(d1.providerId, null);
  const d2 = pr.detectProviderByKey('sk-api-abcdef1234567890');
  assert.equal(d2.family, "minimax");
});

test('detectProviderByKey：通用 sk- 前缀不硬猜，空白返回 null', () => {
  assert.equal(pr.detectProviderByKey('sk-plain-abcdef123456'), null);
  assert.equal(pr.detectProviderByKey(''), null);
  assert.equal(pr.detectProviderByKey('   '), null);
});

test('parseModelIds：trim、跳过非字符串', () => {
  const ids = ma.parseModelIds(String.raw`{"data":[{"id":" m1 "},{"id":"m2"},5,{}]}`);
  assert.deepEqual(ids, ['m1', 'm2']);
  assert.deepEqual(ma.parseModelIds('not-json'), []);
  assert.deepEqual(ma.parseModelIds(String.raw`{"nope":1}`), []);
});

test('extractErrorMessage：两种错误体 + 兜底', () => {
  assert.equal(ma.extractErrorMessage(String.raw`{"error":{"message":"boom","code":1004}}`), "boom");
  assert.equal(ma.extractErrorMessage(String.raw`{"base_resp":{"status_code":1004,"status_msg":"quota"}}`), "quota");
  assert.equal(ma.extractErrorMessage(String.raw`{"message":"plain"}`), "plain");
  assert.equal(ma.extractErrorMessage("not-json"), null);
  assert.equal(ma.extractErrorMessage(String.raw`{}`), null);
});

test('parseChatReply：字符串与数组 content', () => {
  const r1 = ma.parseChatReply(String.raw`{"model":"m1","choices":[{"message":{"content":" hi "}}]}`);
  assert.deepEqual(r1, { reply: "hi", model: "m1" });
  const r2 = ma.parseChatReply(String.raw`{"choices":[{"message":{"content":["a",{"text":"b"}]}}]}`);
  assert.deepEqual(r2, { reply: "ab", model: "" });
  assert.deepEqual(ma.parseChatReply("not-json"), { reply: "", model: "" });
});

test('redactSecrets：指定密钥、sk- 兜底、JWT 兜底、短串不抹', () => {
  const key = "sk-abcdef1234567890abcd";
  const out = kp.redactSecrets("x " + key + " y eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9 z", [key]);
  assert.ok(!out.includes(key));
  assert.ok(out.includes("***REDACTED***"));
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9"), "JWT 兜底未生效");
  assert.equal(kp.redactSecrets("x k0 y", ["k0"]), "x k0 y"); // 少于 8 字符不抹，避免把正常文本打成马赛克
});

test('pickModelsAfterFailure：上次成功 → stale；没有 → fallback', () => {
  const s = ma.pickModelsAfterFailure({ lastSuccessful: ['m1'], fallback: ['f1'], warning: 'w' });
  assert.equal(s.source, 'stale');
  assert.deepEqual(s.models, ['m1']);
  assert.equal(s.warning, "w");
  const f = ma.pickModelsAfterFailure({ lastSuccessful: null, fallback: ['f1'], warning: 'w' });
  assert.equal(f.source, 'fallback');
  assert.deepEqual(f.models, ['f1']);
});

test('chatOnce：URL 去尾斜杠、effort 只在给了才传、max_tokens=8192', async () => {
  const seen = {};
  const res = { ok: true, status: 200, text: async () => String.raw`{"model":"m1","choices":[{"message":{"content":"hi"}}]}` };
  const fake = async (url, init) => { seen.url = url; seen.init = init; return res; };
  const out = await ma.chatOnce({ apiKey: "k0", baseUrl: "https://x.example/v1/", model: "m1", effort: "high", fetchImpl: fake });
  assert.equal(seen.url, "https://x.example/v1/chat/completions");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.max_tokens, 8192);
  assert.equal(body.reasoning_effort, "high");
  assert.equal(out.reply, "hi");
  assert.equal(typeof out.elapsedMs, "number");

  const seen2 = {};
  const fake2 = async (url, init) => { seen2.init = init; return res; };
  await ma.chatOnce({ apiKey: "k0", baseUrl: "https://x.example/v1", model: "m1", fetchImpl: fake2 });
  const body2 = JSON.parse(seen2.init.body);
  assert.equal(body2.reasoning_effort, undefined);
});

test('chatOnce：服务端 500 带错误体 → LlmApiError(status=500)', async () => {
  const fake = async () => ({ ok: false, status: 500, text: async () => String.raw`{"error":{"message":"boom"}}` });
  await assert.rejects(
    () => ma.chatOnce({ apiKey: "k0", baseUrl: "https://x.example/v1", model: "m1", fetchImpl: fake }),
    (e) => e instanceof ma.LlmApiError && e.status === 500 && e.message.includes("boom"),
  );
});

test('chatOnce：网络层失败 → status=0 且错误消息里密钥被抹掉', async () => {
  const key = "sk-abcdef1234567890abcd";
  const fake = async () => {
    throw new Error("connect ECONNREFUSED Authorization: Bearer " + key + " https://x.example/v1");
  };
  await assert.rejects(
    () => ma.chatOnce({ apiKey: key, baseUrl: "https://x.example/v1", model: "m1", fetchImpl: fake }),
    (e) => e instanceof ma.LlmApiError && e.status === 0 && !e.message.includes(key) && e.message.includes("***REDACTED***"),
  );
});

test('listModelIds：GET 无 body、Bearer 头、200 解析、401 带原因', async () => {
  const seen = {};
  const ok = { ok: true, status: 200, text: async () => String.raw`{"data":[{"id":"a"},{"id":"b"}]}` };
  const fake = async (url, init) => { seen.init = init; return ok; };
  const ids = await ma.listModelIds({ apiKey: "k0", baseUrl: "https://x.example/v1", model: "m1", fetchImpl: fake });
  assert.deepEqual(ids, ["a", "b"]);
  assert.equal(seen.init.method, "GET");
  assert.equal(seen.init.body, undefined);
  assert.ok(seen.init.headers.authorization.includes("k0"));

  const fake401 = async () => ({ ok: false, status: 401, text: async () => String.raw`{"error":{"message":"请带上密钥"}}` });
  await assert.rejects(
    () => ma.listModelIds({ apiKey: "k0", baseUrl: "https://x.example/v1", model: "m1", fetchImpl: fake401 }),
    (e) => e instanceof ma.LlmApiError && e.status === 401 && e.message.includes("请带上密钥"),
  );
});

test('OpenAiCompatibleProvider：端点与模型现取，换接入线立刻生效', async () => {
  let base = "https://a.example/v1";
  let model = "m1";
  const key = "k0";
  const p = new pr.OpenAiCompatibleProvider({ id: "custom", displayName: "X", readApiKey: () => key, baseUrl: () => base, model: () => model });
  const c1 = await p.resolve("owner");
  assert.deepEqual(c1, { model: "m1", apiKey: key, baseUrl: "https://a.example/v1" });
  base = "https://b.example/v1";
  model = "m2";
  const c2 = await p.resolve("owner");
  assert.deepEqual(c2, { model: "m2", apiKey: key, baseUrl: "https://b.example/v1" });
  assert.equal(await p.hasCredentials("owner"), true);
});

test('OpenAiCompatibleProvider：无 key → resolve null、hasCredentials false；带 effort 透传', async () => {
  const p = new pr.OpenAiCompatibleProvider({ id: "custom", displayName: "X", readApiKey: () => null, baseUrl: () => "https://a.example/v1", model: () => "m1", effort: "low" });
  assert.equal(await p.resolve("owner"), null);
  assert.equal(await p.hasCredentials("owner"), false);
  const p2 = new pr.OpenAiCompatibleProvider({ id: "custom", displayName: "Y", readApiKey: () => "k", baseUrl: () => "https://a.example/v1", model: () => "m1", effort: "low" });
  const c = await p2.resolve("owner");
  assert.equal(c.effort, "low");
});

test('MiniMaxProvider：默认端点与模型、清单兜底、无 key → null', async () => {
  const p = new kp.MiniMaxProvider({ readApiKey: () => "k0" });
  assert.equal(p.baseUrl, 'https://api.minimax.cn/v1');
  assert.equal(p.model, 'MiniMax-M3.1-Flash');
  const models = await p.listModels();
  assert.ok(models.includes('MiniMax-M3'));
  assert.deepEqual(kp.MINIMAX_EFFORT_LEVELS, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(ma.DEFAULT_MAX_TOKENS, 8192);
  const none = new kp.MiniMaxProvider({ readApiKey: () => null });
  assert.equal(await none.resolve("o"), null);
});

test('Registry 与三个 KeyProvider 实现：透传、未注册抛错、托管占位拒绝', async () => {
  const reg = new kp.KeyProviderRegistry();
  const sp = new kp.SessionKeyProvider({ id: 'minimax-cn', displayName: 'S', readApiKey: () => 'k0', models: ['m1'] });
  const bp = new kp.ByokKeyProvider({ id: 'custom', displayName: 'B', models: ['m9'], resolve: async () => ({ model: 'm9', apiKey: 'k1' }) });
  reg.register(sp);
  reg.register(bp);
  assert.equal(reg.get('minimax-cn'), sp);
  assert.equal(reg.list().length, 2);
  assert.throws(() => reg.get('nope'), /未注册的模型提供方/);
  assert.deepEqual(await sp.listModels(), ['m1']);
  const bc = await bp.resolve("o");
  assert.deepEqual(bc, { model: "m9", apiKey: "k1" });
  assert.equal(await sp.hasCredentials("o"), true);
  const mg = new kp.ManagedKeyProvider({ id: "custom", displayName: "M", enabled: false });
  assert.equal(await mg.hasCredentials("o"), false);
  await assert.rejects(() => mg.resolve("o"), /团队托管模式未启用/);
});
