import { NextRequest } from 'next/server';
import {
  getTeamsData,
  getRegularSeasonRecords,
} from '@/lib/utils/sleeper-api';
import { CURRENT_SEASON, getLeagueIdForSeason } from '@/lib/constants/league';
import { canonicalizeTeamName } from '@/lib/server/user-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SeasonResult {
  season: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
  recordRank: number;
  fptsRank: number;
  fptsAgainstRank: number;
}

const COMPLETED_SEASON = Number(CURRENT_SEASON) - 1;
const SEASONS: Array<{ label: string; leagueId: string }> = [0, 1, 2]
  .map((offset) => {
    const season = String(COMPLETED_SEASON - offset);
    const leagueId = getLeagueIdForSeason(season);
    return leagueId ? { label: season, leagueId } : null;
  })
  .filter((entry): entry is { label: string; leagueId: string } => Boolean(entry));

async function getSeasonResult(
  ownerId: string,
  leagueId: string,
  season: string
): Promise<SeasonResult | null> {
  try {
    const [teams, regMap] = await Promise.all([
      getTeamsData(leagueId, { forceFresh: true }).catch(() => []),
      getRegularSeasonRecords(leagueId, { forceFresh: true }).catch(() => null as Map<number, { wins: number; losses: number; ties: number; fpts: number }> | null),
    ]);
    if (!teams.length) return null;

    const teamRows = teams.map((t) => {
      const reg = regMap?.get(t.rosterId);
      return {
        ownerId: t.ownerId,
        rosterId: t.rosterId,
        wins: reg?.wins ?? t.wins,
        losses: reg?.losses ?? t.losses,
        ties: reg?.ties ?? t.ties,
        fpts: reg?.fpts ?? t.fpts,
        fptsAgainst: t.fptsAgainst ?? 0,
      };
    });

    // Match by owner ID to correctly track a team across seasons (team names can differ year to year)
    const teamData = teamRows.find(t => t.ownerId === ownerId);
    if (!teamData) return null;

    const byRecord = [...teamRows].sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (a.losses !== b.losses) return a.losses - b.losses;
      if (a.ties !== b.ties) return b.ties - a.ties;
      if (a.fpts !== b.fpts) return b.fpts - a.fpts;
      return a.rosterId - b.rosterId;
    });
    const byFpts = [...teamRows].sort((a, b) => {
      if (a.fpts !== b.fpts) return b.fpts - a.fpts;
      return a.rosterId - b.rosterId;
    });
    const byFptsAgainst = [...teamRows].sort((a, b) => {
      if (a.fptsAgainst !== b.fptsAgainst) return a.fptsAgainst - b.fptsAgainst;
      return a.rosterId - b.rosterId;
    });

    const recordRank = byRecord.findIndex((t) => t.rosterId === teamData.rosterId) + 1;
    const fptsRank = byFpts.findIndex((t) => t.rosterId === teamData.rosterId) + 1;
    const fptsAgainstRank = byFptsAgainst.findIndex((t) => t.rosterId === teamData.rosterId) + 1;

    return {
      season,
      wins: teamData.wins,
      losses: teamData.losses,
      ties: teamData.ties,
      fpts: Math.round(teamData.fpts * 10) / 10,
      fptsAgainst: Math.round(teamData.fptsAgainst * 10) / 10,
      recordRank: Math.max(recordRank, 1),
      fptsRank: Math.max(fptsRank, 1),
      fptsAgainstRank: Math.max(fptsAgainstRank, 1),
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const team = url.searchParams.get('team') || '';
  if (!team) return Response.json({ error: 'team required' }, { status: 400 });

  try {
    // Resolve owner ID from the current season so we can match the same person across past seasons
    const currentLeagueId = getLeagueIdForSeason(CURRENT_SEASON);
    if (!currentLeagueId) return Response.json({ team, seasons: [] });
    const currentTeams = await getTeamsData(currentLeagueId).catch(() => []);
    const canon = canonicalizeTeamName(team);
    const currentEntry = currentTeams.find(t => canonicalizeTeamName(t.teamName) === canon);
    if (!currentEntry) return Response.json({ team, seasons: [] });
    const ownerId = currentEntry.ownerId;

    const results = await Promise.all(
      SEASONS.map(s => getSeasonResult(ownerId, s.leagueId, s.label))
    );

    const seasons = results.filter((r): r is SeasonResult => r !== null);

    return Response.json(
      { team, seasons },
      { headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=300' } }
    );
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
