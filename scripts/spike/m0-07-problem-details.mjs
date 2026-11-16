import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  StrictBodyPipe,
} = require('../../apps/api/dist/interfaces/http/validation/strict-body.pipe.js');
const {
  DomainError,
  accessDenied,
  toProblem,
  resolveStatus,
} = require('../../apps/api/dist/interfaces/http/errors/problem-details.js');
const {
  ProblemDetailsFilter,
} = require('../../apps/api/dist/interfaces/http/errors/problem-details.filter.js');

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileName'],
  properties: {
    fileName: { type: 'string', minLength: 1 },
  },
};

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

check('未声明字段被拒绝', () => {
  const pipe = new StrictBodyPipe(schema);
  let caught = null;
  try {
    pipe.transform({ fileName: 'a.txt', extraField: 1 });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof DomainError, '应抛出 DomainError');
  assert.equal(caught.code, 'VD-VAL-001');
  assert.equal(resolveStatus(caught), 400);
  assert.ok(caught.options.errors.some((item) => item.message.includes('additional')));
});

check('合法请求体通过', () => {
  const pipe = new StrictBodyPipe(schema);
  assert.deepEqual(pipe.transform({ fileName: 'a.txt' }), { fileName: 'a.txt' });
});

check('缺失必填字段被拒绝', () => {
  const pipe = new StrictBodyPipe(schema);
  assert.throws(
    () => pipe.transform({}),
    (error) => error.code === 'VD-VAL-001',
  );
});

check('越权统一 404 且不泄露对象信息', () => {
  const problem = toProblem(accessDenied(), 'req-1');
  assert.equal(problem.status, 404);
  assert.equal(problem.code, 'VD-AUTH-404');
  assert.equal(problem.detail, '无权访问');
  const text = JSON.stringify(problem);
  for (const leak of ['name', 'size', 'exists', 'fileName']) {
    assert.ok(!text.includes(leak), `不应包含 ${leak}`);
  }
});

check('域映射到 HTTP 状态', () => {
  const cases = [
    ['VAL', 400],
    ['AUTH', 404],
    ['UPL', 409],
    ['DWN', 416],
    ['STO', 503],
    ['TRS', 410],
    ['STA', 422],
    ['IMP', 400],
    ['SYS', 500],
  ];
  for (const [domain, status] of cases) {
    const error = new DomainError(domain, `VD-${domain}-001`, 'probe');
    assert.equal(resolveStatus(error), status);
  }
});

check('过滤器输出 Problem Details 并带 requestId', () => {
  let sent = null;
  const reply = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    header() {
      return this;
    },
    send(body) {
      sent = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId: 'req-fixed' }),
      getResponse: () => reply,
    }),
  };

  new ProblemDetailsFilter().catch(accessDenied(), host);
  assert.equal(reply.statusCode, 404);
  assert.equal(sent.code, 'VD-AUTH-404');
  assert.equal(sent.requestId, 'req-fixed');
  assert.equal(sent.status, 404);
});

console.log(`\n${passed} checks passed`);
