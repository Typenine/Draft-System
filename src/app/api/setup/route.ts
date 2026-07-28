import { NextRequest, NextResponse } from 'next/server';
import { DRAFTABLE_PLAYER_SOURCE } from '@/data/draftable-player-source';
import { databaseConfigured } from '@/lib/db';
import { getDraftablePlayers } from '@/lib/draftable-player-source';
import {
  isLeagueConfigured,
  REQUIRED_PLAYER_COUNT,
  REQUIRED_ROUNDS,
  REQUIRED_TEAM_COUNT,
  resetPlaceholderLeague,
  setupLeague,
} from '@/lib/store';
import type { DraftFormat, SetupTeamInput } from '@/lib/types';

export const runtime = 'nodejs';

function validIndexOrder(value: unknown, length: number, requireUnique: boolean): value is number[] {
  if (!Array.isArray(value) || value.length !== length) return false;
  const indexes = value.map(Number);
  if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= REQUIRED_TEAM_COUNT)) return false;
  return !requireUnique || new Set(indexes).size === REQUIRED_TEAM_COUNT;
}

function validatePayload(
  adminCode: string,
  teams: SetupTeamInput[],
  draftFormat: DraftFormat,
  baseOrder: unknown,
  draftOrder: unknown,
): string | null {
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
  if (draftFormat !== 'linear' && draftFormat !== 'snake') return 'invalid_draft_format';
  if (!validIndexOrder(baseOrder, REQUIRED_TEAM_COUNT, true)) return 'invalid_base_order';
  if (!validIndexOrder(draftOrder, REQUIRED_TEAM_COUNT * REQUIRED_ROUNDS, false)) return 'invalid_draft_order';
  return null;
}

export async function POST(req: NextRequest) {
  if (!databaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 503 });
  try {
    const body = await req.json() as Record<string, unknown>;
    const adminCode = String(body.adminCode || '');
    const teams = Array.isArray(body.teams) ? body.teams as SetupTeamInput[] : [];
    const draftFormat: DraftFormat = body.draftFormat === 'snake' ? 'snake' : 'linear';
    const validationError = validatePayload(adminCode, teams, draftFormat, body.baseOrder, body.draftOrder);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const players = getDraftablePlayers();
    if (players.length < REQUIRED_PLAYER_COUNT) {
      return NextResponse.json({ error: `minimum_${REQUIRED_PLAYER_COUNT}_players_required` }, { status: 500 });
    }

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
      draftFormat,
      baseOrder: body.baseOrder as number[],
      draftOrder: body.draftOrder as number[],
      teams,
      players,
    });
    return NextResponse.json({
      ok: true,
      draftId,
      rounds: REQUIRED_ROUNDS,
      playerCount: players.length,
      playerSource: DRAFTABLE_PLAYER_SOURCE.sheetName,
      draftFormat,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'setup_failed';
    const status = message === 'sample_replacement_not_available' ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
