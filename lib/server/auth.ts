import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'crypto';

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err); else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt);
  return { hash: key.toString('base64'), salt: salt.toString('base64') };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const saltBuf = Buffer.from(salt, 'base64');
  const key = await scrypt(pin, saltBuf);
  const hashBuf = Buffer.from(hash, 'base64');
  if (hashBuf.length !== key.length) return false;
  return timingSafeEqual(hashBuf, key);
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  return 'evw-default-auth-secret-change-me';
}

export function signSession(payload: Record<string, unknown>): string {
  const secret = getSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySession(token: string): Record<string, unknown> | null {
  const secret = getSecret();
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  const ok = timingSafeEqual(sigBuf, expectedBuf);
  if (!ok) return null;
  try {
    const json = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Record<string, unknown>;
    const exp = typeof json.exp === 'number' ? json.exp : 0;
    if (Date.now() > exp) return null;
    return json;
  } catch {
    return null;
  }
}
