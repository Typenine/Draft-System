import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { bool, rowsOf } from './core';

export async function safeSkipPickV149(
  draftId: string,
  allowManual: boolean,
): Promise<{ ok: true; newOverall: number; roundEnd: boolean } | { ok: false; error: string }> {
  const db = getDb();
  const result = await db.execute(sql`
    WITH state AS (
      SELECT d.id, d.cur_overall, d.clock_seconds, s.round AS current_round
      FROM drafts d
      JOIN draft_slots s
        ON s.draft_id = d.id
       AND s.overall = d.cur_overall
      WHERE d.id = ${draftId}::uuid
        AND (
          d.status = 'LIVE'
          OR (${allowManual}::boolean AND d.status = 'PAUSED' AND d.pause_reason = 'manual')
        )
        AND NOT EXISTS (
          SELECT 1 FROM draft_pending_picks pp
          WHERE pp.draft_id = d.id AND pp.status = 'pending'
        )
      FOR UPDATE OF d
    ), next_slot AS (
      SELECT s.overall, s.round
      FROM draft_slots s, state
      WHERE s.draft_id = state.id
        AND s.overall > state.cur_overall
        AND NOT EXISTS (
          SELECT 1 FROM draft_picks p
          WHERE p.draft_id = s.draft_id AND p.overall = s.overall
        )
      ORDER BY s.overall
      LIMIT 1
    ), updated AS (
      UPDATE drafts d
      SET cur_overall = COALESCE((SELECT overall FROM next_slot), d.cur_overall),
          status = CASE
            WHEN NOT EXISTS (SELECT 1 FROM next_slot) THEN 'COMPLETED'
            WHEN (SELECT round FROM next_slot) > (SELECT current_round FROM state) THEN 'PAUSED'
            ELSE 'LIVE'
          END,
          pause_reason = CASE
            WHEN NOT EXISTS (SELECT 1 FROM next_slot) THEN NULL
            WHEN (SELECT round FROM next_slot) > (SELECT current_round FROM state) THEN 'round_end'
            ELSE NULL
          END,
          round_end_pause = CASE
            WHEN EXISTS (SELECT 1 FROM next_slot)
             AND (SELECT round FROM next_slot) > (SELECT current_round FROM state) THEN true
            ELSE false
          END,
          paused_remaining_secs = CASE
            WHEN EXISTS (SELECT 1 FROM next_slot)
             AND (SELECT round FROM next_slot) > (SELECT current_round FROM state)
              THEN (SELECT clock_seconds FROM state)
            ELSE NULL
          END,
          clock_started_at = CASE
            WHEN EXISTS (SELECT 1 FROM next_slot)
             AND (SELECT round FROM next_slot) = (SELECT current_round FROM state) THEN now()
            ELSE NULL
          END,
          deadline_ts = CASE
            WHEN EXISTS (SELECT 1 FROM next_slot)
             AND (SELECT round FROM next_slot) = (SELECT current_round FROM state)
              THEN now() + (interval '1 second' * (SELECT clock_seconds FROM state))
            ELSE NULL
          END,
          completed_at = CASE WHEN NOT EXISTS (SELECT 1 FROM next_slot) THEN now() ELSE NULL END
      FROM state
      WHERE d.id = state.id
      RETURNING d.cur_overall, d.round_end_pause
    )
    SELECT cur_overall, round_end_pause FROM updated
  `);
  const row = rowsOf<{ cur_overall: number | string; round_end_pause: unknown }>(result)[0];
  if (!row) return { ok: false, error: 'invalid_state' };
  return { ok: true, newOverall: Number(row.cur_overall), roundEnd: bool(row.round_end_pause) };
}

export async function safeUpdateSlotV149(
  draftId: string,
  overall: number,
  team: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const result = await db.execute(sql`
    UPDATE draft_slots s
    SET team = ${team}
    WHERE s.draft_id = ${draftId}::uuid
      AND s.overall = ${overall}
      AND NOT EXISTS (
        SELECT 1 FROM draft_picks p
        WHERE p.draft_id = s.draft_id AND p.overall = s.overall
      )
      AND NOT EXISTS (
        SELECT 1
        FROM drafts d
        JOIN draft_pending_picks pp
          ON pp.draft_id = d.id
         AND pp.status = 'pending'
        WHERE d.id = s.draft_id
          AND d.cur_overall = s.overall
      )
    RETURNING s.overall
  `);
  if (rowsOf(result).length) return { ok: true };

  const exists = await db.execute(sql`
    SELECT 1 FROM draft_slots
    WHERE draft_id = ${draftId}::uuid AND overall = ${overall}
  `);
  if (!rowsOf(exists).length) return { ok: false, error: 'invalid_slot' };
  return { ok: false, error: 'slot_locked' };
}
