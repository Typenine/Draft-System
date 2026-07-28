import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { addPlayerToRosterSnapshot, removePlayerFromQueue } from '@/server/db/queries';
import {
  bool,
  rowsOf,
  type CommitForAnimationResult,
  type DraftPauseReason,
  type DraftPlayerInput,
} from './core';

/**
 * Records the current pick and enters the animation state. The draft cursor does
 * not advance here. No next team is on the clock until advanceAfterPickAnimationV149.
 */
export async function commitCurrentPickForAnimationV149(params: {
  draftId: string;
  team: string;
  expectedOverall?: number | null;
  madeBy: string;
  allowPaused?: boolean;
  pendingId?: string | null;
} & DraftPlayerInput): Promise<CommitForAnimationResult> {
  const db = getDb();
  const pickId = randomUUID();
  const expectedOverall = params.expectedOverall ?? null;
  const allowPaused = params.allowPaused === true;
  const result = await db.execute(sql`
    WITH state AS (
      SELECT d.id,
             d.status,
             d.pause_reason,
             d.cur_overall,
             s.overall AS slot_overall,
             s.round AS slot_round,
             s.team AS slot_team,
             EXISTS (
               SELECT 1 FROM draft_picks p
               WHERE p.draft_id = d.id AND p.player_id = ${params.playerId}
             ) AS player_taken,
             EXISTS (
               SELECT 1 FROM draft_picks p
               WHERE p.draft_id = d.id AND p.overall = d.cur_overall
             ) AS slot_filled
      FROM drafts d
      JOIN draft_slots s
        ON s.draft_id = d.id
       AND s.overall = d.cur_overall
      WHERE d.id = ${params.draftId}::uuid
      FOR UPDATE OF d
    ), inserted AS (
      INSERT INTO draft_picks
        (id, draft_id, overall, round, team, player_id, player_name,
         player_pos, player_nfl, made_by, made_at)
      SELECT ${pickId}::uuid,
             ${params.draftId}::uuid,
             state.slot_overall,
             state.slot_round,
             state.slot_team,
             ${params.playerId},
             ${params.playerName ?? null},
             ${params.playerPos ?? null},
             ${params.playerNfl ?? null},
             ${params.madeBy},
             now()
      FROM state
      WHERE state.slot_team = ${params.team}
        AND NOT state.player_taken
        AND NOT state.slot_filled
        AND (${expectedOverall}::int IS NULL OR state.cur_overall = ${expectedOverall}::int)
        AND (
          ${params.pendingId ?? null}::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM draft_pending_picks pp
            WHERE pp.id = ${params.pendingId ?? null}::uuid
              AND pp.draft_id = state.id
              AND pp.overall = state.cur_overall
              AND pp.team = state.slot_team
              AND pp.player_id = ${params.playerId}
              AND pp.status = 'pending'
          )
        )
        AND (
          state.status = 'LIVE'
          OR (
            ${allowPaused}::boolean
            AND state.status = 'PAUSED'
            AND state.pause_reason IN ('pending_pick', 'manual')
          )
        )
      ON CONFLICT DO NOTHING
      RETURNING overall, round, team
    ), resolved_pending AS (
      UPDATE draft_pending_picks pp
      SET status = 'approved'
      WHERE pp.id = ${params.pendingId ?? null}::uuid
        AND pp.status = 'pending'
        AND EXISTS (SELECT 1 FROM inserted)
      RETURNING pp.id
    ), animation_state AS (
      UPDATE drafts d
      SET status = 'PAUSED',
          pause_reason = 'pick_animation',
          round_end_pause = false,
          paused_remaining_secs = d.clock_seconds,
          clock_started_at = NULL,
          deadline_ts = NULL,
          completed_at = NULL
      WHERE d.id = ${params.draftId}::uuid
        AND EXISTS (SELECT 1 FROM inserted)
      RETURNING d.id
    )
    SELECT state.status AS initial_status,
           state.pause_reason AS initial_pause_reason,
           state.cur_overall,
           state.slot_team,
           state.player_taken,
           state.slot_filled,
           EXISTS(SELECT 1 FROM inserted) AS inserted,
           (SELECT overall FROM inserted LIMIT 1) AS inserted_overall,
           (SELECT round FROM inserted LIMIT 1) AS inserted_round,
           (SELECT team FROM inserted LIMIT 1) AS inserted_team
    FROM state
  `);

  const row = rowsOf<{
    initial_status: string;
    initial_pause_reason: DraftPauseReason;
    cur_overall: number | string;
    slot_team: string;
    player_taken: boolean | string | number;
    slot_filled: boolean | string | number;
    inserted: boolean | string | number;
    inserted_overall: number | string | null;
    inserted_round: number | string | null;
    inserted_team: string | null;
  }>(result)[0];

  if (!row) return { ok: false, error: 'no_slot' };
  if (!bool(row.inserted)) {
    if (expectedOverall !== null && Number(row.cur_overall) !== expectedOverall) {
      return { ok: false, error: 'stale_request' };
    }
    if (row.slot_team !== params.team) return { ok: false, error: 'wrong_team' };
    if (bool(row.player_taken)) return { ok: false, error: 'player_taken' };
    if (bool(row.slot_filled)) return { ok: false, error: 'slot_already_filled' };
    const allowedState =
      row.initial_status === 'LIVE' ||
      (allowPaused &&
        row.initial_status === 'PAUSED' &&
        (row.initial_pause_reason === 'pending_pick' || row.initial_pause_reason === 'manual'));
    if (!allowedState) return { ok: false, error: 'wrong_state' };
    return { ok: false, error: 'stale_request' };
  }

  return {
    ok: true,
    overall: Number(row.inserted_overall),
    round: Number(row.inserted_round),
    team: row.inserted_team || params.team,
  };
}

export async function advanceAfterPickAnimationV149(draftId: string): Promise<
  | { ok: true; status: 'LIVE' | 'PAUSED' | 'COMPLETED'; curOverall: number; roundEnd: boolean }
  | { ok: false; error: 'not_in_pick_animation' | 'current_pick_missing' }
> {
  const db = getDb();
  const result = await db.execute(sql`
    WITH state AS (
      SELECT d.id,
             d.cur_overall,
             d.clock_seconds,
             p.round AS picked_round
      FROM drafts d
      LEFT JOIN draft_picks p
        ON p.draft_id = d.id
       AND p.overall = d.cur_overall
      WHERE d.id = ${draftId}::uuid
        AND d.status = 'PAUSED'
        AND d.pause_reason = 'pick_animation'
      FOR UPDATE OF d
    ), next_slot AS (
      SELECT s.overall, s.round
      FROM draft_slots s, state
      WHERE s.draft_id = state.id
        AND s.overall > state.cur_overall
        AND NOT EXISTS (
          SELECT 1 FROM draft_picks p
          WHERE p.draft_id = s.draft_id
            AND p.overall = s.overall
        )
      ORDER BY s.overall ASC
      LIMIT 1
    ), updated AS (
      UPDATE drafts d
      SET cur_overall = COALESCE((SELECT overall FROM next_slot), d.cur_overall),
          status = CASE
            WHEN NOT EXISTS (SELECT 1 FROM next_slot) THEN 'COMPLETED'
            WHEN (SELECT round FROM next_slot) > (SELECT picked_round FROM state) THEN 'PAUSED'
            ELSE 'LIVE'
          END,
          pause_reason = CASE
            WHEN NOT EXISTS (SELECT 1 FROM next_slot) THEN NULL
            WHEN (SELECT round FROM next_slot) > (SELECT picked_round FROM state) THEN 'round_end'
            ELSE NULL
          END,
          round_end_pause = CASE
            WHEN EXISTS (SELECT 1 FROM next_slot)
             AND (SELECT round FROM next_slot) > (SELECT picked_round FROM state)
              THEN true
            ELSE false
          END,
          paused_remaining_secs = CASE
            WHEN EXISTS (SELECT 1 FROM next_slot)
             AND (SELECT round FROM next_slot) > (SELECT picked_round FROM state)
              THEN (SELECT clock_seconds FROM state)
            ELSE NULL
          END,
          clock_started_at = CASE
            WHEN EXISTS (SELECT 1 FROM next_slot)
             AND (SELECT round FROM next_slot) = (SELECT picked_round FROM state)
              THEN now()
            ELSE NULL
          END,
          deadline_ts = CASE
            WHEN EXISTS (SELECT 1 FROM next_slot)
             AND (SELECT round FROM next_slot) = (SELECT picked_round FROM state)
              THEN now() + (interval '1 second' * (SELECT clock_seconds FROM state))
            ELSE NULL
          END,
          completed_at = CASE
            WHEN NOT EXISTS (SELECT 1 FROM next_slot) THEN now()
            ELSE NULL
          END
      FROM state
      WHERE d.id = state.id
        AND state.picked_round IS NOT NULL
      RETURNING d.status, d.cur_overall, d.round_end_pause
    )
    SELECT
      EXISTS(SELECT 1 FROM state) AS found_state,
      (SELECT picked_round FROM state LIMIT 1) AS picked_round,
      (SELECT status FROM updated LIMIT 1) AS status,
      (SELECT cur_overall FROM updated LIMIT 1) AS cur_overall,
      (SELECT round_end_pause FROM updated LIMIT 1) AS round_end_pause
  `);

  const row = rowsOf<{
    found_state: boolean | string | number;
    picked_round: number | string | null;
    status: 'LIVE' | 'PAUSED' | 'COMPLETED' | null;
    cur_overall: number | string | null;
    round_end_pause: boolean | string | number | null;
  }>(result)[0];
  if (!row || !bool(row.found_state)) return { ok: false, error: 'not_in_pick_animation' };
  if (row.picked_round == null || !row.status || row.cur_overall == null) {
    return { ok: false, error: 'current_pick_missing' };
  }
  return {
    ok: true,
    status: row.status,
    curOverall: Number(row.cur_overall),
    roundEnd: bool(row.round_end_pause),
  };
}

export async function finishTradeAnimationV149(draftId: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(sql`
    UPDATE drafts
    SET status = 'LIVE',
        pause_reason = NULL,
        round_end_pause = false,
        paused_remaining_secs = NULL,
        clock_started_at = now(),
        deadline_ts = now() + (interval '1 second' * clock_seconds),
        pending_trade_animation = NULL
    WHERE id = ${draftId}::uuid
      AND status = 'PAUSED'
      AND pause_reason = 'trade_animation'
    RETURNING id
  `);
  return rowsOf(result).length > 0;
}

/**
 * A trade animation normally runs for about 37 seconds. If every open client
 * misses or fails to complete the event, release the pause after 75 seconds so
 * the draft cannot remain stranded indefinitely.
 */
export async function checkStaleTradeAnimationV149(
  draftId: string,
  maxSeconds = 75,
): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT id
    FROM drafts
    WHERE id = ${draftId}::uuid
      AND status = 'PAUSED'
      AND pause_reason = 'trade_animation'
      AND (pending_trade_animation->>'startedAt')::timestamptz
            < now() - (interval '1 second' * ${maxSeconds})
    LIMIT 1
  `);
  if (!rowsOf(result).length) return false;
  return finishTradeAnimationV149(draftId);
}

export async function checkStalePickAnimationV149(
  draftId: string,
  maxSeconds = 45,
): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT d.id
    FROM drafts d
    JOIN draft_picks p
      ON p.draft_id = d.id
     AND p.overall = d.cur_overall
    WHERE d.id = ${draftId}::uuid
      AND d.status = 'PAUSED'
      AND d.pause_reason = 'pick_animation'
      AND p.made_at < now() - (interval '1 second' * ${maxSeconds})
    LIMIT 1
  `);
  if (!rowsOf(result).length) return false;
  const advanced = await advanceAfterPickAnimationV149(draftId);
  return advanced.ok;
}

export async function cleanupCommittedPickV149(params: {
  draftId: string;
  team: string;
} & DraftPlayerInput): Promise<string[]> {
  const results = await Promise.allSettled([
    addPlayerToRosterSnapshot(
      params.draftId,
      params.team,
      {
        playerId: params.playerId,
        playerName: params.playerName ?? null,
        playerPos: params.playerPos ?? null,
        playerNfl: params.playerNfl ?? null,
      },
      'drafted',
    ),
    removePlayerFromQueue(params.draftId, params.team, params.playerId),
  ]);
  const warnings: string[] = [];
  if (results[0].status === 'rejected') warnings.push('roster_snapshot_sync_failed');
  if (results[1].status === 'rejected') warnings.push('queue_cleanup_failed');
  if (warnings.length) console.error('[draft-v149] post-pick cleanup warnings', warnings);
  return warnings;
}
