import { ensureSchema, getSql } from '../db';
import { hashCode, safeEqualHash } from '../auth';
import type { SetupPlayerInput, SetupTeamInput, Team } from '../types';
import { createDraft } from './draft';
import { int, mapTeam, normalizePlayers, rowsOf, slug, type Row } from './shared';

export async function isLeagueConfigured(): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = rowsOf(await sql`SELECT 1 FROM draft_settings WHERE id = 1 LIMIT 1`);
  return rows.length > 0;
}

export async function setupLeague(input: {
  leagueName: string;
  adminCode: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string | null;
  rounds: number;
  clockSeconds: number;
  teams: SetupTeamInput[];
  players: SetupPlayerInput[];
}): Promise<string> {
  await ensureSchema();
  if (await isLeagueConfigured()) throw new Error('league_already_configured');
  if (!input.adminCode.trim()) throw new Error('admin_code_required');
  if (input.teams.length < 2) throw new Error('at_least_two_teams_required');

  const teamIds = new Set<string>();
  const teams = input.teams.map((team, index) => {
    if (!team.name?.trim() || !team.loginCode?.trim()) throw new Error(`team_${index + 1}_incomplete`);
    let id = slug(team.name, `team-${index + 1}`);
    while (teamIds.has(id)) id = `${id}-${index + 1}`;
    teamIds.add(id);
    return {
      id,
      name: team.name.trim(),
      short_name: (team.shortName || team.name.slice(0, 4)).trim().toUpperCase(),
      primary_color: team.primaryColor || '#2563eb',
      secondary_color: team.secondaryColor || '#0f172a',
      logo_url: team.logoUrl || null,
      login_code_hash: hashCode(team.loginCode),
      sort_order: index,
    };
  });
  const players = normalizePlayers(input.players);
  const sql = getSql();

  await sql`
    INSERT INTO draft_settings
      (id, league_name, admin_code_hash, primary_color, secondary_color, logo_url, rounds, clock_seconds)
    VALUES
      (1, ${input.leagueName.trim() || 'Draft League'}, ${hashCode(input.adminCode)},
       ${input.primaryColor || '#2563eb'}, ${input.secondaryColor || '#0f172a'}, ${input.logoUrl || null},
       ${Math.max(1, int(input.rounds, 4))}, ${Math.max(10, int(input.clockSeconds, 120))})
  `;
  await sql`
    INSERT INTO draft_teams
      (id, name, short_name, primary_color, secondary_color, logo_url, login_code_hash, sort_order)
    SELECT id, name, short_name, primary_color, secondary_color, logo_url, login_code_hash, sort_order
    FROM jsonb_to_recordset(${JSON.stringify(teams)}::jsonb)
      AS team(id text, name text, short_name text, primary_color text, secondary_color text,
              logo_url text, login_code_hash text, sort_order integer)
  `;
  if (players.length) {
    await sql`
      INSERT INTO draft_players (id, name, position, pro_team, college, rank)
      SELECT id, name, position, pro_team, college, rank
      FROM jsonb_to_recordset(${JSON.stringify(players)}::jsonb)
        AS player(id text, name text, position text, pro_team text, college text, rank integer)
    `;
  }
  return createDraft(`Draft ${new Date().getFullYear()}`);
}

export async function authenticateAdmin(code: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = rowsOf<Row>(await sql`SELECT admin_code_hash FROM draft_settings WHERE id = 1 LIMIT 1`);
  return Boolean(rows[0] && safeEqualHash(String(rows[0].admin_code_hash), code));
}

export async function authenticateTeam(code: string): Promise<Team | null> {
  await ensureSchema();
  const sql = getSql();
  const teams = rowsOf<Row>(await sql`SELECT * FROM draft_teams ORDER BY sort_order`);
  const match = teams.find((team) => safeEqualHash(String(team.login_code_hash), code));
  return match ? mapTeam(match) : null;
}
