import { randomUUID } from 'crypto';
import { eventLogoUrl } from '../branding';
import { ensureSchema, getSql } from '../db';
import type { ArchiveDraft, DraftFormat, DraftState, PendingPick } from '../types';
import { listModerationTrades } from './moderation';
import { activeDraftRow, int, loadDraftPieces, mapDraft, mapPlayer, mapTeam, rowsOf, type Row } from './shared';

function parsedStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeDraftFormat(value: unknown): DraftFormat {
  return value === 'snake' ? 'snake' : 'linear';
}

export function normalizeBaseOrder(order: unknown, validTeamIds: string[]): string[] {
  const proposed = parsedStringArray(order);
  const valid = new Set(validTeamIds);
  if (proposed.length === validTeamIds.length && new Set(proposed).size === validTeamIds.length && proposed.every((teamId) => valid.has(teamId))) {
    return proposed;
  }
  return [...validTeamIds];
}

export function generateSlotTeamIds(baseOrder: string[], rounds: number, format: DraftFormat): string[] {
  const slots: string[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const roundOrder = format === 'snake' && round % 2 === 0 ? [...baseOrder].reverse() : baseOrder;
    slots.push(...roundOrder);
  }
  return slots;
}

function normalizeSlotOrder(order: unknown, generated: string[], validTeamIds: string[]): string[] {
  const proposed = parsedStringArray(order);
  const valid = new Set(validTeamIds);
  if (proposed.length === generated.length && proposed.every((teamId) => valid.has(teamId))) return proposed;
  return generated;
}

function mapPendingPick(row: Row): PendingPick {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    overall: int(row.overall),
    teamId: String(row.team_id),
    teamName: String(row.team_name),
    playerId: String(row.player_id),
    playerName: String(row.player_name),
    playerPosition: String(row.player_position),
    playerProTeam: row.player_pro_team ? String(row.player_pro_team) : null,
    submittedAt: new Date(String(row.submitted_at)).toISOString(),
  };
}

export async function getPendingPick(draftId?: string | null): Promise<PendingPick | null> {
  await ensureSchema();
  const sql = getSql();
  const id = draftId || String((await activeDraftRow())?.id || '');
  if (!id) return null;
  const row = rowsOf<Row>(await sql`
    SELECT pending.*, team.name AS team_name
    FROM draft_pending_picks pending
    JOIN draft_teams team ON team.id = pending.team_id
    WHERE pending.draft_id = ${id} AND pending.status = 'pending'
    ORDER BY pending.submitted_at DESC LIMIT 1
  `)[0];
  return row ? mapPendingPick(row) : null;
}

export async function createDraft(name: string, options: {
  draftFormat?: DraftFormat;
  baseOrder?: string[];
  slotTeamIds?: string[];
} = {}): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const settings = rowsOf<Row>(await sql`SELECT rounds, clock_seconds, draft_format, base_order FROM draft_settings WHERE id = 1 LIMIT 1`)[0];
  const teams = rowsOf<Row>(await sql`SELECT id FROM draft_teams ORDER BY sort_order`);
  if (!settings || teams.length < 2) throw new Error('league_not_configured');

  const draftId = randomUUID();
  const rounds = int(settings.rounds, 28);
  const clockSeconds = int(settings.clock_seconds, 120);
  const teamIds = teams.map((team) => String(team.id));
  const draftFormat = normalizeDraftFormat(options.draftFormat || settings.draft_format);
  const baseOrder = normalizeBaseOrder(options.baseOrder || settings.base_order, teamIds);
  const generated = generateSlotTeamIds(baseOrder, rounds, draftFormat);
  const slotTeamIds = normalizeSlotOrder(options.slotTeamIds, generated, teamIds);

  await sql`INSERT INTO drafts (id, name, rounds, clock_seconds) VALUES (${draftId}, ${name.trim() || 'Draft'}, ${rounds}, ${clockSeconds})`;

  const slots = slotTeamIds.map((teamId, index) => ({
    overall: index + 1,
    round: Math.floor(index / teamIds.length) + 1,
    pick_in_round: (index % teamIds.length) + 1,
    team_id: teamId,
  }));
  await sql`
    INSERT INTO draft_slots (draft_id, overall, round, pick_in_round, team_id)
    SELECT ${draftId}, overall, round, pick_in_round, team_id
    FROM jsonb_to_recordset(${JSON.stringify(slots)}::jsonb)
      AS slot(overall integer, round integer, pick_in_round integer, team_id text)
  `;
  return draftId;
}

export async function advanceDraft(draftId: string, currentOverall: number, status: string, clockSeconds: number): Promise<void> {
  const sql = getSql();
  const total = int(rowsOf<Row>(await sql`SELECT COUNT(*)::int AS total FROM draft_slots WHERE draft_id = ${draftId}`)[0]?.total);
  if (currentOverall >= total) {
    await sql`
      UPDATE drafts SET status = 'COMPLETED', completed_at = now(), deadline_ts = NULL,
        paused_remaining_seconds = NULL, pause_reason = NULL WHERE id = ${draftId}
    `;
    return;
  }
  await sql`
    UPDATE drafts
    SET current_overall = ${currentOverall + 1},
        deadline_ts = CASE WHEN ${status} = 'LIVE' THEN now() + (${clockSeconds} * interval '1 second') ELSE NULL END,
        paused_remaining_seconds = NULL,
        pause_reason = NULL
    WHERE id = ${draftId}
  `;
}

export async function makePickInternal(draftId: string, teamId: string, playerId: string, allowPaused = false): Promise<boolean> {
  const sql = getSql();
  const inserted = rowsOf<Row>(await sql`
    INSERT INTO draft_picks
      (draft_id, overall, round, team_id, player_id, player_name, player_position, player_pro_team)
    SELECT d.id, d.current_overall, s.round, s.team_id, p.id, p.name, p.position, p.pro_team
    FROM drafts d
    JOIN draft_slots s ON s.draft_id = d.id AND s.overall = d.current_overall
    JOIN draft_players p ON p.id = ${playerId}
    WHERE d.id = ${draftId}
      AND (d.status = 'LIVE' OR (${allowPaused} AND d.status IN ('PAUSED','NOT_STARTED')))
      AND s.team_id = ${teamId}
      AND NOT EXISTS (SELECT 1 FROM draft_picks existing WHERE existing.draft_id = d.id AND existing.player_id = p.id)
    ON CONFLICT DO NOTHING
    RETURNING overall, round, player_id, player_name, player_position, player_pro_team
  `);
  if (!inserted.length) return false;

  const draft = rowsOf<Row>(await sql`SELECT status, clock_seconds FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];
  const pick = inserted[0];
  const overall = int(pick.overall);
  await sql`DELETE FROM draft_queues WHERE draft_id = ${draftId} AND player_id = ${playerId}`;
  await sql`
    INSERT INTO draft_roster_ownership
      (draft_id, player_id, owner_team_id, player_name, player_position, player_pro_team)
    VALUES (${draftId}, ${String(pick.player_id)}, ${teamId}, ${String(pick.player_name)}, ${String(pick.player_position)},
      ${pick.player_pro_team ? String(pick.player_pro_team) : null})
    ON CONFLICT (draft_id, player_id) DO UPDATE SET owner_team_id = EXCLUDED.owner_team_id,
      player_name = EXCLUDED.player_name, player_position = EXCLUDED.player_position,
      player_pro_team = EXCLUDED.player_pro_team, acquired_at = now()
  `;
  await advanceDraft(draftId, overall, String(draft.status), int(draft.clock_seconds, 120));
  const after = rowsOf<Row>(await sql`SELECT status FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];
  if (after && String(after.status) !== 'COMPLETED') {
    await sql`
      UPDATE drafts SET status = 'PAUSED', pause_reason = 'pick_animation', deadline_ts = NULL,
        paused_remaining_seconds = clock_seconds
      WHERE id = ${draftId}
    `;
  }
  return true;
}

export async function submitPick(teamId: string, playerId: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft || String(draft.status) !== 'LIVE') return false;
  const draftId = String(draft.id);
  const overall = int(draft.current_overall, 1);
  const slot = rowsOf<Row>(await sql`SELECT team_id FROM draft_slots WHERE draft_id = ${draftId} AND overall = ${overall} LIMIT 1`)[0];
  if (!slot || String(slot.team_id) !== teamId) return false;
  const existing = await getPendingPick(draftId);
  if (existing) return existing.teamId === teamId && existing.playerId === playerId && existing.overall === overall;
  const player = rowsOf<Row>(await sql`
    SELECT * FROM draft_players player
    WHERE player.id = ${playerId}
      AND NOT EXISTS (SELECT 1 FROM draft_picks pick WHERE pick.draft_id = ${draftId} AND pick.player_id = player.id)
    LIMIT 1
  `)[0];
  if (!player) return false;
  const remaining = draft.deadline_ts
    ? Math.max(1, Math.ceil((new Date(String(draft.deadline_ts)).getTime() - Date.now()) / 1000))
    : int(draft.clock_seconds, 120);
  const pendingId = randomUUID();
  const inserted = rowsOf<Row>(await sql`
    INSERT INTO draft_pending_picks
      (id, draft_id, overall, team_id, player_id, player_name, player_position, player_pro_team)
    VALUES (${pendingId}, ${draftId}, ${overall}, ${teamId}, ${playerId}, ${String(player.name)},
      ${String(player.position)}, ${player.pro_team ? String(player.pro_team) : null})
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  if (!inserted.length) return false;
  await sql`
    UPDATE drafts SET status = 'PAUSED', pause_reason = 'pending_pick',
      paused_remaining_seconds = ${remaining}, deadline_ts = NULL
    WHERE id = ${draftId} AND status = 'LIVE' AND current_overall = ${overall}
  `;
  return true;
}

export async function approvePendingPick(): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft) throw new Error('no_draft');
  const pending = await getPendingPick(String(draft.id));
  if (!pending) throw new Error('no_pending_pick');
  if (pending.overall !== int(draft.current_overall, 1)) throw new Error('stale_pending_pick');
  const ok = await makePickInternal(pending.draftId, pending.teamId, pending.playerId, true);
  if (!ok) throw new Error('pick_approval_failed');
  await sql`
    UPDATE draft_pending_picks SET status = 'approved', reviewed_at = now()
    WHERE id = ${pending.id} AND status = 'pending'
  `;
}

export async function rejectPendingPick(): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft) throw new Error('no_draft');
  const pending = await getPendingPick(String(draft.id));
  if (!pending) throw new Error('no_pending_pick');
  await sql`UPDATE draft_pending_picks SET status = 'rejected', reviewed_at = now() WHERE id = ${pending.id}`;
  await sql`
    UPDATE drafts SET status = 'LIVE', pause_reason = NULL,
      deadline_ts = now() + (GREATEST(1, COALESCE(paused_remaining_seconds, clock_seconds)) * interval '1 second'),
      paused_remaining_seconds = NULL
    WHERE id = ${pending.draftId} AND status = 'PAUSED' AND pause_reason = 'pending_pick'
  `;
}

export async function finishPickAnimation(): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft) return;
  await sql`
    UPDATE drafts SET status = 'LIVE', started_at = COALESCE(started_at, now()), pause_reason = NULL,
      deadline_ts = now() + (clock_seconds * interval '1 second'), paused_remaining_seconds = NULL
    WHERE id = ${String(draft.id)} AND status = 'PAUSED' AND pause_reason = 'pick_animation'
  `;
}

async function autoPickExpiredDraft(): Promise<void> {
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft || draft.status !== 'LIVE' || !draft.deadline_ts) return;
  if (new Date(String(draft.deadline_ts)).getTime() > Date.now()) return;

  const draftId = String(draft.id);
  const overall = int(draft.current_overall, 1);
  const slot = rowsOf<Row>(await sql`SELECT team_id FROM draft_slots WHERE draft_id = ${draftId} AND overall = ${overall} LIMIT 1`)[0];
  if (!slot) return;
  const teamId = String(slot.team_id);
  const queued = rowsOf<Row>(await sql`
    SELECT q.player_id
    FROM draft_queues q
    WHERE q.draft_id = ${draftId} AND q.team_id = ${teamId}
      AND NOT EXISTS (SELECT 1 FROM draft_picks p WHERE p.draft_id = ${draftId} AND p.player_id = q.player_id)
    ORDER BY q.rank LIMIT 1
  `)[0];
  const fallback = queued || rowsOf<Row>(await sql`
    SELECT p.id AS player_id FROM draft_players p
    WHERE NOT EXISTS (SELECT 1 FROM draft_picks dp WHERE dp.draft_id = ${draftId} AND dp.player_id = p.id)
    ORDER BY p.rank, p.name LIMIT 1
  `)[0];
  if (fallback) await makePickInternal(draftId, teamId, String(fallback.player_id));
  else await advanceDraft(draftId, overall, String(draft.status), int(draft.clock_seconds, 120));
}

export async function getDraftState(): Promise<DraftState> {
  await ensureSchema();
  await autoPickExpiredDraft();
  const sql = getSql();
  const settings = rowsOf<Row>(await sql`SELECT * FROM draft_settings WHERE id = 1 LIMIT 1`)[0];
  if (!settings) {
    return { configured: false, databaseConfigured: true, draft: null, teams: [], players: [], slots: [], picks: [], pendingPick: null, pendingTrades: [], currentTeam: null, availablePlayers: [] };
  }
  const teams = rowsOf<Row>(await sql`SELECT * FROM draft_teams ORDER BY sort_order`).map(mapTeam);
  const players = rowsOf<Row>(await sql`SELECT * FROM draft_players ORDER BY rank, name`).map(mapPlayer);
  const teamIds = teams.map((team) => team.id);
  const draftFormat = normalizeDraftFormat(settings.draft_format);
  const baseOrder = normalizeBaseOrder(settings.base_order, teamIds);
  const draftRow = await activeDraftRow();
  const base = {
    configured: true,
    databaseConfigured: true,
    leagueName: String(settings.league_name),
    branding: {
      primaryColor: String(settings.primary_color),
      secondaryColor: String(settings.secondary_color),
      logoUrl: eventLogoUrl(settings.logo_url),
    },
    settings: {
      rounds: int(settings.rounds, 28),
      clockSeconds: int(settings.clock_seconds, 120),
      draftFormat,
      baseOrder,
    },
    teams,
    players,
  };
  if (!draftRow) return { ...base, draft: null, slots: [], picks: [], pendingPick: null, pendingTrades: [], currentTeam: null, availablePlayers: players };

  const draft = {
    ...mapDraft(draftRow),
    pauseReason: draftRow.pause_reason ? String(draftRow.pause_reason) : null,
    pausedRemainingSeconds: draftRow.paused_remaining_seconds == null ? null : int(draftRow.paused_remaining_seconds),
  };
  const { slots, picks } = await loadDraftPieces(draft.id);
  const pendingPick = await getPendingPick(draft.id);
  const pickedIds = new Set(picks.map((pick) => pick.playerId));
  if (pendingPick) pickedIds.add(pendingPick.playerId);
  const currentSlot = slots.find((slot) => slot.overall === draft.currentOverall);
  return {
    ...base,
    draft,
    slots,
    picks,
    pendingPick,
    pendingTrades: await listModerationTrades(draft.id),
    currentTeam: currentSlot ? teams.find((team) => team.id === currentSlot.teamId) || null : null,
    availablePlayers: players.filter((player) => !pickedIds.has(player.id)),
  };
}

export async function listArchives(): Promise<ArchiveDraft[]> {
  await ensureSchema();
  const sql = getSql();
  const drafts = rowsOf<Row>(await sql`SELECT * FROM drafts ORDER BY created_at DESC`);
  const archives: ArchiveDraft[] = [];
  for (const row of drafts) {
    const draft = mapDraft(row);
    const pieces = await loadDraftPieces(draft.id);
    archives.push({ ...draft, ...pieces });
  }
  return archives;
}
