import { NextRequest, NextResponse } from 'next/server';
import { databaseConfigured } from '@/lib/db';
import {
  isLeagueConfigured,
  REQUIRED_PLAYER_COUNT,
  REQUIRED_ROUNDS,
  REQUIRED_TEAM_COUNT,
  resetPlaceholderLeague,
  setupLeague,
} from '@/lib/store';
import type { SetupPlayerInput, SetupTeamInput } from '@/lib/types';

export const runtime = 'nodejs';

function validatePayload(adminCode: string, teams: SetupTeamInput[], players: SetupPlayerInput[]): string | null {
  if (!adminCode.trim()) return 'admin_code_required';
  if (teams.length !== REQUIRED_TEAM_COUNT) return `exactly_${REQUIRED_TEAM_COUNT}_teams_required`;
  const codes = new Set<string>();
  for (let index = 0; index < teams.length; index += 1) {
    const team = teams[index];
    if (!team?.name?.trim() || !team?.loginCode?.trim()) return `team_${index + 1}_incomplete`;
    const code = team.loginCode.trim().toLowerCase();
    if (codes.has(code)) return `team_${index + 1}_login_code_duplicate`;
    codes.add(code);
  }
  const validPlayers = players.filter((player) => player?.name?.trim() && player?.position?.trim());
  if (validPlayers.length < REQUIRED_PLAYER_COUNT) return `minimum_${REQUIRED_PLAYER_COUNT}_players_required`;
  return null;
}

export async function POST(req: NextRequest) {
  if (!databaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 503 });
  try {
    const body = await req.json() as Record<string, unknown>;
    const adminCode = String(body.adminCode || '');
    const teams = Array.isArray(body.teams) ? body.teams as SetupTeamInput[] : [];
    const players = Array.isArray(body.players) ? body.players as SetupPlayerInput[] : [];
    const validationError = validatePayload(adminCode, teams, players);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    if (await isLeagueConfigured()) {
      if (body.replacePlaceholder === true) await resetPlaceholderLeague();
      else return NextResponse.json({ error: 'League setup is already complete.' }, { status: 409 });
    }

    const draftId = await setupLeague({
      leagueName: String(body.leagueName || 'Draft League'),
      adminCode,
      primaryColor: String(body.primaryColor || '#2563eb'),
      secondaryColor: String(body.secondaryColor || '#0f172a'),
      logoUrl: body.logoUrl ? String(body.logoUrl) : null,
      rounds: REQUIRED_ROUNDS,
      clockSeconds: Number(body.clockSeconds || 120),
      teams,
      players,
    });
    return NextResponse.json({ ok: true, draftId, rounds: REQUIRED_ROUNDS, playerCount: players.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'setup_failed';
    const status = message === 'sample_replacement_not_available' ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
