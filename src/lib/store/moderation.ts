import { ensureSchema, getSql } from '../db';
import type { ModerationTrade, TradeAsset } from '../types';
import { activeDraftRow, int, rowsOf, type Row } from './shared';

function stringList(value: unknown): string[] {
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

function mapAsset(row: Row): TradeAsset {
  return {
    id: String(row.id),
    fromTeam: String(row.from_team),
    toTeam: String(row.to_team),
    assetType: String(row.asset_type),
    playerId: row.player_id ? String(row.player_id) : null,
    playerName: row.player_name ? String(row.player_name) : null,
    playerPosition: row.player_pos ? String(row.player_pos) : null,
    pickOverall: row.pick_overall == null ? null : int(row.pick_overall),
    pickYear: row.pick_year == null ? null : int(row.pick_year),
    pickRound: row.pick_round == null ? null : int(row.pick_round),
    pickOriginalTeam: row.pick_original_team ? String(row.pick_original_team) : null,
  };
}

export async function listModerationTrades(draftId?: string | null): Promise<ModerationTrade[]> {
  await ensureSchema();
  const sql = getSql();
  const id = draftId || String((await activeDraftRow())?.id || '');
  if (!id) return [];
  const trades = rowsOf<Row>(await sql`
    SELECT * FROM draft_trades
    WHERE draft_id = ${id} AND status IN ('pending', 'accepted')
    ORDER BY CASE WHEN status = 'accepted' THEN 0 ELSE 1 END, updated_at DESC
  `);
  const result: ModerationTrade[] = [];
  for (const trade of trades) {
    const tradeId = String(trade.id);
    result.push({
      id: tradeId,
      draftId: String(trade.draft_id),
      status: String(trade.status),
      proposedBy: String(trade.proposed_by),
      teams: stringList(trade.teams),
      acceptedBy: stringList(trade.accepted_by),
      notes: trade.notes ? String(trade.notes) : null,
      proposedAt: new Date(String(trade.proposed_at)).toISOString(),
      updatedAt: new Date(String(trade.updated_at)).toISOString(),
      assets: rowsOf<Row>(await sql`SELECT * FROM draft_trade_assets WHERE trade_id = ${tradeId} ORDER BY id`).map(mapAsset),
    });
  }
  return result;
}

export async function approveTrade(tradeId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const trade = rowsOf<Row>(await sql`SELECT * FROM draft_trades WHERE id = ${tradeId} LIMIT 1`)[0];
  if (!trade) throw new Error('trade_not_found');
  if (String(trade.status) !== 'accepted') throw new Error('trade_not_fully_accepted');
  const teams = stringList(trade.teams);
  const accepted = new Set(stringList(trade.accepted_by));
  if (!teams.length || teams.some((team) => !accepted.has(team))) throw new Error('trade_not_fully_accepted');

  const draftId = String(trade.draft_id);
  const draft = rowsOf<Row>(await sql`SELECT * FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];
  if (!draft) throw new Error('no_draft');
  const teamRows = rowsOf<Row>(await sql`SELECT id, name FROM draft_teams`);
  const teamByName = new Map(teamRows.map((team) => [String(team.name), String(team.id)]));
  const assets = rowsOf<Row>(await sql`SELECT * FROM draft_trade_assets WHERE trade_id = ${tradeId}`);

  for (const asset of assets) {
    const fromTeamId = teamByName.get(String(asset.from_team));
    const toTeamId = teamByName.get(String(asset.to_team));
    if (!fromTeamId || !toTeamId) throw new Error('trade_team_not_found');
    const assetType = String(asset.asset_type);
    if (assetType === 'current_pick') {
      const overall = int(asset.pick_overall);
      if (!overall) throw new Error('invalid_trade_pick');
      const changed = rowsOf<Row>(await sql`
        UPDATE draft_slots SET team_id = ${toTeamId}
        WHERE draft_id = ${draftId} AND overall = ${overall} AND team_id = ${fromTeamId}
          AND NOT EXISTS (SELECT 1 FROM draft_picks WHERE draft_id = ${draftId} AND overall = ${overall})
        RETURNING overall
      `);
      if (!changed.length) throw new Error('trade_pick_unavailable');
    } else if (assetType === 'player') {
      const playerId = String(asset.player_id || '');
      const changed = rowsOf<Row>(await sql`
        UPDATE draft_roster_ownership SET owner_team_id = ${toTeamId}, acquired_at = now()
        WHERE draft_id = ${draftId} AND player_id = ${playerId} AND owner_team_id = ${fromTeamId}
        RETURNING player_id
      `);
      if (!changed.length) throw new Error('trade_player_unavailable');
    } else if (assetType === 'future_pick') {
      const year = int(asset.pick_year);
      const round = int(asset.pick_round);
      const originalTeamId = teamByName.get(String(asset.pick_original_team || asset.from_team));
      if (!year || !round || !originalTeamId) throw new Error('invalid_future_pick');
      const changed = rowsOf<Row>(await sql`
        UPDATE draft_future_picks SET owner_team_id = ${toTeamId}
        WHERE draft_id = ${draftId} AND pick_year = ${year} AND pick_round = ${round}
          AND original_team_id = ${originalTeamId} AND owner_team_id = ${fromTeamId}
        RETURNING id
      `);
      if (!changed.length) throw new Error('future_pick_unavailable');
    } else {
      throw new Error('unsupported_trade_asset');
    }
  }

  const resumeAfterAnimation = String(draft.status) === 'LIVE';
  if (resumeAfterAnimation) {
    await sql`
      UPDATE drafts SET status = 'PAUSED', pause_reason = 'trade_animation',
        paused_remaining_seconds = CASE WHEN deadline_ts IS NULL THEN clock_seconds ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (deadline_ts - now())))::int) END,
        deadline_ts = NULL
      WHERE id = ${draftId}
    `;
  }
  await sql`
    UPDATE draft_trades SET status = 'approved', animation_pending = true,
      resume_after_animation = ${resumeAfterAnimation}, updated_at = now()
    WHERE id = ${tradeId}
  `;
}

export async function rejectTrade(tradeId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const changed = rowsOf<Row>(await sql`
    UPDATE draft_trades SET status = 'rejected', animation_pending = false,
      resume_after_animation = false, updated_at = now()
    WHERE id = ${tradeId} AND status IN ('pending', 'accepted')
    RETURNING id
  `);
  if (!changed.length) throw new Error('trade_not_pending');
}

export async function finishTradeAnimation(draftId?: string | null): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const id = draftId || String((await activeDraftRow())?.id || '');
  if (!id) return;
  const animations = rowsOf<Row>(await sql`
    SELECT resume_after_animation FROM draft_trades
    WHERE draft_id = ${id} AND status = 'approved' AND animation_pending = true
  `);
  const shouldResume = animations.some((row) => Boolean(row.resume_after_animation));
  await sql`
    UPDATE draft_trades SET animation_pending = false, resume_after_animation = false, updated_at = now()
    WHERE draft_id = ${id} AND animation_pending = true
  `;
  if (shouldResume) {
    await sql`
      UPDATE drafts SET status = 'LIVE', pause_reason = NULL,
        deadline_ts = now() + (GREATEST(1, COALESCE(paused_remaining_seconds, clock_seconds)) * interval '1 second'),
        paused_remaining_seconds = NULL
      WHERE id = ${id} AND status = 'PAUSED' AND pause_reason = 'trade_animation'
    `;
  }
}

export async function resetTrades(draftId?: string | null): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const id = draftId || String((await activeDraftRow())?.id || '');
  if (!id) return;
  await sql`DELETE FROM draft_trades WHERE draft_id = ${id}`;
}
