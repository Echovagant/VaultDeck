import assert from 'node:assert/strict';

import { testCredentials as creds } from '../lib/test-credentials.mjs';
const BASE = 'http://127.0.0.1:3000/api/v1';

async function login(username, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data.token;
}

const leader = await login('leader', creds.leader);
const member = await login('member', creds.member);
const auth = (token) => ({ authorization: `Bearer ${token}` });

const projects = await (await fetch(`${BASE}/projects`, { headers: auth(leader) })).json();
const project = projects.items.find((item) => item.projectCode === 'DEMO-001');

async function createFolder(folderName, parentId = null) {
  const response = await fetch(`${BASE}/folders`, {
    method: 'POST',
    headers: { ...auth(leader), 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.projectId, folderName, parentId }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

const folderA = await createFolder('验收-A');
assert.equal(folderA.status, 201, JSON.stringify(folderA.body));
const folderB = await createFolder('验收-B');
assert.equal(folderB.status, 201, JSON.stringify(folderB.body));

const renameResponse = await fetch(`${BASE}/folders/${folderA.body.folderId}`, {
  method: 'PATCH',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ folderName: '验收-A2' }),
});
const renamed = await renameResponse.json();
assert.equal(renameResponse.status, 200);
assert.equal(renamed.folderName, '验收-A2');

const moveResponse = await fetch(`${BASE}/folders/${folderB.body.folderId}`, {
  method: 'PATCH',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ parentId: folderA.body.folderId }),
});
const moved = await moveResponse.json();
assert.equal(moveResponse.status, 200);
assert.equal(moved.parentId, folderA.body.folderId);

const deleteParent = await fetch(`${BASE}/folders/${folderA.body.folderId}`, {
  method: 'DELETE',
  headers: auth(leader),
});
assert.equal(deleteParent.status, 409, '非空文件夹不应被删除');

const deleteChild = await fetch(`${BASE}/folders/${folderB.body.folderId}`, {
  method: 'DELETE',
  headers: auth(leader),
});
assert.equal(deleteChild.status, 200);

const deleteParentAgain = await fetch(`${BASE}/folders/${folderA.body.folderId}`, {
  method: 'DELETE',
  headers: auth(leader),
});
assert.equal(deleteParentAgain.status, 200);

const categories = await (await fetch(`${BASE}/categories`, { headers: auth(leader) })).json();
assert.ok(categories.length >= 6, '至少应有 6 个内置分类');

const existingRaster = categories.find((item) => item.categoryCode === 'RASTER');
if (existingRaster) {
  await fetch(`${BASE}/categories/${existingRaster.categoryId}`, {
    method: 'DELETE',
    headers: auth(leader),
  });
}

const createCategory = await fetch(`${BASE}/categories`, {
  method: 'POST',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({
    categoryCode: 'RASTER',
    categoryName: '遥感影像',
    extensions: ['.tif', '.img'],
  }),
});
const createdCategory = await createCategory.json();
assert.equal(createCategory.status, 201, JSON.stringify(createdCategory));

const duplicateCategory = await fetch(`${BASE}/categories`, {
  method: 'POST',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({
    categoryCode: 'RASTER',
    categoryName: '重复',
    extensions: ['.tif'],
  }),
});
assert.equal(duplicateCategory.status, 409);

const updateCategory = await fetch(`${BASE}/categories/${createdCategory.categoryId}`, {
  method: 'PATCH',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ categoryName: '遥感影像（改）' }),
});
const updatedCategory = await updateCategory.json();
assert.equal(updateCategory.status, 200);
assert.equal(updatedCategory.categoryName, '遥感影像（改）');

const systemCategory = categories.find((item) => item.isSystem);
const systemPatch = await fetch(`${BASE}/categories/${systemCategory.categoryId}`, {
  method: 'PATCH',
  headers: { ...auth(leader), 'content-type': 'application/json' },
  body: JSON.stringify({ categoryName: '内置改名' }),
});
assert.equal(systemPatch.status, 409, '内置分类不可修改');

const memberCreate = await fetch(`${BASE}/categories`, {
  method: 'POST',
  headers: { ...auth(member), 'content-type': 'application/json' },
  body: JSON.stringify({ categoryCode: 'X', categoryName: '越权', extensions: ['.x'] }),
});
assert.equal(memberCreate.status, 404, 'Member 不应能创建分类');

const deleteCategory = await fetch(`${BASE}/categories/${createdCategory.categoryId}`, {
  method: 'DELETE',
  headers: auth(leader),
});
assert.equal(deleteCategory.status, 204);

console.log(
  JSON.stringify(
    {
      renameOk: true,
      moveOk: true,
      nonEmptyDeleteStatus: deleteParent.status,
      categoryCreated: createdCategory.categoryCode,
      duplicateStatus: duplicateCategory.status,
      systemReadonlyStatus: systemPatch.status,
      memberCreateStatus: memberCreate.status,
    },
    null,
    2,
  ),
);
