import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { atRestKey } from '../crypto/at-rest';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function challengeSecret(): Buffer {
  const direct = process.env['VD_MFA_CHALLENGE_SECRET'];
  if (direct) return Buffer.from(direct, 'utf8');
  const key = atRestKey();
  if (!key) throw new Error('未配置加密密钥，无法启用 MFA');
  return createHmac('sha256', key).update('vaultdeck.mfa.challenge').digest();
}

/** 密码通过后签发的短时挑战令牌，不落库，5 分钟过期。 */
export function createMfaChallenge(userId: string): { token: string; expiresInSeconds: number } {
  const payload = Buffer.from(
    JSON.stringify({
      uid: userId,
      exp: Date.now() + CHALLENGE_TTL_MS,
      nonce: randomBytes(8).toString('hex'),
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', challengeSecret()).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresInSeconds: CHALLENGE_TTL_MS / 1000 };
}

/** 校验挑战令牌的签名与过期时间，成功时返回 userId。 */
export function verifyMfaChallenge(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  const expected = createHmac('sha256', challengeSecret()).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.uid !== 'string' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp <= Date.now()) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}
