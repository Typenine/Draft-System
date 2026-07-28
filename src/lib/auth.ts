import { createHmac, scryptSync, timingSafeEqual } from 'crypto';
import type { Session } from './types';

export const SESSION_COOKIE = 'draft_system_session';

function secret(): string {
  return process.env.SESSION_SECRET || process.env.DATABASE_URL || 'draft-system-local-development';
}

export function hashCode(code: string): string {
  return scryptSync(code.trim(), 'draft-system-code-v1', 32).toString('hex');
}

export function safeEqualHash(storedHash: string, candidate: string): boolean {
  try {
    const left = Buffer.from(storedHash, 'hex');
    const right = Buffer.from(hashCode(candidate), 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function signature(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

type SessionInput = { role: 'admin' } | { role: 'team'; teamId: string };

export function createSessionToken(session: SessionInput, hours = 24 * 14): string {
  const payload = Buffer.from(JSON.stringify({ ...session, exp: Date.now() + hours * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function readSessionToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return null;
  const expected = signature(payload);
  const left = Buffer.from(expected);
  const right = Buffer.from(suppliedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    if (!session.exp || session.exp < Date.now()) return null;
    if (session.role === 'admin') return session;
    if (session.role === 'team' && session.teamId) return session;
    return null;
  } catch {
    return null;
  }
}
