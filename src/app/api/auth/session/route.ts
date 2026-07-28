import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { getDraftState } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  if (session.role === 'admin') return NextResponse.json({ authenticated: true, role: 'admin' });
  const state = await getDraftState();
  const team = state.teams.find((item) => item.id === session.teamId) || null;
  if (!team) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, role: 'team', team });
}
