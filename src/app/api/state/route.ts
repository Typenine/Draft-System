import { NextResponse } from 'next/server';
import { databaseConfigured, DatabaseNotConfiguredError } from '@/lib/db';
import { getDraftState } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json({
      configured: false,
      databaseConfigured: false,
      error: 'DATABASE_URL is not configured.',
      draft: null,
      teams: [],
      players: [],
      slots: [],
      picks: [],
      currentTeam: null,
      availablePlayers: [],
    }, { status: 503 });
  }
  try {
    return NextResponse.json(await getDraftState(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'state_load_failed';
    return NextResponse.json({ error: message }, { status: error instanceof DatabaseNotConfiguredError ? 503 : 500 });
  }
}
