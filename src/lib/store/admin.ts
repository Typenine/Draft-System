import { hashCode } from '../auth';
import { ensureSchema, getSql } from '../db';
import type { DraftFormat, SetupPlayerInput, SetupTeamInput } from '../types';
import { advanceDraft, createDraft, makePickInternal, normalizeBaseOrder, normalizeDraftFormat } from './draft';
import { activeDraftRow, int, normalizePlayers, rowsOf, type Row } from './shared';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function safeColor(value: unknown, fallback: string): string {
  const normalized = String(value || '').trim();
  return HEX_COLOR.test(normalized) ? normalized : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

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

  if (action === 'update_setup') {
    const currentTeams = rowsOf<Row>(await sql`SELECT id, primary_color, secondary_color FROM draft_teams ORDER BY sort_order`);
    const validTeamIds = currentTeams.map((team) => String(team.id));
    const validTeamSet = new Set(validTeamIds);
    const teams = Array.isArray(body.teams) ? body.teams as SetupTeamInput[] : [];
    if (teams.length !== validTeamIds.length || teams.length !== 12) throw new Error('exactly_12_teams_required');
    const incomingIds = teams.map((team) => String(team.id || ''));
    if (new Set(incomingIds).size !== validTeamIds.length || incomingIds.some((teamId) => !validTeamSet.has(teamId))) throw new Error('invalid_team_ids');

    const draftFormat: DraftFormat = normalizeDraftFormat(body.draftFormat);
    const baseOrder = normalizeBaseOrder(body.baseOrder, validTeamIds);
    if (baseOrder.length !== validTeamIds.length) throw new Error('invalid_base_order');
    const slotTeamIds = stringArray(body.slotTeamIds);
    const expectedSlotCount = int(draft.rounds, 28) * validTeamIds.length;
    if (slotTeamIds.length !== expectedSlotCount || slotTeamIds.some((teamId) => !validTeamSet.has(teamId))) throw new Error('invalid_draft_order');

    const nextClock = Math.max(10, int(body.clockSeconds, clockSeconds));
    const primaryColor = safeColor(body.primaryColor, '#2563eb');
    const secondaryColor = safeColor(body.secondaryColor, '#0f172a');
    const adminCode = String(body.adminCode || '').trim();
    if (adminCode) {
      await sql`
        UPDATE draft_settings SET league_name = ${String(body.leagueName || 'Draft League').trim() || 'Draft League'},
          admin_code_hash = ${hashCode(adminCode)}, primary_color = ${primaryColor}, secondary_color = ${secondaryColor},
          logo_url = ${body.logoUrl ? String(body.logoUrl) : null}, clock_seconds = ${nextClock},
          draft_format = ${draftFormat}, base_order = ${JSON.stringify(baseOrder)}::jsonb, updated_at = now()
        WHERE id = 1
      `;
    } else {
      await sql`
        UPDATE draft_settings SET league_name = ${String(body.leagueName || 'Draft League').trim() || 'Draft League'},
          primary_color = ${primaryColor}, secondary_color = ${secondaryColor},
          logo_url = ${body.logoUrl ? String(body.logoUrl) : null}, clock_seconds = ${nextClock},
          draft_format = ${draftFormat}, base_order = ${JSON.stringify(baseOrder)}::jsonb, updated_at = now()
        WHERE id = 1
      `;
    }

    const normalizedTeams = teams.map((team, index) => {
      if (!team.name?.trim() || !team.shortName?.trim()) throw new Error(`team_${index + 1}_incomplete`);
      const existing = currentTeams.find((item) => String(item.id) === String(team.id));
      return {
        id: String(team.id),
        name: team.name.trim(),
        short_name: team.shortName.trim().toUpperCase(),
        primary_color: safeColor(team.primaryColor, String(existing?.primary_color || '#2563eb')),
        secondary_color: safeColor(team.secondaryColor, String(existing?.secondary_color || '#0f172a')),
        logo_url: team.logoUrl || null,
        login_code_hash: team.loginCode?.trim() ? hashCode(team.loginCode) : null,
        sort_order: index,
      };
    });
    await sql`
      UPDATE draft_teams AS team SET
        name = incoming.name,
        short_name = incoming.short_name,
        primary_color = incoming.primary_color,
        secondary_color = incoming.secondary_color,
        logo_url = incoming.logo_url,
        login_code_hash = COALESCE(incoming.login_code_hash, team.login_code_hash),
        sort_order = incoming.sort_order
      FROM jsonb_to_recordset(${JSON.stringify(normalizedTeams)}::jsonb)
        AS incoming(id text, name text, short_name text, primary_color text, secondary_color text,
                    logo_url text, login_code_hash text, sort_order integer)
      WHERE team.id = incoming.id
    `;

    const slotUpdates = slotTeamIds.map((teamId, index) => ({ overall: index + 1, team_id: teamId }));
    await sql`
      UPDATE draft_slots AS slot SET team_id = incoming.team_id
      FROM jsonb_to_recordset(${JSON.stringify(slotUpdates)}::jsonb) AS incoming(overall integer, team_id text)
      WHERE slot.draft_id = ${draftId} AND slot.overall = incoming.overall
        AND NOT EXISTS (
          SELECT 1 FROM draft_picks pick WHERE pick.draft_id = slot.draft_id AND pick.overall = slot.overall
        )
    `;
    await sql`
      UPDATE drafts SET name = ${String(body.draftName || draft.name || 'Draft').trim() || 'Draft'},
        clock_seconds = ${nextClock}, deadline_ts = NULL,
        paused_remaining_seconds = ${nextClock},
        status = CASE WHEN status = 'LIVE' THEN 'PAUSED' ELSE status END
      WHERE id = ${draftId}
    `;
    return;
  }

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
