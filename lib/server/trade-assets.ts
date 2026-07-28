import { LEAGUE_IDS } from '@/lib/constants/league';
import {
  getLeague,
  getLeagueRosters,
  getRosterIdToTeamNameMap,
  getLeagueTransactionsAllWeeks,
  getAllPlayersCached,
  type SleeperTransaction,
} from '@/lib/utils/sleeper-api';
import { getObjectText } from '@/server/storage/r2';
import { canonicalizeTeamName } from '@/lib/server/user-identity';
import { getCurrentPhase } from '@/lib/utils/phase-resolver';

export type TeamAssets = {
  players: string[];
  picks: Array<{ year: number; round: number; originalTeam: string }>;
  faab: number;
};

type LoadNextDraftArgs = {
  leagueId: string;
  league?: Awaited<ReturnType<typeof getLeague>> | null;
  rosters?: Awaited<ReturnType<typeof getLeagueRosters>>;
  nameMap?: Map<number, string>;
};

export async function loadDraftOwnershipForSeason(args: LoadNextDraftArgs & { season: number }): Promise<NextDraftOwnership | null> {
  const league = args.league ?? (await getLeague(args.leagueId).catch(() => null));
  const rosters = args.rosters ?? (await getLeagueRosters(args.leagueId).catch(() => []));
  const nameMap = args.nameMap ?? (await getRosterIdToTeamNameMap(args.leagueId).catch(() => new Map<number, string>()));

  if (!league || !rosters.length) return null;

  const targetSeason = Number(args.season);
  const targetSeasonStr = String(targetSeason);
  const rounds = Math.max(1, Number(((league?.settings as unknown as { draft_rounds?: number })?.draft_rounds) ?? 4));

  const baseOwners: Map<string, number> = new Map();
  const historyMap: Map<string, DraftPickTransferEvent[]> = new Map();
  const tradeSummaries: Record<string, string> = {};

  function pickOrdinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  for (const r of rosters) {
    for (let rd = 1; rd <= rounds; rd++) {
      baseOwners.set(`${r.roster_id}-${rd}`, r.roster_id);
    }
  }

  try {
    const url = `https://api.sleeper.app/v1/league/${args.leagueId}/traded_picks`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (resp.ok) {
      type SleeperTradedPick = { season?: string; round?: number; roster_id?: number; owner_id?: number };
      const arr = (await resp.json()) as SleeperTradedPick[];
      for (const tp of arr) {
        if (!tp || String(tp.season) !== targetSeasonStr) continue;
        const key = `${Number(tp.roster_id)}-${Number(tp.round)}`;
        if (Number.isFinite(tp.owner_id as number)) {
          baseOwners.set(key, Number(tp.owner_id));
        }
      }
    }
  } catch {}


  // Fetch Sleeper league transactions to build pick transfer history for all traded picks
  let allTxs: SleeperTransaction[] = [];
  try {
    allTxs = await getLeagueTransactionsAllWeeks(args.leagueId, { forceFresh: true }).catch(() => []);
    for (const tx of allTxs) {
      const statusNorm = String((tx as unknown as { status?: unknown }).status ?? '').trim().toLowerCase();
      const isFinal = statusNorm === 'complete' || statusNorm === 'completed';
      if (tx.type !== 'trade' || !isFinal) continue;
      for (const pick of (tx.draft_picks || [])) {
        if (String(pick.season) !== targetSeasonStr) continue;
        const key = `${Number(pick.roster_id)}-${Number(pick.round)}`;
        const fromRosterId = Number(pick.previous_owner_id);
        const toRosterId = Number(pick.owner_id);
        const fromTeam = nameMap.get(fromRosterId) || `Roster ${fromRosterId}`;
        const toTeam = nameMap.get(toRosterId) || `Roster ${toRosterId}`;
        const event: DraftPickTransferEvent = {
          tradeId: tx.transaction_id,
          timestamp: tx.status_updated,
          fromRosterId,
          toRosterId,
          fromTeam,
          toTeam,
        };
        const arr = historyMap.get(key) || [];
        arr.push(event);
        historyMap.set(key, arr);
      }
    }
  } catch {}

  // Final owner per pick from completed trades (authoritative when traded_picks API lags txs)
  try {
    const pickEvents: Array<{ ts: number; key: string; ownerRosterId: number }> = [];
    for (const tx of allTxs) {
      const statusNorm = String((tx as unknown as { status?: unknown }).status ?? '').trim().toLowerCase();
      const isFinal = statusNorm === 'complete' || statusNorm === 'completed';
      if (tx.type !== 'trade' || !isFinal) continue;
      const ts = Number(tx.status_updated) || Number(tx.created) || 0;
      for (const pick of tx.draft_picks || []) {
        if (String(pick.season) !== targetSeasonStr) continue;
        const key = `${Number(pick.roster_id)}-${Number(pick.round)}`;
        const oid = Number(pick.owner_id);
        if (!Number.isFinite(oid)) continue;
        pickEvents.push({ ts, key, ownerRosterId: oid });
      }
    }
    pickEvents.sort((a, b) => a.ts - b.ts);
    for (const ev of pickEvents) {
      baseOwners.set(ev.key, ev.ownerRosterId);
    }
  } catch {}

  try {
    if (allTxs.length) {
      const playersById = await getAllPlayersCached();
      const rosterMap = new Map(rosters.map((r) => [r.roster_id, r] as const));
      const teamNameForRoster = (rid: number) =>
        nameMap.get(rid) || rosterMap.get(rid)?.metadata?.team_name || `Roster ${rid}`;

      for (const tx of allTxs) {
        const statusNorm = String((tx as unknown as { status?: unknown }).status ?? '').trim().toLowerCase();
        const isFinal = statusNorm === 'complete' || statusNorm === 'completed';
        if (tx.type !== 'trade' || !isFinal) continue;
        const rosterIds = tx.roster_ids || [];
        if (!rosterIds.length) continue;
        const parts: string[] = [];
        for (const rosterId of rosterIds) {
          const labels: string[] = [];
          if (tx.adds) {
            for (const [playerId, receivingRosterId] of Object.entries(tx.adds)) {
              if (receivingRosterId !== rosterId) continue;
              const pl = playersById[playerId];
              labels.push(pl?.first_name && pl?.last_name ? `${pl.first_name} ${pl.last_name}` : playerId);
            }
          }
          if (tx.draft_picks) {
            for (const pick of tx.draft_picks) {
              if (pick.owner_id !== rosterId || pick.previous_owner_id === rosterId) continue;
              const orig = teamNameForRoster(pick.roster_id);
              labels.push(`${pick.season} ${pickOrdinal(pick.round)} (orig ${orig})`);
            }
          }
          if (tx.waiver_budget) {
            for (const b of tx.waiver_budget) {
              if (b.receiver === rosterId) {
                labels.push(`$${Number(b.amount ?? 0) || 0} FAAB`);
              }
            }
          }
          const slice = labels.slice(0, 4);
          const more = labels.length > 4 ? '…' : '';
          if (slice.length || more) {
            parts.push(`${teamNameForRoster(rosterId)} received: ${slice.join(', ')}${more}`);
          }
        }
        if (parts.length) tradeSummaries[tx.transaction_id] = parts.join(' | ');
      }
    }
  } catch {}

  // Apply manual trades last so overrides win and appear in history
  try {
    type ManualTradeAsset = { type: 'player' | 'pick' | 'cash'; name: string; year?: string; round?: number; originalOwner?: string };
    type ManualTradeTeam = { name: string; assets: ManualTradeAsset[] };
    type ManualTrade = { id: string; date: string; status: 'completed' | 'pending' | 'vetoed'; teams: ManualTradeTeam[]; active?: boolean };
    const BLOB_PATH = 'evw/manual_trades.json';
    let trades: ManualTrade[] = [];
    try {
      const txt = await getObjectText({ key: BLOB_PATH });
      if (txt) {
        const arr = JSON.parse(txt);
        if (Array.isArray(arr)) trades = arr as ManualTrade[];
      }
    } catch {}
    if (trades.length) {
      const tsFromDate = (d: string) => {
        const t = Date.parse(d);
        return Number.isFinite(t) ? t : Date.now();
      };
      const findRosterIdByTeam = (teamName: string | undefined): number | null => {
        if (!teamName) return null;
        for (const [rid, name] of nameMap.entries()) {
          if (name === teamName) return rid;
        }
        return null;
      };
      function summarizeManualTradeTeams(teams: ManualTradeTeam[]): string {
        const parts = (teams || []).map((team) => {
          const labels = (team.assets || []).map((a) => a.name).filter(Boolean).slice(0, 4);
          const more = (team.assets || []).length > 4 ? '…' : '';
          return `${team.name} received: ${labels.join(', ')}${more}`;
        });
        return parts.join(' | ');
      }

      for (const mt of trades) {
        if (mt.active === false) continue;
        if (mt.status !== 'completed') continue;
        tradeSummaries[mt.id] = summarizeManualTradeTeams(mt.teams || []);
        const timestamp = tsFromDate(mt.date);
        for (const team of (mt.teams || [])) {
          const toRosterId = findRosterIdByTeam(team.name);
          if (!toRosterId) continue;
          for (const a of (team.assets || [])) {
            if (a.type !== 'pick') continue;
            const yearStr = a.year ? String(a.year) : '';
            const rd = Number(a.round);
            if (!yearStr || yearStr !== targetSeasonStr) continue;
            if (!Number.isFinite(rd)) continue;
            const origRosterId = findRosterIdByTeam(a.originalOwner);
            if (!origRosterId) continue;
            const key = `${origRosterId}-${rd}`;
            const prevOwner = baseOwners.get(key);
            baseOwners.set(key, toRosterId);
            const fromTeam = prevOwner != null ? (nameMap.get(prevOwner) || `Roster ${prevOwner}`) : (a.originalOwner || 'Unknown');
            const toTeam = nameMap.get(toRosterId) || `Roster ${toRosterId}`;
            const event: DraftPickTransferEvent = {
              tradeId: mt.id,
              timestamp,
              fromRosterId: prevOwner ?? origRosterId,
              toRosterId: toRosterId,
              fromTeam,
              toTeam,
            };
            const arr = historyMap.get(key) || [];
            arr.push(event);
            historyMap.set(key, arr);
          }
        }
      }
    }
  } catch {}

  const ownership: Record<string, { ownerRosterId: number; history: DraftPickTransferEvent[] }> = {};
  for (const [key, owner] of baseOwners.entries()) {
    const history = historyMap.get(key) || [];
    history.sort((a, b) => a.timestamp - b.timestamp);
    ownership[key] = {
      ownerRosterId: owner,
      history,
    };
  }

  const rosterIdToTeam: Record<string, string> = {};
  for (const [rosterId, teamName] of nameMap.entries()) {
    rosterIdToTeam[String(rosterId)] = teamName;
  }

  return {
    season: targetSeason,
    rounds,
    rosterCount: rosters.length,
    rosterIdToTeam,
    ownership,
    tradeSummaries,
  };
}

export type DraftPickTransferEvent = {
  tradeId: string;
  timestamp: number;
  fromRosterId: number;
  toRosterId: number;
  fromTeam: string;
  toTeam: string;
};

export type NextDraftOwnership = {
  season: number;
  rounds: number;
  rosterCount: number;
  rosterIdToTeam: Record<string, string>;
  ownership: Record<string, { ownerRosterId: number; history: DraftPickTransferEvent[] }>;
  tradeSummaries: Record<string, string>;
};

/** Shared league + future-pick ownership loaded once for trade block aggregation. */
export type TradeBlockLeagueContext = {
  leagueId: string;
  league: Awaited<ReturnType<typeof getLeague>> | null;
  rosters: Awaited<ReturnType<typeof getLeagueRosters>>;
  nameMap: Map<number, string>;
  phase: ReturnType<typeof getCurrentPhase>;
  seasons: number[];
  ownerships: Array<NextDraftOwnership | null>;
};

export async function loadTradeBlockLeagueContext(): Promise<TradeBlockLeagueContext> {
  const leagueId = LEAGUE_IDS.CURRENT;
  const league = await getLeague(leagueId).catch(() => null);
  const rosters = await getLeagueRosters(leagueId).catch(() => []);
  const nameMap = await getRosterIdToTeamNameMap(leagueId).catch(() => new Map<number, string>());
  const phase = getCurrentPhase();
  const currentSeason = Number((league as unknown as { season?: string })?.season ?? new Date().getFullYear());
  // pre-draft: current year's picks are still undrafted and tradeable → include currentSeason
  // post-draft / in-season: current year's picks are used → start from currentSeason + 1
  const seasons = phase === 'post_championship_pre_draft'
    ? [currentSeason, currentSeason + 1, currentSeason + 2]
    : [currentSeason + 1, currentSeason + 2];
  const ownerships = await Promise.all(
    seasons.map((season) => loadDraftOwnershipForSeason({ leagueId, league, rosters, nameMap, season }))
  );
  return { leagueId, league, rosters, nameMap, phase, seasons, ownerships };
}

export function teamAssetsFromContext(team: string, ctx: TradeBlockLeagueContext): TeamAssets {
  const canon = canonicalizeTeamName(team);
  const { league, rosters, nameMap, phase, ownerships } = ctx;

  let rosterPlayers: string[] = [];
  let waiverBudgetUsed = 0;

  if (rosters && rosters.length > 0) {
    const match = rosters.find((r) => nameMap.get(r.roster_id) === canon);
    if (match) {
      rosterPlayers = Array.isArray(match.players) ? match.players.filter(Boolean) : [];
      const inSeason = phase === 'regular_season' || phase === 'playoffs';
      if (inSeason) {
        const used = Number((match.settings as unknown as { waiver_budget_used?: number })?.waiver_budget_used ?? 0);
        waiverBudgetUsed = Number.isFinite(used) ? used : 0;
      } else {
        waiverBudgetUsed = 0;
      }
    }
  }

  const picks: Array<{ year: number; round: number; originalTeam: string }> = [];
  const seenPickKeys = new Set<string>();

  if (rosters.length > 0) {
    const teamRoster = rosters.find((r) => nameMap.get(r.roster_id) === canon);
    if (teamRoster) {
      for (const ownership of ownerships) {
        if (!ownership) continue;
        for (const [key, value] of Object.entries(ownership.ownership)) {
          if (value.ownerRosterId !== teamRoster.roster_id) continue;
          const [origRosterIdStr, roundStr] = key.split('-');
          const round = Number(roundStr);
          if (!Number.isFinite(round)) continue;
          const originalTeam =
            ownership.rosterIdToTeam[origRosterIdStr] ||
            nameMap.get(Number(origRosterIdStr)) ||
            canon;
          const pickKey = `${ownership.season}-${round}-${originalTeam}`;
          if (seenPickKeys.has(pickKey)) continue;
          seenPickKeys.add(pickKey);
          picks.push({ year: ownership.season, round, originalTeam });
        }
      }
    }
  }

  const leagueWaiverBudget = Number(((league?.settings as unknown as { waiver_budget?: number })?.waiver_budget) ?? 100);
  const faabAvail = Math.max(0, leagueWaiverBudget - waiverBudgetUsed);

  return { players: rosterPlayers, picks, faab: faabAvail };
}

export async function getTeamAssets(team: string): Promise<TeamAssets> {
  const ctx = await loadTradeBlockLeagueContext();
  return teamAssetsFromContext(team, ctx);
}

export async function loadNextDraftOwnership(args: LoadNextDraftArgs): Promise<NextDraftOwnership | null> {
  const league = args.league ?? (await getLeague(args.leagueId).catch(() => null));
  const rosters = args.rosters ?? (await getLeagueRosters(args.leagueId).catch(() => []));
  const nameMap = args.nameMap ?? (await getRosterIdToTeamNameMap(args.leagueId).catch(() => new Map<number, string>()));
  if (!league || !rosters.length) return null;
  const nextSeason = Number((league as unknown as { season?: string })?.season ?? new Date().getFullYear()) + 1;
  return loadDraftOwnershipForSeason({ leagueId: args.leagueId, league, rosters, nameMap, season: nextSeason });
}
