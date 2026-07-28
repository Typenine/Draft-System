import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { ensureDraftTables } from '@/server/db/queries';

export type DraftPauseReason =
  | 'manual'
  | 'pick_animation'
  | 'round_end'
  | 'trade_animation'
  | 'pending_pick'
  | null;

export type DraftPlayerInput = {
  playerId: string;
  playerName?: string | null;
  playerPos?: string | null;
  playerNfl?: string | null;
};

export type PendingPickRow = DraftPlayerInput & {
  id: string;
  draftId: string;
  overall: number;
  team: string;
  submittedAt: string;
  originPauseReason: DraftPauseReason;
  originRemainingSecs: number | null;
};

export type CommitForAnimationResult =
  | { ok: true; overall: number; round: number; team: string }
  | {
      ok: false;
      error:
        | 'no_slot'
        | 'wrong_state'
        | 'wrong_team'
        | 'player_taken'
        | 'slot_already_filled'
        | 'stale_request';
    };

export type GhostPendingRepairResult = { repaired: boolean };

let schemaPromise: Promise<void> | null = null;

export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] } | null | undefined)?.rows || [];
}

export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === 't' || value === 'true';
}

/**
 * Runtime verification is cached for the life of the server instance. Unlike the
 * previous route, it does not run ALTER TABLE / CREATE INDEX on every poll.
 * Conflicting data is reported and never deleted automatically.
 */
export async function ensureDraftSchemaV149(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getDb();
      const tableCheck = await db.execute(sql`
        SELECT to_regclass('public.drafts') AS drafts_table,
               to_regclass('public.draft_picks') AS picks_table,
               to_regclass('public.draft_pending_picks') AS pending_table
      `);
      const tables = rowsOf<{
        drafts_table: string | null;
        picks_table: string | null;
        pending_table: string | null;
      }>(tableCheck)[0];

      if (!tables?.drafts_table || !tables.picks_table || !tables.pending_table) {
        await ensureDraftTables();
      }

      const conflicts = await db.execute(sql`
        SELECT 'slot' AS conflict_type, draft_id::text AS draft_id,
               overall::text AS conflict_key, COUNT(*)::int AS conflict_count
        FROM draft_picks
        GROUP BY draft_id, overall
        HAVING COUNT(*) > 1
        UNION ALL
        SELECT 'player', draft_id::text, player_id, COUNT(*)::int
        FROM draft_picks
        GROUP BY draft_id, player_id
        HAVING COUNT(*) > 1
        UNION ALL
        SELECT 'pending', draft_id::text, overall::text, COUNT(*)::int
        FROM draft_pending_picks
        WHERE status = 'pending'
        GROUP BY draft_id, overall
        HAVING COUNT(*) > 1
      `);
      const conflictRows = rowsOf(conflicts);
      if (conflictRows.length) {
        console.error('[draft-v149] draft data conflicts require manual resolution', conflictRows);
        throw new Error('draft_data_conflict');
      }

      const active = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM drafts
        WHERE status IN ('LIVE', 'PAUSED')
      `);
      if (Number(rowsOf<{ count: number | string }>(active)[0]?.count || 0) > 1) {
        throw new Error('multiple_active_drafts');
      }

      await db.execute(sql`
        ALTER TABLE draft_pending_picks
        ADD COLUMN IF NOT EXISTS origin_pause_reason varchar(32) NULL
      `);
      await db.execute(sql`
        ALTER TABLE draft_pending_picks
        ADD COLUMN IF NOT EXISTS origin_remaining_secs integer NULL
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_drafts_single_active
        ON drafts ((1))
        WHERE status IN ('LIVE', 'PAUSED')
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_draft_picks_draft_overall
        ON draft_picks(draft_id, overall)
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_draft_picks_draft_player
        ON draft_picks(draft_id, player_id)
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_picks_draft_overall
        ON draft_pending_picks(draft_id, overall)
        WHERE status = 'pending'
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function getPendingPickV149(draftId: string): Promise<PendingPickRow | null> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT pp.id::text AS id,
           pp.draft_id::text AS draft_id,
           pp.overall,
           pp.team,
           pp.player_id,
           pp.player_name,
           pp.player_pos,
           pp.player_nfl,
           pp.submitted_at,
           pp.origin_pause_reason,
           pp.origin_remaining_secs
    FROM draft_pending_picks pp
    JOIN drafts d ON d.id = pp.draft_id AND d.cur_overall = pp.overall
    WHERE pp.draft_id = ${draftId}::uuid
      AND pp.status = 'pending'
    ORDER BY pp.submitted_at ASC
    LIMIT 1
  `);
  const row = rowsOf<{
    id: string;
    draft_id: string;
    overall: number | string;
    team: string;
    player_id: string;
    player_name: string | null;
    player_pos: string | null;
    player_nfl: string | null;
    submitted_at: Date | string;
    origin_pause_reason: DraftPauseReason;
    origin_remaining_secs: number | null;
  }>(result)[0];
  if (!row) return null;
  return {
    id: row.id,
    draftId: row.draft_id,
    overall: Number(row.overall),
    team: row.team,
    playerId: row.player_id,
    playerName: row.player_name,
    playerPos: row.player_pos,
    playerNfl: row.player_nfl,
    submittedAt: new Date(row.submitted_at).toISOString(),
    originPauseReason: row.origin_pause_reason || null,
    originRemainingSecs: row.origin_remaining_secs == null ? null : Number(row.origin_remaining_secs),
  };
}

/**
 * Repairs a ghost pending-pick pause: the draft says it is paused for a pending
 * pick, but there is no current pending pick row matching the draft cursor.
 * This can strand admin controls in conflicting states. The repair converts the
 * pause to a normal manual pause and rejects stale pending rows from old slots.
 */
export async function repairGhostPendingPickPauseV149(
  draftId: string,
): Promise<GhostPendingRepairResult> {
  const db = getDb();
  const result = await db.execute(sql`
    WITH state AS (
      SELECT id, cur_overall
      FROM drafts
      WHERE id = ${draftId}::uuid
        AND status = 'PAUSED'
        AND pause_reason = 'pending_pick'
      FOR UPDATE
    ), current_pending AS (
      SELECT pp.id
      FROM draft_pending_picks pp
      JOIN state ON state.id = pp.draft_id
      WHERE pp.status = 'pending'
        AND pp.overall = state.cur_overall
      LIMIT 1
    ), stale_pending AS (
      UPDATE draft_pending_picks pp
      SET status = 'rejected'
      FROM state
      WHERE pp.draft_id = state.id
        AND pp.status = 'pending'
        AND pp.overall <> state.cur_overall
      RETURNING pp.id
    ), repaired AS (
      UPDATE drafts d
      SET pause_reason = 'manual',
          paused_remaining_secs = COALESCE(d.paused_remaining_secs, d.clock_seconds, 60),
          clock_started_at = NULL,
          deadline_ts = NULL
      FROM state
      WHERE d.id = state.id
        AND NOT EXISTS (SELECT 1 FROM current_pending)
      RETURNING d.id
    )
    SELECT EXISTS(SELECT 1 FROM repaired) AS repaired
  `);
  const row = rowsOf<{ repaired: boolean | string | number }>(result)[0];
  return { repaired: bool(row?.repaired) };
}

export async function submitPendingPickV149(params: {
  draftId: string;
  overall: number;
  team: string;
} & DraftPlayerInput): Promise<
  | { ok: true; pending: PendingPickRow; duplicate: boolean }
  | { ok: false; error: 'wrong_state' | 'wrong_team' | 'stale_request' | 'pick_already_pending' }
> {
  const db = getDb();
  const id = randomUUID();
  const result = await db.execute(sql`
    WITH state AS (
      SELECT d.id,
             d.status,
             d.pause_reason,
             d.cur_overall,
             d.paused_remaining_secs,
             d.deadline_ts,
             s.team AS slot_team
      FROM drafts d
      JOIN draft_slots s
        ON s.draft_id = d.id
       AND s.overall = d.cur_overall
      WHERE d.id = ${params.draftId}::uuid
      FOR UPDATE OF d
    ), stale_pending AS (
      UPDATE draft_pending_picks pp
      SET status = 'rejected'
      FROM state
      WHERE pp.draft_id = state.id
        AND pp.status = 'pending'
        AND pp.overall <> state.cur_overall
      RETURNING pp.id
    ), inserted AS (
      INSERT INTO draft_pending_picks
        (id, draft_id, overall, team, player_id, player_name, player_pos,
         player_nfl, submitted_at, status, origin_pause_reason, origin_remaining_secs)
      SELECT ${id}::uuid,
             ${params.draftId}::uuid,
             state.cur_overall,
             state.slot_team,
             ${params.playerId},
             ${params.playerName ?? null},
             ${params.playerPos ?? null},
             ${params.playerNfl ?? null},
             now(),
             'pending',
             CASE WHEN state.status = 'PAUSED' THEN state.pause_reason ELSE NULL END,
             CASE
               WHEN state.status = 'LIVE'
                 THEN GREATEST(0, EXTRACT(EPOCH FROM (state.deadline_ts - now()))::int)
               ELSE state.paused_remaining_secs
             END
      FROM state
      CROSS JOIN (SELECT COUNT(*) AS ignored FROM stale_pending) cleanup
      WHERE state.cur_overall = ${params.overall}
        AND state.slot_team = ${params.team}
        AND (
          state.status = 'LIVE'
          OR (state.status = 'PAUSED' AND state.pause_reason = 'manual')
        )
      ON CONFLICT DO NOTHING
      RETURNING id::text AS id
    ), paused AS (
      UPDATE drafts d
      SET status = 'PAUSED',
          pause_reason = 'pending_pick',
          paused_remaining_secs = GREATEST(0, EXTRACT(EPOCH FROM (d.deadline_ts - now()))::int),
          clock_started_at = NULL,
          deadline_ts = NULL
      WHERE d.id = ${params.draftId}::uuid
        AND d.status = 'LIVE'
        AND EXISTS (SELECT 1 FROM inserted)
      RETURNING d.id
    )
    SELECT state.status,
           state.pause_reason,
           state.cur_overall,
           state.slot_team,
           EXISTS(SELECT 1 FROM inserted) AS inserted
    FROM state
  `);

  const state = rowsOf<{
    status: string;
    pause_reason: DraftPauseReason;
    cur_overall: number | string;
    slot_team: string;
    inserted: boolean | string | number;
  }>(result)[0];
  if (!state) return { ok: false, error: 'stale_request' };

  if (!bool(state.inserted)) {
    const existing = await getPendingPickV149(params.draftId);
    if (existing) {
      const exact =
        existing.overall === params.overall &&
        existing.team === params.team &&
        existing.playerId === params.playerId;
      if (exact) return { ok: true, pending: existing, duplicate: true };
      return { ok: false, error: 'pick_already_pending' };
    }
    if (Number(state.cur_overall) !== params.overall) return { ok: false, error: 'stale_request' };
    if (state.slot_team !== params.team) return { ok: false, error: 'wrong_team' };
    return { ok: false, error: 'wrong_state' };
  }

  const pending = await getPendingPickV149(params.draftId);
  if (!pending) return { ok: false, error: 'stale_request' };
  return { ok: true, pending, duplicate: false };
}

export async function rejectPendingPickV149(pending: PendingPickRow): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    UPDATE draft_pending_picks
    SET status = 'rejected'
    WHERE id = ${pending.id}::uuid
      AND status = 'pending'
  `);

  if (pending.originPauseReason === 'manual') {
    await db.execute(sql`
      UPDATE drafts
      SET status = 'PAUSED',
          pause_reason = 'manual',
          paused_remaining_secs = COALESCE(${pending.originRemainingSecs}, paused_remaining_secs, clock_seconds),
          clock_started_at = NULL,
          deadline_ts = NULL
      WHERE id = ${pending.draftId}::uuid
        AND cur_overall = ${pending.overall}
    `);
    return;
  }

  await db.execute(sql`
    UPDATE drafts
    SET status = 'LIVE',
        pause_reason = NULL,
        round_end_pause = false,
        clock_started_at = now(),
        deadline_ts = now() + (interval '1 second' * COALESCE(${pending.originRemainingSecs}, clock_seconds, 60)),
        paused_remaining_secs = NULL
    WHERE id = ${pending.draftId}::uuid
      AND cur_overall = ${pending.overall}
      AND status = 'PAUSED'
      AND pause_reason = 'pending_pick'
  `);
}

export async function resolvePendingApprovedV149(pendingId: string): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    UPDATE draft_pending_picks
    SET status = 'approved'
    WHERE id = ${pendingId}::uuid
      AND status = 'pending'
  `);
}
