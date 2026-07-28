import { ensureSchema, getSql } from '../db';
import type { Player } from '../types';
import { activeDraftRow, mapPlayer, rowsOf, type Row } from './shared';

export async function getTeamQueue(teamId: string): Promise<Player[]> {
  await ensureSchema();
  const sql = getSql();
  const draft = await activeDraftRow();
  if (!draft) return [];
  return rowsOf<Row>(await sql`
    SELECT p.* FROM draft_queues q
    JOIN draft_players p ON p.id = q.player_id
    WHERE q.draft_id = ${String(draft.id)} AND q.team_id = ${teamId}
      AND NOT EXISTS (SELECT 1 FROM draft_picks dp WHERE dp.draft_id = q.draft_id AND dp.player_id = q.player_id)
    ORDER BY q.rank
  `).map(mapPlayer);
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
