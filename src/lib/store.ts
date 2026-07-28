import { randomUUID } from 'crypto';
import { ensureSchema, getSql } from './db';
import { hashCode, safeEqualHash } from './auth';
import type {
  DraftPick,
  DraftSlot,
  DraftState,
  Player,
  SetupPlayerInput,
  SetupTeamInput,
  Team,
} from './types';

function rowsOf<T>(value: unknown): T[] {
  return (value as T[]) || [];
}

function slug(value: string, fallback: string): string {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || fallback;
}

function int(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapTeam(row: Record<string, unknown>): Team {
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

function mapPlayer(row: Record<string, unknown>): Player {
  return {
    id: String(row.id),
    name: String(row.name),
    position: String(row.position),
    proTeam: row.pro_team ? String(row.pro_team) : null,
    college: row.college ? String(row.college) : null,
    rank: int(row.rank, 9999),
  };
}

export async function isLeagueConfigured(): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`SELECT 1 FROM draft_settings WHERE id = 1 LIMIT 1`;
  return rowsOf(result).length > 0;
}

export async function setupLeague(input: {
  leagueName: string;
  adminCode: string;
  rounds: number;
  clockSeconds: number;
  teams: SetupTeamInput[];
  players: SetupPlayerInput[];
}): Promise<string> {
  await ensureSchema();
  if (await isLeagueConfigured()) throw new Error('league_already_configured');
  if (input.teams.length < 2) throw new Error('at_least_two_teams_required');
  if (!input.adminCode.trim()) throw new Error('admin_code_required');

  const sql = getSql();
  const teamIds = new Set<string>();
  const teams = input.teams.map((team, index) => {
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

  const playerIds = new Set<string>();
  const players = input.players.map((player, index) => {
    let id = player.id?.trim() || slug(player.name, `player-${index + 1}`);
    while (playerIds.has(id)) id = `${id}-${index + 1}`;
    playerIds.add(id);
    return {
      id,
      name: player.name.trim(),
      position: player.position.trim().toUpperCase(),
      pro_team: player.proTeam?.trim() || null,
      college: player.college?.trim() || null,
      rank: player.rank || index + 1,
    };
  });

  await sql`
    INSERT INTO draft_settings (id, league_name, admin_code_hash, rounds, clock_seconds)
    VALUES (1, ${input.leagueName.trim()}, ${hashCode(input.adminCode)}, ${Math.max(1, input.rounds)}, ${Math.max(10, input.clockSeconds)})
  `;
  await sql`
    INSERT INTO draft_teams (id, name, short_name, primary_color, secondary_color, logo_url, login_code_hash, sort_order)
    SELECT id, name, short_name, primary_color, secondary_color, logo_url, login_code_hash, sort_order
    FROM jsonb_to_recordset(${JSON.stringify(teams)}::jsonb)
      AS team(id text, name text, short_name text, primary_color text, secondary_color text, logo_url text, login_code_hash text, sort_order integer)
  `;
  if (players.length) {
    await sql`
      INSERT INTO draft_players (id, name, position, pro_team, college, rank)
      SELECT id, name, position, pro_team, college, rank
      FROM jsonb_to_recordset(${JSON.stringify(players)}::jsonb)
        AS player(id text, name text, position text, pro_team text, college text, rank integer)
    `;
  }
  return createDraft('Draft 1');
}

export async function authenticateAdmin(code: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = rowsOf<Record<string, unknown>>(await sql`SELECT admin_code_hash FROM draft_settings WHERE id = 1 LIMIT 1`);
  return Boolean(rows[0] && safeEqualHash(String(rows[0].admin_code_hash), code));
}

export async function authenticateTeam(code: string): Promise<Team | null> {
  await ensureSchema();
  const sql = getSql();
  const teams = rowsOf<Record<string, unknown>>(await sql`SELECT * FROM draft_teams ORDER BY sort_order`);
  const match = teams.find((team) => safeEqualHash(String(team.login_code_hash), code));
  return match ? mapTeam(match) : null;
}

export async function createDraft(name: string): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const settings = rowsOf<Record<string, unknown>>(await sql`SELECT rounds, clock_seconds FROM draft_settings WHERE id = 1 LIMIT 1`)[0];
  if (!settings) throw new Error('league_not_configured');
  const teams = rowsOf<Record<string, unknown>>(await sql`SELECT id FROM draft_teams ORDER BY sort_order`);
  if (teams.length < 2) throw new Error('teams_not_configured');

  const draftId = randomUUID();
  const rounds = int(settings.rounds, 4);
  const clockSeconds = int(settings.clock_seconds, 120);
  await sql`
    INSERT INTO drafts (id, name, rounds, clock_seconds)
    VALUES (${draftId}, ${name.trim() || 'Draft'}, ${rounds}, ${clockSeconds})
  `;

  const slots: Array<{ overall: number; round: number; pick_in_round: number; team_id: string }> = [];
  for (let round = 1; round <= rounds; round += 1) {
    teams.forEach((team, index) => slots.push({
      overall: (round - 1) * teams.length + index + 1,
      round,
      pick_in_round: index + 1,
      team_id: String(team.id),
    }));
  }
  await sql`
    INSERT INTO draft_slots (draft_id, overall, round, pick_in_round, team_id)
    SELECT ${draftId}, overall, round, pick_in_round, team_id
    FROM jsonb_to_recordset(${JSON.stringify(slots)}::jsonb)
      AS slot(overall integer, round integer, pick_in_round integer, team_id text)
  `;
  return draftId;
}

async function activeDraftRow(): Promise<Record<string, unknown> | null> {
  const sql = getSql();
  const rows = rowsOf<Record<string, unknown>>(await sql`SELECT * FROM drafts ORDER BY created_at DESC LIMIT 1`);
  return rows[0] || null;
}

async function advanceDraft(draftId: string, currentOverall: number, status: string, clockSeconds: number): Promise<void> {
  const sql = getSql();
  const totalRows = rowsOf<Record<string, unknown>>(await sql`SELECT COUNT(*)::int AS total FROM draft_slots WHERE draft_id = ${draftId}`);
  const total = int(totalRows[0]?.total);
  if (currentOverall >= total) {
    await sql`
      UPDATE drafts SET status = 'COMPLETED', completed_at = now(), deadline_ts = NULL
      WHERE id = ${draftId}
    `;
    return;
  }
  const next = currentOverall + 1;
  await sql`
    UPDATE drafts
    SET current_overall = ${next},
        deadline_ts = CASE WHEN ${status} = 'LIVE' THEN now() + (${clockSeconds} * interval '1 second') ELSE NULL END
    WHERE id = ${draftId}
  `;
}

async function makePickInternal(draftId: string, teamId: string, playerId: string): Promise<boolean> {
  const sql = getSql();
  const draft = rowsOf<Record<string, unknown>>(await sql`SELECT * FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];
  if (!draft || draft.status !== 'LIVE') return false;
  const overall = int(draft.current_overall, 1);
  const slot = rowsOf<Record<string, unknown>>(await sql`
    SELECT * FROM draft_slots WHERE draft_id = ${draftId} AND overall = ${overall} LIMIT 1
  `)[0];
  if (!slot || String(slot.team_id) !== teamId) return false;
  const player = rowsOf<Record<string, unknown>>(await sql`
    SELECT p.* FROM draft_players p
    WHERE p.id = ${playerId}
      AND NOT EXISTS (SELECT 1 FROM draft_picks dp WHERE dp.draft_id = ${draftId} AND dp.player_id = p.id)
    LIMIT 1
  `)[0];
  if (!player) return false;

  const inserted = rowsOf(await sql`
    INSERT INTO draft_picks
      (draft_id, overall, round, team_id, player_id, player_name, player_position, player_pro_team)
    VALUES
      (${draftId}, ${overall}, ${int(slot.round)}, ${teamId}, ${playerId}, ${String(player.name)}, ${String(player.position)}, ${player.pro_team ? String(player.pro_team) : null})
    ON CONFLICT DO NOTHING
    RETURNING overall
  `);
  if (!inserted.length) return false;
  await sql`DELETE FROM draft_queues WHERE draft_id = ${draftId} AND player_id = ${playerId}`;
  await advanceDraft(draftId, overall, String(draft.status), int(draft.clock_seconds, 120));
  return true;
}

export async function submitPick(teamId: string, playerId: string): Promise<boolean> {
  await ensureSchema();
  const draft = await activeDraftRow();
  if (!draft) return false;
  return makePickInternal(String(draft.id), teamId, playerId);
}

async function autoPickExpiredDraft(): Promise<boolean> {
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft || draft.status !== 'LIVE' || !draft.deadline_ts) return false;
  if (new Date(String(draft.deadline_ts)).getTime() > Date.now()) return false;
  const draftId = String(draft.id);
  const overall = int(draft.current_overall, 1);
  const slot = rowsOf<Record<string, unknown>>(await sql`
    SELECT team_id FROM draft_slots WHERE draft_id = ${draftId} AND overall = ${overall} LIMIT 1
  `)[0];
  if (!slot) return false;
  const teamId = String(slot.team_id);
  const queued = rowsOf<Record<string, unknown>>(await sql`
    SELECT q.player_id
    FROM draft_queues q
    WHERE q.draft_id = ${draftId} AND q.team_id = ${teamId}
      AND NOT EXISTS (SELECT 1 FROM draft_picks p WHERE p.draft_id = ${draftId} AND p.player_id = q.player_id)
    ORDER BY q.rank
    LIMIT 1
  `)[0];
  const fallback = queued || rowsOf<Record<string, unknown>>(await sql`
    SELECT p.id AS player_id
    FROM draft_players p
    WHERE NOT EXISTS (SELECT 1 FROM draft_picks dp WHERE dp.draft_id = ${draftId} AND dp.player_id = p.id)
    ORDER BY p.rank, p.name
    LIMIT 1
  `)[0];
  if (!fallback) {
    await advanceDraft(draftId, overall, String(draft.status), int(draft.clock_seconds, 120));
    return true;
  }
  return makePickInternal(draftId, teamId, String(fallback.player_id));
}

export async function getDraftState(): Promise<DraftState> {
  await ensureSchema();
  const sql = getSql();
  const settings = rowsOf<Record<string, unknown>>(await sql`SELECT * FROM draft_settings WHERE id = 1 LIMIT 1`)[0];
  if (!settings) {
    return { configured: false, draft: null, teams: [], players: [], slots: [], picks: [], currentTeam: null, availablePlayers: [] };
  }

  await autoPickExpiredDraft();
  const draft = await activeDraftRow();
  const teams = rowsOf<Record<string, unknown>>(await sql`SELECT * FROM draft_teams ORDER BY sort_order`).map(mapTeam);
  const players = rowsOf<Record<string, unknown>>(await sql`SELECT * FROM draft_players ORDER BY rank, name`).map(mapPlayer);
  if (!draft) {
    return { configured: true, leagueName: String(settings.league_name), draft: null, teams, players, slots: [], picks: [], currentTeam: null, availablePlayers: players };
  }

  const draftId = String(draft.id);
  const slots: DraftSlot[] = rowsOf<Record<string, unknown>>(await sql`
    SELECT overall, round, pick_in_round, team_id FROM draft_slots WHERE draft_id = ${draftId} ORDER BY overall
  `).map((row) => ({ overall: int(row.overall), round: int(row.round), pickInRound: int(row.pick_in_round), teamId: String(row.team_id) }));
  const picks: DraftPick[] = rowsOf<Record<string, unknown>>(await sql`
    SELECT overall, round, team_id, player_id, player_name, player_position, player_pro_team, made_at
    FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall
  `).map((row) => ({
    overall: int(row.overall),
    round: int(row.round),
    teamId: String(row.team_id),
    playerId: String(row.player_id),
    playerName: String(row.player_name),
    playerPosition: String(row.player_position),
    playerProTeam: row.player_pro_team ? String(row.player_pro_team) : null,
    madeAt: new Date(String(row.made_at)).toISOString(),
  }));
  const pickedIds = new Set(picks.map((pick) => pick.playerId));
  const availablePlayers = players.filter((player) => !pickedIds.has(player.id));
  const currentSlot = slots.find((slot) => slot.overall === int(draft.current_overall));
  const currentTeam = currentSlot ? teams.find((team) => team.id === currentSlot.teamId) || null : null;

  return {
    configured: true,
    leagueName: String(settings.league_name),
    draft: {
      id: draftId,
      name: String(draft.name),
      status: String(draft.status) as DraftState['draft'] extends infer D ? D extends { status: infer S } ? S : never : never,
      rounds: int(draft.rounds),
      clockSeconds: int(draft.clock_seconds),
      currentOverall: int(draft.current_overall),
      deadlineTs: draft.deadline_ts ? new Date(String(draft.deadline_ts)).toISOString() : null,
      createdAt: new Date(String(draft.created_at)).toISOString(),
      startedAt: draft.started_at ? new Date(String(draft.started_at)).toISOString() : null,
      completedAt: draft.completed_at ? new Date(String(draft.completed_at)).toISOString() : null,
    },
    teams,
    players,
    slots,
    picks,
    currentTeam,
    availablePlayers,
  };
}

export async function getTeamQueue(teamId: string): Promise<Player[]> {
  await ensureSchema();
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft) return [];
  const rows = rowsOf<Record<string, unknown>>(await sql`
    SELECT p.*
    FROM draft_queues q
    JOIN draft_players p ON p.id = q.player_id
    WHERE q.draft_id = ${String(draft.id)} AND q.team_id = ${teamId}
      AND NOT EXISTS (SELECT 1 FROM draft_picks dp WHERE dp.draft_id = q.draft_id AND dp.player_id = q.player_id)
    ORDER BY q.rank
  `);
  return rows.map(mapPlayer);
}

export async function setTeamQueue(teamId: string, playerIds: string[]): Promise<Player[]> {
  await ensureSchema();
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft) return [];
  const draftId = String(draft.id);
  await sql`DELETE FROM draft_queues WHERE draft_id = ${draftId} AND team_id = ${teamId}`;
  const unique = [...new Set(playerIds)].slice(0, 100);
  if (unique.length) {
    const queue = unique.map((playerId, index) => ({ player_id: playerId, rank: index + 1 }));
    await sql`
      INSERT INTO draft_queues (draft_id, team_id, player_id, rank)
      SELECT ${draftId}, ${teamId}, player_id, rank
      FROM jsonb_to_recordset(${JSON.stringify(queue)}::jsonb) AS item(player_id text, rank integer)
      WHERE EXISTS (SELECT 1 FROM draft_players p WHERE p.id = item.player_id)
        AND NOT EXISTS (SELECT 1 FROM draft_picks dp WHERE dp.draft_id = ${draftId} AND dp.player_id = item.player_id)
      ON CONFLICT DO NOTHING
    `;
  }
  return getTeamQueue(teamId);
}

export async function runAdminAction(action: string, body: Record<string, unknown>): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  let draft = await activeDraftRow();

  if (action === 'create') {
    await createDraft(String(body.name || `Draft ${new Date().getFullYear()}`));
    return;
  }
  if (!draft) throw new Error('no_draft');
  const draftId = String(draft.id);
  const clockSeconds = int(draft.clock_seconds, 120);

  if (action === 'start') {
    await sql`
      UPDATE drafts SET status = 'LIVE', started_at = COALESCE(started_at, now()),
        deadline_ts = now() + (${clockSeconds} * interval '1 second'), completed_at = NULL
      WHERE id = ${draftId} AND status <> 'COMPLETED'
    `;
    return;
  }
  if (action === 'pause') {
    await sql`UPDATE drafts SET status = 'PAUSED', deadline_ts = NULL WHERE id = ${draftId} AND status = 'LIVE'`;
    return;
  }
  if (action === 'resume') {
    await sql`
      UPDATE drafts SET status = 'LIVE', deadline_ts = now() + (${clockSeconds} * interval '1 second')
      WHERE id = ${draftId} AND status IN ('PAUSED','NOT_STARTED')
    `;
    return;
  }
  if (action === 'reset') {
    await sql`DELETE FROM draft_picks WHERE draft_id = ${draftId}`;
    await sql`DELETE FROM draft_queues WHERE draft_id = ${draftId}`;
    await sql`
      UPDATE drafts SET status = 'NOT_STARTED', current_overall = 1, deadline_ts = NULL,
        started_at = NULL, completed_at = NULL WHERE id = ${draftId}
    `;
    return;
  }
  if (action === 'undo') {
    const last = rowsOf<Record<string, unknown>>(await sql`
      SELECT overall FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall DESC LIMIT 1
    `)[0];
    if (!last) return;
    await sql`DELETE FROM draft_picks WHERE draft_id = ${draftId} AND overall = ${int(last.overall)}`;
    await sql`
      UPDATE drafts SET current_overall = ${int(last.overall)}, status = 'PAUSED', deadline_ts = NULL, completed_at = NULL
      WHERE id = ${draftId}
    `;
    return;
  }
  if (action === 'skip') {
    await advanceDraft(draftId, int(draft.current_overall), String(draft.status), clockSeconds);
    return;
  }
  if (action === 'set_slot') {
    const overall = int(body.overall);
    const teamId = String(body.teamId || '');
    if (!overall || !teamId) throw new Error('invalid_slot');
    await sql`
      UPDATE draft_slots SET team_id = ${teamId}
      WHERE draft_id = ${draftId} AND overall = ${overall}
        AND NOT EXISTS (SELECT 1 FROM draft_picks p WHERE p.draft_id = ${draftId} AND p.overall = ${overall})
    `;
    return;
  }
  if (action === 'set_clock') {
    const nextClock = Math.max(10, int(body.clockSeconds, clockSeconds));
    await sql`UPDATE draft_settings SET clock_seconds = ${nextClock}, updated_at = now() WHERE id = 1`;
    await sql`UPDATE drafts SET clock_seconds = ${nextClock}, deadline_ts = NULL, status = CASE WHEN status = 'LIVE' THEN 'PAUSED' ELSE status END WHERE id = ${draftId}`;
    return;
  }
  if (action === 'replace_players') {
    const pickCount = int(rowsOf<Record<string, unknown>>(await sql`SELECT COUNT(*)::int AS total FROM draft_picks WHERE draft_id = ${draftId}`)[0]?.total);
    if (pickCount) throw new Error('cannot_replace_players_after_picks');
    const players = Array.isArray(body.players) ? body.players as SetupPlayerInput[] : [];
    await sql`DELETE FROM draft_queues`;
    await sql`DELETE FROM draft_players`;
    const normalized = players.map((player, index) => ({
      id: player.id?.trim() || slug(player.name, `player-${index + 1}`),
      name: player.name.trim(),
      position: player.position.trim().toUpperCase(),
      pro_team: player.proTeam?.trim() || null,
      college: player.college?.trim() || null,
      rank: player.rank || index + 1,
    }));
    if (normalized.length) {
      await sql`
        INSERT INTO draft_players (id, name, position, pro_team, college, rank)
        SELECT id, name, position, pro_team, college, rank
        FROM jsonb_to_recordset(${JSON.stringify(normalized)}::jsonb)
          AS player(id text, name text, position text, pro_team text, college text, rank integer)
      `;
    }
    return;
  }
  if (action === 'force_pick') {
    draft = await activeDraftRow();
    if (!draft) throw new Error('no_draft');
    const overall = int(draft.current_overall);
    const slot = rowsOf<Record<string, unknown>>(await sql`SELECT team_id FROM draft_slots WHERE draft_id = ${draftId} AND overall = ${overall} LIMIT 1`)[0];
    if (!slot) throw new Error('no_slot');
    if (draft.status !== 'LIVE') {
      await sql`UPDATE drafts SET status = 'LIVE', deadline_ts = now() + (${clockSeconds} * interval '1 second') WHERE id = ${draftId}`;
    }
    const ok = await makePickInternal(draftId, String(slot.team_id), String(body.playerId || ''));
    if (!ok) throw new Error('force_pick_failed');
    return;
  }
  throw new Error('unknown_action');
}
