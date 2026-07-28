import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { submitPick } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.role !== 'team') return NextResponse.json({ error: 'Team access required.' }, { status: 403 });
  const body = await req.json() as { playerId?: string };
  const ok = await submitPick(session.teamId, String(body.playerId || ''));
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Pick rejected. Confirm your team is on the clock and the player is available.' }, { status: 409 });
}
