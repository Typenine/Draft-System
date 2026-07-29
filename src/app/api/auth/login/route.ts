import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { checkLoginRateLimit, clearLoginFailures, loginAttemptKey, recordLoginFailure } from '@/lib/auth-server';
import { authenticateAdminWithVersion, authenticateTeamWithVersion } from '@/lib/store';

export const runtime = 'nodejs';

function sessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { role?: string; code?: string; teamId?: string };
    const code = String(body.code || '');
    if (!code) return NextResponse.json({ error: 'Code is required.' }, { status: 400 });

    const scope = body.role === 'admin' ? 'admin' : `team:${String(body.teamId || 'none')}`;
    const attemptKey = loginAttemptKey(req, scope);
    const limit = await checkLoginRateLimit(attemptKey);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Try again later.', retryAfter: limit.retryAfter },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    if (body.role === 'admin') {
      const authVersion = await authenticateAdminWithVersion(code);
      if (authVersion === null) {
        await recordLoginFailure(attemptKey);
        return NextResponse.json({ error: 'Invalid commissioner code.' }, { status: 401 });
      }
      await clearLoginFailures(attemptKey);
      const response = NextResponse.json({ ok: true, role: 'admin', redirectTo: '/commissioner' });
      sessionCookie(response, createSessionToken({ role: 'admin', authVersion }));
      return response;
    }

    const teamId = body.teamId ? String(body.teamId) : null;
    if (!teamId) return NextResponse.json({ error: 'Choose your team.' }, { status: 400 });
    const authenticated = await authenticateTeamWithVersion(code, teamId);
    if (!authenticated) {
      await recordLoginFailure(attemptKey);
      return NextResponse.json({ error: 'That access code does not match the selected team.' }, { status: 401 });
    }
    await clearLoginFailures(attemptKey);
    const response = NextResponse.json({ ok: true, role: 'team', team: authenticated.team, redirectTo: '/draft/room/team' });
    sessionCookie(response, createSessionToken({ role: 'team', teamId: authenticated.team.id, authVersion: authenticated.authVersion }));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'login_failed' }, { status: 500 });
  }
}
