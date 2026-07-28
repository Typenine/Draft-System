import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { getTeamQueue, setTeamQueue } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function teamId(req: NextRequest): string | null {
  const session = readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  return session?.role === 'team' ? session.teamId : null;
}

export async function GET(req: NextRequest) {
  const id = teamId(req);
  if (!id) return NextResponse.json({ error: 'Team access required.' }, { status: 403 });
  return NextResponse.json({ queue: await getTeamQueue(id) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const id = teamId(req);
  if (!id) return NextResponse.json({ error: 'Team access required.' }, { status: 403 });
  const body = await req.json() as { playerIds?: string[] };
  return NextResponse.json({ queue: await setTeamQueue(id, Array.isArray(body.playerIds) ? body.playerIds : []) });
}
