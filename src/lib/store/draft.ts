import { randomUUID } from 'crypto';
import { ensureSchema, getSql } from '../db';
import type { ArchiveDraft, DraftFormat, DraftState } from '../types';
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
        paused_remaining_seconds = NULL WHERE id = ${draftId}
    `;
    return;
  }
  await sql`
    UPDATE drafts
    SET current_overall = ${currentOverall + 1},
        deadline_ts = CASE WHEN ${status} = 'LIVE' THEN now() + (${clockSeconds} * interval '1 second') ELSE NULL END,
        paused_remaining_seconds = NULL
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
    RETURNING overall
  `);
  if (!inserted.length) return false;

  const draft = rowsOf<Row>(await sql`SELECT status, clock_seconds FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];
  const overall = int(inserted[0].overall);
  await sql`DELETE FROM draft_queues WHERE draft_id = ${draftId} AND player_id = ${playerId}`;
  await advanceDraft(draftId, overall, String(draft.status), int(draft.clock_seconds, 120));
  return true;
}

export async function submitPick(teamId: string, playerId: string): Promise<boolean> {
  await ensureSchema();
  const draft = await activeDraftRow();
  return draft ? makePickInternal(String(draft.id), teamId, playerId) : false;
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
    return { configured: false, databaseConfigured: true, draft: null, teams: [], players: [], slots: [], picks: [], currentTeam: null, availablePlayers: [] };
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
      logoUrl: settings.logo_url ? String(settings.logo_url) : null,
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
  if (!draftRow) return { ...base, draft: null, slots: [], picks: [], currentTeam: null, availablePlayers: players };

  const draft = mapDraft(draftRow);
  const { slots, picks } = await loadDraftPieces(draft.id);
  const pickedIds = new Set(picks.map((pick) => pick.playerId));
  const currentSlot = slots.find((slot) => slot.overall === draft.currentOverall);
  return {
    ...base,
    draft,
    slots,
    picks,
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
