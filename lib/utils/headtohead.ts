import {
  getLeague,
  getLeagueMatchups,
  getLeagueRosters,
  getLeagueWinnersBracket,
  getLeagueLosersBracket,
  getAllOwnerIdsAcrossSeasons,
  type SleeperFetchOptions,
  type SleeperBracketGame,
  buildYearToLeagueMapUnique,
} from "@/lib/utils/sleeper-api";
import { resolveCanonicalTeamName } from "@/lib/utils/team-utils";

export type H2HCategory = "regular" | "playoffs" | "toilet";

export interface H2HCell {
  meetings: number;
  wins: { total: number; regular: number; playoffs: number; toilet: number };
  losses: { total: number; regular: number; playoffs: number; toilet: number };
  ties: number;
  lastMeeting?: { year: string; week: number };
  firstWinAt?: { year: string; week: number };
}

export interface H2HResult {
  teams: string[]; // canonical team names (sorted)
  matrix: Record<string, Record<string, H2HCell>>; // A -> B
  neverBeaten: Array<{ team: string; vs: string; meetings: number; lastMeeting?: { year: string; week: number } }>;
}

const DEFAULT_WEEKS = 17; // finals week 17 in this league
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cache: { ts: number; data: H2HResult } | null = null;

function emptyCell(): H2HCell {
  return {
    meetings: 0,
    wins: { total: 0, regular: 0, playoffs: 0, toilet: 0 },
    losses: { total: 0, regular: 0, playoffs: 0, toilet: 0 },
    ties: 0,
  };
}

export async function getHeadToHeadAllTime(options?: SleeperFetchOptions): Promise<H2HResult> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS && !options?.forceFresh) return cache.data;

  // Build year->league map
  const yearToLeague = await buildYearToLeagueMapUnique(options);

  // Determine full set of canonical teams across seasons
  const ownerIds = await getAllOwnerIdsAcrossSeasons(options);
  const allTeams = ownerIds.map((oid) => resolveCanonicalTeamName({ ownerId: oid })).sort((a, b) => a.localeCompare(b));

  // Initialize matrix with all pairs
  const matrix = new Map<string, Map<string, H2HCell>>();
  for (const a of allTeams) {
    const row = new Map<string, H2HCell>();
    for (const b of allTeams) row.set(b, emptyCell());
    matrix.set(a, row);
  }

  // Iterate seasons chronologically for stable lastMeeting semantics
  const sortedYears = Object.keys(yearToLeague).sort();
  for (const year of sortedYears) {
    const leagueId = yearToLeague[year];
    if (!leagueId) continue;

    // Roster -> owner
    const rosters = await getLeagueRosters(leagueId, options);
    const rosterOwner = new Map<number, string>();
    for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);

    // League settings for playoff start
    const league = await getLeague(leagueId, options);
    const settings = (league?.settings || {}) as { playoff_week_start?: number; playoff_start_week?: number };
    const startWeek = Number(settings.playoff_week_start ?? settings.playoff_start_week ?? 15);

    // Winners/Losers brackets
    const [winnersBracket, losersBracket] = await Promise.all([
      getLeagueWinnersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]),
      getLeagueLosersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]),
    ]);
    const winnersSet = new Set<number>();
    const losersSet = new Set<number>();
    for (const g of winnersBracket) {
      if (typeof g.t1 === "number") winnersSet.add(g.t1);
      if (typeof g.t2 === "number") winnersSet.add(g.t2);
    }
    for (const g of losersBracket) {
      if (typeof g.t1 === "number") losersSet.add(g.t1);
      if (typeof g.t2 === "number") losersSet.add(g.t2);
    }

    // Fetch weekly matchups 1..DEFAULT_WEEKS
    const weeks = Array.from({ length: DEFAULT_WEEKS }, (_, i) => i + 1);
    const allWeekMatchups = await Promise.all(weeks.map((w) => getLeagueMatchups(leagueId, w, options).catch(() => [])));

    for (let idx = 0; idx < allWeekMatchups.length; idx++) {
      const week = idx + 1;
      const matchups = allWeekMatchups[idx] as Array<{ matchup_id: number; roster_id: number; points?: number; custom_points?: number }>;
      if (!matchups || matchups.length === 0) continue;

      // Group by matchup_id
      const byId = new Map<number, typeof matchups>();
      for (const m of matchups) {
        const arr = byId.get(m.matchup_id) || [];
        arr.push(m);
        byId.set(m.matchup_id, arr);
      }

      for (const pair of byId.values()) {
        if (!pair || pair.length < 2) continue;
        const [a, b] = pair;
        const aPts = (a.custom_points ?? a.points ?? 0) as number;
        const bPts = (b.custom_points ?? b.points ?? 0) as number;
        // skip unplayed 0-0
        if (!(aPts > 0 || bPts > 0)) continue;

        const aOwner = rosterOwner.get(a.roster_id);
        const bOwner = rosterOwner.get(b.roster_id);
        if (!aOwner || !bOwner) continue;
        const aName = resolveCanonicalTeamName({ ownerId: aOwner });
        const bName = resolveCanonicalTeamName({ ownerId: bOwner });

        // Determine category
        let category: H2HCategory | null = null;
        if (week < startWeek) {
          category = "regular";
        } else {
          const aInW = winnersSet.has(a.roster_id);
          const bInW = winnersSet.has(b.roster_id);
          const aInL = losersSet.has(a.roster_id);
          const bInL = losersSet.has(b.roster_id);
          if (aInW && bInW) category = "playoffs";
          else if (losersSet.size > 0 ? (aInL && bInL) : (!aInW && !bInW)) category = "toilet";
          else category = null; // ambiguous
        }
        if (!category) continue;

        const rowA = matrix.get(aName)!;
        const rowB = matrix.get(bName)!;
        const cellAB = rowA.get(bName)!;
        const cellBA = rowB.get(aName)!;

        // Update meetings and last meeting
        cellAB.meetings += 1;
        cellBA.meetings += 1;
        cellAB.lastMeeting = { year, week };
        cellBA.lastMeeting = { year, week };

        if (aPts > bPts) {
          if (cellAB.wins.total === 0) cellAB.firstWinAt = { year, week };
          cellAB.wins.total += 1; cellAB.wins[category] += 1;
          cellBA.losses.total += 1; cellBA.losses[category] += 1;
        } else if (aPts < bPts) {
          if (cellBA.wins.total === 0) cellBA.firstWinAt = { year, week };
          cellBA.wins.total += 1; cellBA.wins[category] += 1;
          cellAB.losses.total += 1; cellAB.losses[category] += 1;
        } else {
          cellAB.ties += 1; cellBA.ties += 1;
        }
      }
    }
  }

  // Build neverBeaten list (meetings > 0 and wins.total === 0)
  const neverBeaten: Array<{ team: string; vs: string; meetings: number; lastMeeting?: { year: string; week: number } }> = [];
  for (const a of allTeams) {
    const row = matrix.get(a)!;
    for (const b of allTeams) {
      if (a === b) continue;
      const cell = row.get(b)!;
      if (cell.meetings > 0 && cell.wins.total === 0) {
        neverBeaten.push({ team: a, vs: b, meetings: cell.meetings, lastMeeting: cell.lastMeeting });
      }
    }
  }

  // Convert to plain objects for serialization
  const teams = allTeams;
  const objMatrix: Record<string, Record<string, H2HCell>> = {};
  for (const [a, row] of matrix.entries()) {
    objMatrix[a] = {} as Record<string, H2HCell>;
    for (const [b, cell] of row.entries()) objMatrix[a][b] = cell;
  }

  const result: H2HResult = { teams, matrix: objMatrix, neverBeaten };
  cache = { ts: Date.now(), data: result };
  return result;
}
