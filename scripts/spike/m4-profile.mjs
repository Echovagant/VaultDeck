import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:3000/api/v1';
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function login(username, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, body: await response.json() };
}

const seed = await login('leader', 'leader123');
const currentPassword = seed.status === 200 ? 'leader123' : 'LeaderPass12345';
const session = seed.status === 200 ? seed : await login('leader', currentPassword);
assert.equal(session.status, 200, JSON.stringify(session.body));

const auth = { authorization: `Bearer ${session.body.token}` };
const other = await login('leader', currentPassword);
assert.equal(other.status, 200, JSON.stringify(other.body));
const otherAuth = { authorization: `Bearer ${other.body.token}` };

const profileResponse = await fetch(`${BASE}/auth/me`, { headers: auth });
const profile = await profileResponse.json();
assert.equal(profileResponse.status, 200);
const originalName = profile.displayName;

const updateResponse = await fetch(`${BASE}/auth/me`, {
  method: 'PATCH',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ displayName: '领队-测试' }),
});
const updated = await updateResponse.json();
assert.equal(updateResponse.status, 200, JSON.stringify(updated));
assert.equal(updated.displayName, '领队-测试');

const avatarBuffer = Buffer.from(PNG_1X1, 'base64');
const avatarUpload = await fetch(`${BASE}/auth/avatar`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/octet-stream' },
  body: avatarBuffer,
});
const avatarResult = await avatarUpload.json();
assert.equal(avatarUpload.status, 201, JSON.stringify(avatarResult));
assert.match(avatarResult.avatarUrl, /^\/api\/v1\/auth\/avatar\//);

const avatarDownload = await fetch(`${BASE}${avatarResult.avatarUrl.replace('/api/v1', '')}`, {
  headers: auth,
});
assert.equal(avatarDownload.status, 200);
assert.ok((avatarDownload.headers.get('content-type') ?? '').includes('image/png'));
const avatarBytes = Buffer.from(await avatarDownload.arrayBuffer());
assert.equal(avatarBytes.length, avatarBuffer.length);
assert.equal(avatarBytes.toString('base64'), avatarBuffer.toString('base64'));

const badPassword = await fetch(`${BASE}/auth/password`, {
  method: 'PUT',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'LeaderPass12345' }),
});
assert.equal(badPassword.status, 400);

const changePassword = await fetch(`${BASE}/auth/password`, {
  method: 'PUT',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ currentPassword, newPassword: 'LeaderPass12345' }),
});
assert.equal(changePassword.status, 204);

const revoked = await fetch(`${BASE}/auth/me`, { headers: otherAuth });
assert.equal(revoked.status, 401, '改密后其他会话应失效');
const kept = await fetch(`${BASE}/auth/me`, { headers: auth });
assert.equal(kept.status, 200, '改密后当前会话应保留');

const newLogin = await login('leader', 'LeaderPass12345');
assert.equal(newLogin.status, 200, JSON.stringify(newLogin.body));
const restoredAuth = { authorization: `Bearer ${newLogin.body.token}` };

const restorePassword = await fetch(`${BASE}/auth/password`, {
  method: 'PUT',
  headers: { ...restoredAuth, 'content-type': 'application/json' },
  body: JSON.stringify({ currentPassword: 'LeaderPass12345', newPassword: 'leader123' }),
});
assert.equal(restorePassword.status, 204);

const restoreName = await fetch(`${BASE}/auth/me`, {
  method: 'PATCH',
  headers: { ...restoredAuth, 'content-type': 'application/json' },
  body: JSON.stringify({ displayName: originalName }),
});
assert.equal(restoreName.status, 200);

const finalLogin = await login('leader', 'leader123');
assert.equal(finalLogin.status, 200, JSON.stringify(finalLogin.body));
const finalProfile = await (
  await fetch(`${BASE}/auth/me`, {
    headers: { authorization: `Bearer ${finalLogin.body.token}` },
  })
).json();
assert.equal(finalProfile.displayName, originalName);

console.log(
  JSON.stringify(
    {
      profileUpdated: updated.displayName,
      avatarBytes: avatarBytes.length,
      avatarType: avatarDownload.headers.get('content-type'),
      badPasswordStatus: badPassword.status,
      changePasswordStatus: changePassword.status,
      otherSessionRevoked: revoked.status,
      currentSessionKept: kept.status,
      reloginStatus: newLogin.status,
      restoredDisplayName: finalProfile.displayName,
    },
    null,
    2,
  ),
);
