import { NextRequest } from 'next/server';
import {
  getLeagueRosters,
  getRosterIdToTeamNameMap,
  getAllPlayersCached,
  computeSeasonTotalsCustomScoring,
  type SleeperRoster,
  type SleeperPlayer,
} from '@/lib/utils/sleeper-api';
import { CURRENT_SEASON, getLeagueIdForSeason } from '@/lib/constants/league';
import { canonicalizeTeamName } from '@/lib/server/user-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const team = url.searchParams.get('team') || '';
  if (!team) return Response.json({ error: 'team required' }, { status: 400 });

  try {
    // Use the most recent completed season (during 2026 draft, this is 2025).
    const completedSeason = String(Number(CURRENT_SEASON) - 1);
    const leagueId = getLeagueIdForSeason(completedSeason);
    if (!leagueId) return Response.json({ season: completedSeason, players: [] });

    const [rosters, nameMap, allPlayers, seasonTotals] = await Promise.all([
      getLeagueRosters(leagueId).catch(() => [] as SleeperRoster[]),
      getRosterIdToTeamNameMap(leagueId).catch(() => new Map<number, string>()),
      getAllPlayersCached().catch(() => ({} as Record<string, SleeperPlayer>)),
      computeSeasonTotalsCustomScoring(completedSeason, leagueId, 14).catch(() => ({} as Record<string, number>)),
    ]);

    const canon = canonicalizeTeamName(team);
    const roster = rosters.find((r: SleeperRoster) => canonicalizeTeamName(nameMap.get(r.roster_id) || '') === canon);
    if (!roster) return Response.json({ season: completedSeason, players: [] });

    const playerIds: string[] = Array.isArray(roster.players)
      ? (roster.players as string[]).filter(Boolean)
      : [];

    const scored = playerIds
      .filter(pid => (seasonTotals[pid] ?? 0) > 0)
      .map(pid => {
        const p = allPlayers[pid as keyof typeof allPlayers];
        const name = p
          ? [p.first_name, p.last_name].filter(Boolean).join(' ') || pid
          : pid;
        return {
          id: pid,
          name,
          pos: p?.position || '',
          nfl: p?.team || '',
          pts: Math.round((seasonTotals[pid] || 0) * 10) / 10,
        };
      })
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 5);

    return Response.json(
      { season: completedSeason, players: scored },
      { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } }
    );
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
