import { NextRequest } from 'next/server';
import { getLeagueRosters, getRosterIdToTeamNameMap, getAllPlayersCached, SleeperPlayer } from '@/lib/utils/sleeper-api';
import { LEAGUE_IDS } from '@/lib/constants/league';
import { canonicalizeTeamName } from '@/lib/server/user-identity';
import { getRosterSnapshot, hasRosterSnapshot, getDraftPicksStillOwnedByTeam } from '@/server/db/queries.fixed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const team = url.searchParams.get('team') || '';
  const draftId = url.searchParams.get('draftId') || '';
  if (!team) return Response.json({ error: 'team required' }, { status: 400 });

  // When draftId provided and the snapshot has pre-draft roster data for this team,
  // use it — it accurately reflects which players each team owns after in-draft trades.
  // Also merges players drafted during this draft who haven't been traded yet.
  // Resolves any unresolved player names (stored as numeric IDs) via Sleeper cache.
  if (draftId) {
    try {
      const snapshotExists = await hasRosterSnapshot(draftId);
      if (snapshotExists) {
        const [snapshot, draftedStillOwned] = await Promise.all([
          getRosterSnapshot(draftId, team),
          getDraftPicksStillOwnedByTeam(draftId, team),
        ]);
        // Only use snapshot path when the pre-draft roster snapshot is present for this team.
        // If snapshot is empty, the team was missed during snapshotting — fall through to Sleeper.
        if (snapshot.length > 0) {
          const combined = [...snapshot, ...draftedStillOwned];
          // Some snapshot rows have the Sleeper player ID stored as the name (happens when
          // getAllPlayersCached() didn't include that player at snapshot time). Resolve them now.
          const needsResolution = combined.some(p => !p.playerName || p.playerName === p.playerId);
          const sleeperPlayers: Record<string, SleeperPlayer> = needsResolution
            ? await getAllPlayersCached().catch(() => ({} as Record<string, SleeperPlayer>))
            : {};
          const players = combined
            .map(p => {
              const { playerId } = p;
              let { playerName, playerPos, playerNfl } = p;
              if (!playerName || playerName === playerId) {
                const sp = sleeperPlayers[playerId];
                if (sp) {
                  playerName = [sp.first_name, sp.last_name].filter(Boolean).join(' ') || playerId;
                  if (!playerPos) playerPos = sp.position || null;
                  if (!playerNfl) playerNfl = sp.team || null;
                }
              }
              return { id: playerId, name: playerName || playerId, pos: playerPos || '', nfl: playerNfl || '' };
            })
            .sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || a.name.localeCompare(b.name));
          return Response.json({ players, fromSnapshot: true });
        }
      }
    } catch { /* fall through to Sleeper */ }
  }

  try {
    const leagueId = LEAGUE_IDS.CURRENT;
    const [rosters, nameMap, allPlayers] = await Promise.all([
      getLeagueRosters(leagueId).catch(() => []),
      getRosterIdToTeamNameMap(leagueId).catch(() => new Map<number, string>()),
      getAllPlayersCached().catch(() => ({} as Record<string, SleeperPlayer>)),
    ]);

    const canon = canonicalizeTeamName(team);
    const roster = rosters.find(r => nameMap.get(r.roster_id) === canon);
    if (!roster) return Response.json({ players: [] });

    const playerIds: string[] = Array.isArray(roster.players) ? (roster.players as string[]).filter(Boolean) : [];
    const players = playerIds
      .map(id => {
        const p = allPlayers[id];
        const name = p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || id : id;
        return { id, name, pos: p?.position || '', nfl: p?.team || '' };
      })
      .sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || a.name.localeCompare(b.name));

    return Response.json({ players });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
