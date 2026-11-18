import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD_SECONDS = 30;

/** RFC 4648 base32（无填充），用于 TOTP 密钥。 */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** 解码 base32 密钥，忽略空格与末尾填充。 */
export function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of normalized) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('TOTP 密钥包含非法字符');
    value = ((value << 5) | index) & 0xffffffff;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** 生成 20 字节随机 TOTP 密钥，输出 base32 字符串。 */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** 按 RFC 6238 计算指定计数器的 6 位动态码。 */
export function totpCode(secret: Buffer, counter: number, digits = DEFAULT_DIGITS): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** 允许前后各一个时间窗，容忍客户端时钟偏差。 */
export function verifyTotp(secret: string, code: string, window = 1, now = Date.now()): boolean {
  const normalized = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DEFAULT_DIGITS}}$`).test(normalized)) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(now / 1000 / DEFAULT_PERIOD_SECONDS);
  const actual = Buffer.from(normalized);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(totpCode(key, counter + offset));
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

/** 生成验证器可识别的 otpauth:// 地址，供二维码展示。 */
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
