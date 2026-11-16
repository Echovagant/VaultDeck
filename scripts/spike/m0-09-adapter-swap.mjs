import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ProvisionProjectUseCase,
} = require('../../apps/api/dist/application/use-cases/provision-project.js');
const {
  FixedPrincipalAuthFake,
} = require('../../apps/api/dist/infrastructure/fakes/fixed-principal-auth.fake.js');
const {
  InMemoryProjectStoreFake,
} = require('../../apps/api/dist/infrastructure/fakes/in-memory-project-store.fake.js');
const {
  CollectingNotifyFake,
} = require('../../apps/api/dist/infrastructure/fakes/collecting-notify.fake.js');
const {
  InMemoryStorageFake,
} = require('../../apps/api/dist/infrastructure/fakes/in-memory-storage.fake.js');
const {
  UnsupportedPreviewFake,
} = require('../../apps/api/dist/infrastructure/fakes/unsupported-preview.fake.js');
const { ScanSearchFake } = require('../../apps/api/dist/infrastructure/fakes/scan-search.fake.js');
const { ChecksumMismatch } = require('../../apps/api/dist/domain/errors.js');

const input = {
  credentials: { username: 'probe', password: 'secret' },
  projectCode: 'P-001',
  projectName: '探方资料',
  rootFolderName: '原始资料',
};

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const notify = new CollectingNotifyFake();
const baseCase = new ProvisionProjectUseCase(
  new FixedPrincipalAuthFake(),
  new InMemoryProjectStoreFake(),
  notify,
);
const baseResult = await baseCase.execute(input);

check('fake 驱动：登录→建项目→建文件夹', () => {
  assert.equal(baseResult.project.projectName, '探方资料');
  assert.equal(baseResult.folder.folderName, '原始资料');
  assert.equal(baseResult.folder.projectId, baseResult.project.projectId);
  assert.equal(notify.published.length, 1);
});

class AuditingNotify {
  constructor() {
    this.rows = [];
  }
  async publish(notification) {
    this.rows.push({ ...notification, audited: true });
  }
  async recent() {
    return this.rows;
  }
}

class PrefixedProjectStore {
  constructor() {
    this.inner = new InMemoryProjectStoreFake();
  }
  async createProject(inputValue) {
    return this.inner.createProject({ ...inputValue, projectCode: `X-${inputValue.projectCode}` });
  }
  async createFolder(inputValue) {
    return this.inner.createFolder(inputValue);
  }
  async listFolders(projectId) {
    return this.inner.listFolders(projectId);
  }
}

const notify2 = new AuditingNotify();
const swappedCase = new ProvisionProjectUseCase(
  new FixedPrincipalAuthFake(),
  new PrefixedProjectStore(),
  notify2,
);
const swappedResult = await swappedCase.execute(input);

check('替换实现：用例代码不变、结果结构一致', () => {
  assert.equal(swappedResult.project.projectCode, 'X-P-001');
  assert.equal(swappedResult.folder.folderName, '原始资料');
  assert.equal(notify2.rows[0].audited, true);
  assert.deepEqual(Object.keys(swappedResult).sort(), Object.keys(baseResult).sort());
});

check('存储 fake 校验值不一致时抛领域异常', async () => {
  const storage = new InMemoryStorageFake();
  await assert.rejects(
    () =>
      storage.putObject({
        content: (async function* stream() {
          yield Buffer.from('abc');
        })(),
        sha256: '0'.repeat(64),
        sizeBytes: 3,
      }),
    (error) => error instanceof ChecksumMismatch,
  );
});

check('存储 fake 支持写入后按范围读取', async () => {
  const storage = new InMemoryStorageFake();
  const content = Buffer.from('0123456789');
  const stored = await storage.putObject({
    content: (async function* stream() {
      yield content;
    })(),
    sha256: createHash('sha256').update(content).digest('hex'),
    sizeBytes: content.length,
  });
  assert.equal(stored.sizeBytes, 10);
  const chunks = [];
  for await (const chunk of await storage.openRead(stored.objectId, { start: 2, end: 4 })) {
    chunks.push(Buffer.from(chunk));
  }
  assert.equal(Buffer.concat(chunks).toString(), '234');
});

check('预览 fake 明确报告不支持并触发降级', async () => {
  const preview = new UnsupportedPreviewFake();
  assert.equal(preview.capabilities().supported, false);
  const result = await preview.convert({ fileId: 'f1', fileName: 'a.docx', objectId: 'o1' });
  assert.equal(result.kind, 'unsupported');
});

check('搜索 fake 按项目过滤', async () => {
  const search = new ScanSearchFake();
  await search.index({
    fileId: 'f1',
    fileName: '报告.docx',
    projectId: baseResult.project.projectId,
  });
  await search.index({ fileId: 'f2', fileName: '报告.pdf', projectId: 'other-project' });
  const hits = await search.search({
    keyword: '报告',
    projectIds: [baseResult.project.projectId],
    limit: 10,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].fileId, 'f1');
});

console.log(`\n${passed} scenarios passed`);
