import { NextRequest, NextResponse } from 'next/server';
import { databaseConfigured } from '@/lib/db';
import { isLeagueConfigured, setupLeague } from '@/lib/store';
import type { SetupPlayerInput, SetupTeamInput } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!databaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 503 });
  try {
    if (await isLeagueConfigured()) return NextResponse.json({ error: 'League setup is already complete.' }, { status: 409 });
    const body = await req.json() as Record<string, unknown>;
    const draftId = await setupLeague({
      leagueName: String(body.leagueName || 'Draft League'),
      adminCode: String(body.adminCode || ''),
      primaryColor: String(body.primaryColor || '#2563eb'),
      secondaryColor: String(body.secondaryColor || '#0f172a'),
      logoUrl: body.logoUrl ? String(body.logoUrl) : null,
      rounds: Number(body.rounds || 4),
      clockSeconds: Number(body.clockSeconds || 120),
      teams: Array.isArray(body.teams) ? body.teams as SetupTeamInput[] : [],
      players: Array.isArray(body.players) ? body.players as SetupPlayerInput[] : [],
    });
    return NextResponse.json({ ok: true, draftId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'setup_failed' }, { status: 400 });
  }
}
