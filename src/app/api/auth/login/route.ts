import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { authenticateAdmin, authenticateTeam } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { role?: string; code?: string; teamId?: string };
    const code = String(body.code || '');
    if (!code) return NextResponse.json({ error: 'Code is required.' }, { status: 400 });

    if (body.role === 'admin') {
      if (!(await authenticateAdmin(code))) return NextResponse.json({ error: 'Invalid commissioner code.' }, { status: 401 });
      const response = NextResponse.json({ ok: true, role: 'admin', redirectTo: '/commissioner' });
      response.cookies.set(SESSION_COOKIE, createSessionToken({ role: 'admin' }), {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 14,
      });
      return response;
    }

    const teamId = body.teamId ? String(body.teamId) : null;
    if (!teamId) return NextResponse.json({ error: 'Choose your team.' }, { status: 400 });
    const team = await authenticateTeam(code, teamId);
    if (!team) return NextResponse.json({ error: 'That access code does not match the selected team.' }, { status: 401 });
    const response = NextResponse.json({ ok: true, role: 'team', team, redirectTo: '/draft/room/team' });
    response.cookies.set(SESSION_COOKIE, createSessionToken({ role: 'team', teamId: team.id }), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 14,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'login_failed' }, { status: 500 });
  }
}
