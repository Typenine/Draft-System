import { getSql } from '../db';
import type { DraftPick, DraftSlot, DraftSummary, Player, SetupPlayerInput, Team } from '../types';

export type Row = Record<string, unknown>;

export function rowsOf<T = Row>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function int(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function slug(value: string, fallback: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

export function mapTeam(row: Row): Team {
  return {
    id: String(row.id),
    name: String(row.name),
    shortName: String(row.short_name),
    primaryColor: String(row.primary_color),
    secondaryColor: String(row.secondary_color),
    logoUrl: row.logo_url ? String(row.logo_url) : null,
    sortOrder: int(row.sort_order),
  };
}

export function mapPlayer(row: Row): Player {
  return {
    id: String(row.id),
    name: String(row.name),
    position: String(row.position),
    proTeam: row.pro_team ? String(row.pro_team) : null,
    college: row.college ? String(row.college) : null,
    rank: int(row.rank, 9999),
  };
}

export function mapDraft(row: Row): DraftSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    status: String(row.status) as DraftSummary['status'],
    rounds: int(row.rounds),
    clockSeconds: int(row.clock_seconds),
    currentOverall: int(row.current_overall, 1),
    deadlineTs: row.deadline_ts ? new Date(String(row.deadline_ts)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    startedAt: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
  };
}

export function mapPick(row: Row): DraftPick {
  return {
    overall: int(row.overall),
    round: int(row.round),
    teamId: String(row.team_id),
    playerId: String(row.player_id),
    playerName: String(row.player_name),
    playerPosition: String(row.player_position),
    playerProTeam: row.player_pro_team ? String(row.player_pro_team) : null,
    madeAt: new Date(String(row.made_at)).toISOString(),
  };
}

export function normalizePlayers(players: SetupPlayerInput[]): Array<{
  id: string;
  name: string;
  position: string;
  pro_team: string | null;
  college: string | null;
  rank: number;
}> {
  const ids = new Set<string>();
  return players
    .filter((player) => player?.name?.trim() && player?.position?.trim())
    .map((player, index) => {
      let id = player.id?.trim() || slug(player.name, `player-${index + 1}`);
      while (ids.has(id)) id = `${id}-${index + 1}`;
      ids.add(id);
      return {
        id,
        name: player.name.trim(),
        position: player.position.trim().toUpperCase(),
        pro_team: player.proTeam?.trim() || null,
        college: player.college?.trim() || null,
        rank: Math.max(1, int(player.rank, index + 1)),
      };
    });
}

export async function activeDraftRow(): Promise<Row | null> {
  const sql = getSql();
  const rows = rowsOf<Row>(await sql`SELECT * FROM drafts ORDER BY created_at DESC LIMIT 1`);
  return rows[0] || null;
}

export async function loadDraftPieces(draftId: string): Promise<{ slots: DraftSlot[]; picks: DraftPick[] }> {
  const sql = getSql();
  const slots = rowsOf<Row>(await sql`
    SELECT overall, round, pick_in_round, team_id FROM draft_slots WHERE draft_id = ${draftId} ORDER BY overall
  `).map((row) => ({
    overall: int(row.overall),
    round: int(row.round),
    pickInRound: int(row.pick_in_round),
    teamId: String(row.team_id),
  }));
  const picks = rowsOf<Row>(await sql`
    SELECT overall, round, team_id, player_id, player_name, player_position, player_pro_team, made_at
    FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall
  `).map(mapPick);
  return { slots, picks };
}
