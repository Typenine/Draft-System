import { ensureSchema, getSql } from '../db';
import { hashCode, safeEqualHash } from '../auth';
import type { SetupPlayerInput, SetupTeamInput, Team } from '../types';
import { createDraft } from './draft';
import { int, mapTeam, normalizePlayers, rowsOf, slug, type Row } from './shared';

export const REQUIRED_TEAM_COUNT = 12;
export const REQUIRED_ROUNDS = 28;
export const REQUIRED_PLAYER_COUNT = REQUIRED_TEAM_COUNT * REQUIRED_ROUNDS;

const PLACEHOLDER_TEAM_NAMES = ['Alpha Wolves', 'Bay City', 'Capital Club', 'Desert Storm'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function safeColor(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && HEX_COLOR.test(normalized) ? normalized : fallback;
}

export async function isLeagueConfigured(): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = rowsOf(await sql`SELECT 1 FROM draft_settings WHERE id = 1 LIMIT 1`);
  return rows.length > 0;
}

export async function canReplacePlaceholderLeague(): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const settings = rowsOf<Row>(await sql`SELECT league_name FROM draft_settings WHERE id = 1 LIMIT 1`)[0];
  if (!settings || String(settings.league_name) !== 'Draft League') return false;

  const teams = rowsOf<Row>(await sql`SELECT name FROM draft_teams ORDER BY sort_order`);
  if (teams.length !== PLACEHOLDER_TEAM_NAMES.length) return false;
  if (teams.some((team, index) => String(team.name) !== PLACEHOLDER_TEAM_NAMES[index])) return false;

  const picks = rowsOf<Row>(await sql`SELECT COUNT(*)::int AS count FROM draft_picks`)[0];
  return int(picks?.count, 0) === 0;
}

export async function resetPlaceholderLeague(): Promise<void> {
  if (!(await canReplacePlaceholderLeague())) throw new Error('sample_replacement_not_available');
  const sql = getSql();
  await sql`DELETE FROM drafts`;
  await sql`DELETE FROM draft_players`;
  await sql`DELETE FROM draft_teams`;
  await sql`DELETE FROM draft_settings`;
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
  if (input.teams.length !== REQUIRED_TEAM_COUNT) throw new Error(`exactly_${REQUIRED_TEAM_COUNT}_teams_required`);

  const teamIds = new Set<string>();
  const loginCodes = new Set<string>();
  const teams = input.teams.map((team, index) => {
    if (!team.name?.trim() || !team.loginCode?.trim()) throw new Error(`team_${index + 1}_incomplete`);
    const normalizedLoginCode = team.loginCode.trim().toLowerCase();
    if (loginCodes.has(normalizedLoginCode)) throw new Error(`team_${index + 1}_login_code_duplicate`);
    loginCodes.add(normalizedLoginCode);

    let id = slug(team.name, `team-${index + 1}`);
    while (teamIds.has(id)) id = `${id}-${index + 1}`;
    teamIds.add(id);
    return {
      id,
      name: team.name.trim(),
      short_name: (team.shortName || team.name.slice(0, 4)).trim().toUpperCase(),
      primary_color: safeColor(team.primaryColor, '#2563eb'),
      secondary_color: safeColor(team.secondaryColor, '#0f172a'),
      logo_url: team.logoUrl || null,
      login_code_hash: hashCode(team.loginCode),
      sort_order: index,
    };
  });
  const players = normalizePlayers(input.players);
  if (players.length < REQUIRED_PLAYER_COUNT) throw new Error(`minimum_${REQUIRED_PLAYER_COUNT}_players_required`);
  const sql = getSql();

  await sql`
    INSERT INTO draft_settings
      (id, league_name, admin_code_hash, primary_color, secondary_color, logo_url, rounds, clock_seconds)
    VALUES
      (1, ${input.leagueName.trim() || 'Draft League'}, ${hashCode(input.adminCode)},
       ${safeColor(input.primaryColor, '#2563eb')}, ${safeColor(input.secondaryColor, '#0f172a')}, ${input.logoUrl || null},
       ${REQUIRED_ROUNDS}, ${Math.max(10, int(input.clockSeconds, 120))})
  `;
  await sql`
    INSERT INTO draft_teams
      (id, name, short_name, primary_color, secondary_color, logo_url, login_code_hash, sort_order)
    SELECT id, name, short_name, primary_color, secondary_color, logo_url, login_code_hash, sort_order
    FROM jsonb_to_recordset(${JSON.stringify(teams)}::jsonb)
      AS team(id text, name text, short_name text, primary_color text, secondary_color text,
              logo_url text, login_code_hash text, sort_order integer)
  `;
  await sql`
    INSERT INTO draft_players (id, name, position, pro_team, college, rank)
    SELECT id, name, position, pro_team, college, rank
    FROM jsonb_to_recordset(${JSON.stringify(players)}::jsonb)
      AS player(id text, name text, position text, pro_team text, college text, rank integer)
  `;
  return createDraft(`Draft ${new Date().getFullYear()}`);
}

export async function authenticateAdmin(code: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = rowsOf<Row>(await sql`SELECT admin_code_hash FROM draft_settings WHERE id = 1 LIMIT 1`);
  return Boolean(rows[0] && safeEqualHash(String(rows[0].admin_code_hash), code));
}

export async function authenticateTeam(code: string, teamId?: string | null): Promise<Team | null> {
  await ensureSchema();
  const sql = getSql();
  const teams = teamId
    ? rowsOf<Row>(await sql`SELECT * FROM draft_teams WHERE id = ${teamId} LIMIT 1`)
    : rowsOf<Row>(await sql`SELECT * FROM draft_teams ORDER BY sort_order`);
  const match = teams.find((team) => safeEqualHash(String(team.login_code_hash), code));
  return match ? mapTeam(match) : null;
}
