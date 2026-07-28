import { ensureSchema, getSql } from '../db';
import type { SetupPlayerInput } from '../types';
import { advanceDraft, createDraft, makePickInternal } from './draft';
import { activeDraftRow, int, normalizePlayers, rowsOf, type Row } from './shared';

export async function runAdminAction(action: string, body: Record<string, unknown>): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  let draft = await activeDraftRow();

  if (action === 'create') {
    await createDraft(String(body.name || `Draft ${new Date().getFullYear()}`));
    return;
  }
  if (action === 'update_branding') {
    await sql`
      UPDATE draft_settings SET
        league_name = ${String(body.leagueName || 'Draft League')},
        primary_color = ${String(body.primaryColor || '#2563eb')},
        secondary_color = ${String(body.secondaryColor || '#0f172a')},
        logo_url = ${body.logoUrl ? String(body.logoUrl) : null},
        updated_at = now()
      WHERE id = 1
    `;
    return;
  }
  if (!draft) throw new Error('no_draft');
  const draftId = String(draft.id);
  const clockSeconds = int(draft.clock_seconds, 120);

  if (action === 'start' || action === 'resume') {
    const remaining = int(draft.paused_remaining_seconds, clockSeconds);
    await sql`
      UPDATE drafts SET status = 'LIVE', started_at = COALESCE(started_at, now()), completed_at = NULL,
        deadline_ts = now() + (${Math.max(1, remaining)} * interval '1 second'), paused_remaining_seconds = NULL
      WHERE id = ${draftId} AND status <> 'COMPLETED'
    `;
    return;
  }
  if (action === 'pause') {
    await sql`
      UPDATE drafts SET status = 'PAUSED',
        paused_remaining_seconds = CASE
          WHEN deadline_ts IS NULL THEN clock_seconds
          ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (deadline_ts - now())))::int)
        END,
        deadline_ts = NULL
      WHERE id = ${draftId} AND status = 'LIVE'
    `;
    return;
  }
  if (action === 'reset') {
    await sql`DELETE FROM draft_picks WHERE draft_id = ${draftId}`;
    await sql`DELETE FROM draft_queues WHERE draft_id = ${draftId}`;
    await sql`
      UPDATE drafts SET status = 'NOT_STARTED', current_overall = 1, deadline_ts = NULL,
        paused_remaining_seconds = NULL, started_at = NULL, completed_at = NULL WHERE id = ${draftId}
    `;
    return;
  }
  if (action === 'undo') {
    const last = rowsOf<Row>(await sql`SELECT overall FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall DESC LIMIT 1`)[0];
    if (!last) return;
    const overall = int(last.overall);
    await sql`DELETE FROM draft_picks WHERE draft_id = ${draftId} AND overall = ${overall}`;
    await sql`
      UPDATE drafts SET current_overall = ${overall}, status = 'PAUSED', deadline_ts = NULL,
        paused_remaining_seconds = clock_seconds, completed_at = NULL WHERE id = ${draftId}
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
    await sql`
      UPDATE drafts SET clock_seconds = ${nextClock}, deadline_ts = NULL,
        paused_remaining_seconds = ${nextClock}, status = CASE WHEN status = 'LIVE' THEN 'PAUSED' ELSE status END
      WHERE id = ${draftId}
    `;
    return;
  }
  if (action === 'replace_players') {
    const pickCount = int(rowsOf<Row>(await sql`SELECT COUNT(*)::int AS total FROM draft_picks WHERE draft_id = ${draftId}`)[0]?.total);
    if (pickCount) throw new Error('cannot_replace_players_after_picks');
    const players = normalizePlayers(Array.isArray(body.players) ? body.players as SetupPlayerInput[] : []);
    await sql`DELETE FROM draft_queues`;
    await sql`DELETE FROM draft_players`;
    if (players.length) {
      await sql`
        INSERT INTO draft_players (id, name, position, pro_team, college, rank)
        SELECT id, name, position, pro_team, college, rank
        FROM jsonb_to_recordset(${JSON.stringify(players)}::jsonb)
          AS player(id text, name text, position text, pro_team text, college text, rank integer)
      `;
    }
    return;
  }
  if (action === 'force_pick') {
    draft = await activeDraftRow();
    if (!draft) throw new Error('no_draft');
    const overall = int(draft.current_overall, 1);
    const slot = rowsOf<Row>(await sql`SELECT team_id FROM draft_slots WHERE draft_id = ${draftId} AND overall = ${overall} LIMIT 1`)[0];
    if (!slot) throw new Error('no_slot');
    const ok = await makePickInternal(draftId, String(slot.team_id), String(body.playerId || ''), true);
    if (!ok) throw new Error('force_pick_failed');
    return;
  }
  throw new Error('unknown_action');
}
