import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestSession } from '@/lib/auth-server';
import { databaseConfigured, DatabaseNotConfiguredError } from '@/lib/db';
import { getDraftState } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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
    const [state, session] = await Promise.all([getDraftState(), verifyRequestSession(req)]);
    if (session?.role === 'admin') return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
    const ownPendingPick = session?.role === 'team' && state.pendingPick?.teamId === session.teamId ? state.pendingPick : null;
    return NextResponse.json({
      ...state,
      players: session?.role === 'team' ? state.players : [],
      availablePlayers: session?.role === 'team' ? state.availablePlayers : [],
      pendingPick: ownPendingPick,
      pendingTrades: [],
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'state_load_failed';
    return NextResponse.json({ error: message }, { status: error instanceof DatabaseNotConfiguredError ? 503 : 500 });
  }
}
