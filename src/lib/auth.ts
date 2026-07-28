import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import type { Session } from './types';

export const SESSION_COOKIE = 'draft_session';

function authSecret(): string {
  return process.env.AUTH_SECRET || process.env.DATABASE_URL || 'draft-system-local-development';
}

export function hashCode(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

export function safeEqualHash(actualHash: string, plainValue: string): boolean {
  const expected = Buffer.from(actualHash, 'hex');
  const actual = Buffer.from(hashCode(plainValue), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = createHmac('sha256', authSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', authSecret()).update(payload).digest('base64url');
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    if (!parsed?.role || !parsed.exp || parsed.exp < Date.now()) return null;
    if (parsed.role === 'team' && !parsed.teamId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sessionFromRequest(req: NextRequest): Session | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

export function makeAdminSession(): Session {
  return { role: 'admin', exp: Date.now() + 1000 * 60 * 60 * 24 * 14 };
}

export function makeTeamSession(teamId: string): Session {
  return { role: 'team', teamId, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 };
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 14,
};
