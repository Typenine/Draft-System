import { CURRENT_SEASON, LEAGUE_IDS, getLeagueIdForSeason } from '@/lib/constants/league';
import { canonicalizeTeamName } from '@/lib/server/user-identity';
import {
  derivePodiumFromWinnersBracketByYear,
  getLeagueWinnersBracket,
  getRegularSeasonRecords,
  getTeamsData,
  type SleeperBracketGame,
} from '@/lib/utils/sleeper-api';

export type SlotOrderEntry = {
  slot: number;
  rosterId: number;
  team: string;
  record: { wins: number; losses: number; ties: number; fpts: number; fptsAgainst: number };
};

export type PickSlotMap = {
  season: number;
  /** Round-1 slot (pick-in-round) keyed by original owner team name */
  slotByOriginalTeam: Record<string, number>;
};

type TeamStanding = Awaited<ReturnType<typeof getTeamsData>>[number];

function byStandingAsc(a: TeamStanding, b: TeamStanding): number {
  if (a.wins !== b.wins) return a.wins - b.wins;
  if (a.losses !== b.losses) return b.losses - a.losses;
  if (a.fpts !== b.fpts) return a.fpts - b.fpts;
  if (a.fptsAgainst !== b.fptsAgainst) return a.fptsAgainst - b.fptsAgainst;
  return a.teamName.localeCompare(b.teamName);
}

function toSlotEntry(team: TeamStanding, slot: number): SlotOrderEntry {
  return {
    slot,
    rosterId: team.rosterId,
    team: team.teamName,
    record: {
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      fpts: team.fpts,
      fptsAgainst: team.fptsAgainst,
    },
  };
}

/**
 * Build round-1 draft slot order for a target season using prior-season
 * regular-season records and playoff bracket results (matches /api/draft/next-order).
 */
export async function buildPlayoffAwareSlotOrder(targetSeason: number): Promise<SlotOrderEntry[]> {
  const sourceLeagueSeason = String(targetSeason - 1);
  const standingsLeagueId = getLeagueIdForSeason(sourceLeagueSeason) || LEAGUE_IDS.CURRENT;

  const [rawTeams, regularRecords] = await Promise.all([
    getTeamsData(standingsLeagueId),
    getRegularSeasonRecords(standingsLeagueId).catch(() => null),
  ]);

  const teams = regularRecords
    ? rawTeams.map((t) => {
        const r = regularRecords.get(t.rosterId);
        return r ? { ...t, wins: r.wins, losses: r.losses, ties: r.ties } : t;
      })
    : rawTeams;

  let slotOrder: SlotOrderEntry[] = [];

  try {
    const winners: SleeperBracketGame[] = await getLeagueWinnersBracket(standingsLeagueId, { forceFresh: true }).catch(() => []);
    const participantIds = new Set<number>();
    for (const g of winners) {
      if (g.t1 != null) participantIds.add(g.t1);
      if (g.t2 != null) participantIds.add(g.t2);
    }

    const eliminatedInRound = new Map<number, number>();
    for (const g of winners) {
      const r = g.r ?? 0;
      if (g.t1 != null && g.t2 != null && g.w != null) {
        const loser = g.w === g.t1 ? g.t2 : g.t1;
        if (loser != null && !eliminatedInRound.has(loser)) eliminatedInRound.set(loser, r);
      }
    }

    let champId: number | null = null;
    let runnerId: number | null = null;
    let thirdWinnerId: number | null = null;
    let thirdLoserId: number | null = null;
    let maxRound = 0;

    if (winners.length > 0) {
      maxRound = Math.max(...winners.map((g) => g.r ?? 0));
      const semiRound = maxRound - 1;
      const lastRoundGames = winners.filter((g) => (g.r ?? 0) === maxRound && g.t1 != null && g.t2 != null);
      const semiGames = winners.filter((g) => (g.r ?? 0) === semiRound && g.t1 != null && g.t2 != null);
      const semiWinners = new Set<number>();
      const semiLosers = new Set<number>();
      for (const sg of semiGames) {
        if (sg.w != null) semiWinners.add(sg.w);
        const loser = sg.l ?? (sg.w === sg.t1 ? sg.t2 ?? null : sg.t1 ?? null);
        if (loser != null) semiLosers.add(loser);
      }
      const finalGame = lastRoundGames.find((g) => semiWinners.has(g.t1 as number) && semiWinners.has(g.t2 as number) && g.w != null);
      const thirdGame = lastRoundGames.find((g) => semiLosers.has(g.t1 as number) && semiLosers.has(g.t2 as number) && g.w != null);
      if (finalGame) {
        champId = finalGame.w ?? null;
        runnerId = finalGame.l ?? (finalGame.w === finalGame.t1 ? (finalGame.t2 ?? null) : (finalGame.t1 ?? null));
      }
      if (thirdGame) {
        thirdWinnerId = thirdGame.w ?? null;
        thirdLoserId = thirdGame.l ?? (thirdGame.w === thirdGame.t1 ? (thirdGame.t2 ?? null) : (thirdGame.t1 ?? null));
      }
    }

    if ((champId == null || runnerId == null) && targetSeason) {
      const yearStr = String(targetSeason - 1);
      try {
        const podium = await derivePodiumFromWinnersBracketByYear(yearStr, { forceFresh: true });
        if (podium) {
          const nameToRoster = new Map(teams.map((t) => [t.teamName, t.rosterId] as const));
          if (champId == null && podium.champion && nameToRoster.has(podium.champion)) {
            champId = nameToRoster.get(podium.champion)!;
          }
          if (runnerId == null && podium.runnerUp && nameToRoster.has(podium.runnerUp)) {
            runnerId = nameToRoster.get(podium.runnerUp)!;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (participantIds.size > 0 && champId != null && runnerId != null) {
      const byRoster = new Map(teams.map((t) => [t.rosterId, t] as const));
      const nonPlayoff = teams.filter((t) => !participantIds.has(t.rosterId)).sort(byStandingAsc);
      const playoffNonFinalists = teams.filter((t) => participantIds.has(t.rosterId) && t.rosterId !== champId && t.rosterId !== runnerId);
      const rounds = Array.from(new Set(playoffNonFinalists.map((t) => eliminatedInRound.get(t.rosterId) ?? Number.MAX_SAFE_INTEGER)))
        .filter((r) => Number.isFinite(r))
        .sort((a, b) => (a as number) - (b as number)) as number[];
      const playoffOrdered: TeamStanding[] = [];
      const semiRound = maxRound > 0 ? maxRound - 1 : -1;
      for (const r of rounds) {
        const bucket = playoffNonFinalists.filter((t) => (eliminatedInRound.get(t.rosterId) ?? Number.MAX_SAFE_INTEGER) === r);
        if (r === semiRound && thirdWinnerId != null && thirdLoserId != null) {
          bucket.sort((a, b) => {
            const aId = a.rosterId;
            const bId = b.rosterId;
            const aTP = aId === thirdWinnerId || aId === thirdLoserId;
            const bTP = bId === thirdWinnerId || bId === thirdLoserId;
            if (aTP && bTP) {
              if (aId === thirdLoserId && bId === thirdWinnerId) return -1;
              if (aId === thirdWinnerId && bId === thirdLoserId) return 1;
            }
            return byStandingAsc(a, b);
          });
        } else {
          bucket.sort(byStandingAsc);
        }
        playoffOrdered.push(...bucket);
      }

      let playoffOrderedAdjusted = playoffOrdered;
      if (thirdWinnerId != null && thirdLoserId != null) {
        const withoutThirds = playoffOrdered.filter((t) => t.rosterId !== thirdLoserId && t.rosterId !== thirdWinnerId);
        const thirdLoserTeam = byRoster.get(thirdLoserId);
        const thirdWinnerTeam = byRoster.get(thirdWinnerId);
        if (thirdLoserTeam && thirdWinnerTeam) {
          playoffOrderedAdjusted = [...withoutThirds, thirdLoserTeam, thirdWinnerTeam];
        }
      }

      const finalists = [byRoster.get(runnerId)!, byRoster.get(champId)!];
      const ordered = [...nonPlayoff, ...playoffOrderedAdjusted, finalists[0], finalists[1]].filter(Boolean) as TeamStanding[];
      slotOrder = ordered.map((team, index) => toSlotEntry(team, index + 1));
    }
  } catch {
    /* fall through to record-only ordering */
  }

  if (slotOrder.length === 0) {
    const fallback = [...teams].sort(byStandingAsc);
    slotOrder = fallback.map((team, index) => toSlotEntry(team, index + 1));
  }

  return slotOrder;
}

function buildSlotMapFromOrder(season: number, slotOrder: SlotOrderEntry[]): PickSlotMap {
  const slotByOriginalTeam: Record<string, number> = {};
  for (const entry of slotOrder) {
    slotByOriginalTeam[canonicalizeTeamName(entry.team)] = entry.slot;
  }
  return { season, slotByOriginalTeam };
}

/**
 * Load round-1 pick slot numbers keyed by original owner team.
 * Uses the same playoff-aware standings order as /api/draft/next-order and the trade block UI.
 */
export async function loadPickSlotMap(season?: number): Promise<PickSlotMap | null> {
  const targetSeason = season ?? Number(CURRENT_SEASON);
  if (!Number.isFinite(targetSeason)) return null;

  try {
    const slotOrder = await buildPlayoffAwareSlotOrder(targetSeason);
    if (slotOrder.length === 0) return null;
    return buildSlotMapFromOrder(targetSeason, slotOrder);
  } catch {
    return null;
  }
}

function lookupPickSlot(originalTeam: string | undefined, slotMap: PickSlotMap | null): number | undefined {
  if (!originalTeam || !slotMap) return undefined;
  return slotMap.slotByOriginalTeam[canonicalizeTeamName(originalTeam)];
}

/**
 * Format a draft pick for trade-block messages using dynasty notation (e.g. 2026 1.05).
 * Matches the trade block UI: slot is the original owner's round-1 position.
 */
export function formatTradeBlockPickLabel(
  asset: { year: number; round: number; originalTeam?: string },
  ownerTeam: string,
  slotMap: PickSlotMap | null,
): string {
  const slot = asset.year === slotMap?.season ? lookupPickSlot(asset.originalTeam, slotMap) : undefined;
  const slotStr = slot != null ? `${asset.round}.${String(slot).padStart(2, '0')}` : null;
  const roundOrd =
    asset.round === 1 ? '1st' : asset.round === 2 ? '2nd' : asset.round === 3 ? '3rd' : `${asset.round}th`;
  const pickPart = slotStr ?? `${roundOrd} Round`;
  const origPart =
    asset.originalTeam && canonicalizeTeamName(asset.originalTeam) !== canonicalizeTeamName(ownerTeam)
      ? ` (${asset.originalTeam})`
      : '';
  return `${asset.year} ${pickPart}${origPart}`;
}
