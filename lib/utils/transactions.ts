import { CURRENT_SEASON, LEAGUE_IDS } from "@/lib/constants/league";
import {
  getRosterIdToTeamNameMap,
  getLeagueTransactionsAllWeeks,
  type SleeperTransaction,
  type SleeperPlayer,
  getAllPlayersCached,
  buildYearToLeagueMapUnique,
} from "@/lib/utils/sleeper-api";

export type LeagueTransaction = {
  id: string;
  type: "waiver" | "free_agent" | "trade";
  season: string;
  week: number;
  created: number;
  /** Primary label: one team (adds/drops) or joined team names for trades */
  team: string;
  /** All fantasy teams tied to this row (for team filter on trades) */
  teamsInvolved: string[];
  rosterId: number;
  added: Array<{ playerId: string; name: string | null; position?: string | null; nflTeam?: string | null }>;
  dropped: Array<{ playerId: string; name: string | null; position?: string | null; nflTeam?: string | null }>;
  faab: number;
  metadata?: Record<string, unknown> | null;
};

export type TransactionsSummary = {
  totalFaab: number;
  totalsByTeam: { team: string; faab: number }[];
  totalsBySeason: { season: string; faab: number }[];
  count: number;
};

export function listAllSeasons(): string[] {
  const uniq = new Set<string>([CURRENT_SEASON, ...Object.keys(LEAGUE_IDS.PREVIOUS || {})]);
  const seasons = Array.from(uniq);
  // Latest first
  return seasons.sort((a, b) => b.localeCompare(a));
}

export async function buildTransactionLedger(arg?: { season?: string }): Promise<LeagueTransaction[]> {
  const players = await getAllPlayersCached().catch(() => ({} as Record<string, SleeperPlayer>));

  const yearToLeague = await buildYearToLeagueMapUnique({ forceFresh: true });

  const entries = Object.entries(yearToLeague).filter(([season]) => !arg?.season || arg.season === season);

  const partials = await Promise.all(
    entries.map(async ([season, leagueId]) => {
      if (!leagueId) return [] as LeagueTransaction[];
      const transactions = await getLeagueTransactionsAllWeeks(leagueId, { forceFresh: true }).catch(() => [] as SleeperTransaction[]);
      const rosterNameMap = await getRosterIdToTeamNameMap(leagueId, { forceFresh: true }).catch(() => new Map<number, string>());
      const chunk: LeagueTransaction[] = [];

      for (const txn of transactions) {
        if (!txn) continue;
        const statusNorm = String((txn as unknown as { status?: unknown }).status ?? "")
          .trim()
          .toLowerCase();
        const isFinal = statusNorm === "complete" || statusNorm === "completed";
        if (!isFinal) continue;

        if (txn.type === "waiver" || txn.type === "free_agent") {
          const week = Number(txn.leg ?? 0) || 0;
          const created = Number(txn.created ?? 0) || 0;

          const addsEntries = Object.entries(txn.adds || {});
          if (addsEntries.length === 0) continue;

          const dropsEntries = Object.entries(txn.drops || {});

          for (const [playerId, rosterId] of addsEntries) {
            const teamName = rosterNameMap.get(rosterId) || `Roster ${rosterId}`;
            const addedPlayer = players[playerId];
            const added = [buildPlayerRecord(playerId, addedPlayer)];
            const dropped = dropsEntries
              .filter(([, dropRosterId]) => dropRosterId === rosterId)
              .map(([pid]) => buildPlayerRecord(pid, players[pid]));

            const faab = resolveWaiverBid(txn, rosterId);

            chunk.push({
              id: txn.transaction_id,
              type: txn.type,
              season,
              week,
              created,
              team: teamName,
              teamsInvolved: [teamName],
              rosterId,
              added,
              dropped,
              faab,
              metadata: txn.metadata || undefined,
            });
          }
          continue;
        }

        if (txn.type === "trade") {
          const week = Number(txn.leg ?? 0) || 0;
          const created = Number(txn.status_updated ?? txn.created ?? 0) || 0;
          const rosterIds = txn.roster_ids || [];
          const teamNames = rosterIds
            .map((rid) => rosterNameMap.get(rid) || `Roster ${rid}`)
            .filter(Boolean);
          const displayTeam = teamNames.length ? teamNames.join(" · ") : "Trade";

          const added: LeagueTransaction["added"] = [];
          if (txn.adds) {
            for (const [playerId, rosterId] of Object.entries(txn.adds)) {
              const toTeam = rosterNameMap.get(rosterId) || `Roster ${rosterId}`;
              const pl = players[playerId];
              const rec = buildPlayerRecord(playerId, pl);
              added.push({
                ...rec,
                name: rec.name ? `${rec.name} (to ${toTeam})` : `${playerId} (to ${toTeam})`,
              });
            }
          }
          for (const pick of txn.draft_picks || []) {
            const orig = rosterNameMap.get(pick.roster_id) || `Roster ${pick.roster_id}`;
            const to = rosterNameMap.get(pick.owner_id) || `Roster ${pick.owner_id}`;
            added.push({
              playerId: `pick-${pick.season}-${pick.round}-${pick.roster_id}-${pick.owner_id}`,
              name: `${pick.season} Round ${pick.round} pick (${orig} → ${to})`,
              position: null,
              nflTeam: null,
            });
          }

          const dropsEntries = Object.entries(txn.drops || {});
          const dropped: LeagueTransaction["dropped"] = [];
          for (const [playerId, rosterId] of dropsEntries) {
            const fromTeam = rosterNameMap.get(rosterId) || `Roster ${rosterId}`;
            const pl = players[playerId];
            const rec = buildPlayerRecord(playerId, pl);
            dropped.push({
              ...rec,
              name: rec.name ? `${rec.name} (from ${fromTeam})` : `${playerId} (from ${fromTeam})`,
            });
          }

          if (added.length === 0 && dropped.length === 0) continue;

          let faab = 0;
          if (Array.isArray(txn.waiver_budget)) {
            for (const b of txn.waiver_budget) {
              faab += Number(b.amount) || 0;
            }
          }

          chunk.push({
            id: txn.transaction_id,
            type: "trade",
            season,
            week,
            created,
            team: displayTeam,
            teamsInvolved: teamNames,
            rosterId: rosterIds[0] ?? 0,
            added,
            dropped,
            faab,
            metadata: txn.metadata || undefined,
          });
        }
      }
      return chunk;
    })
  );

  const out = partials.flat();
  out.sort((a, b) => b.created - a.created);
  return out;
}

function buildPlayerRecord(playerId: string, player: SleeperPlayer | undefined) {
  if (!player) {
    return { playerId, name: null, position: null, nflTeam: null };
  }
  const name = `${player.first_name || ""} ${player.last_name || ""}`.trim() || null;
  return {
    playerId,
    name,
    position: player.position || null,
    nflTeam: player.team || null,
  };
}

function resolveWaiverBid(txn: SleeperTransaction, rosterId: number): number {
  if (txn.type !== "waiver") return 0;
  const settingsBid = Number((txn.settings as { waiver_bid?: number })?.waiver_bid ?? 0);
  if (Number.isFinite(settingsBid) && settingsBid > 0) return settingsBid;

  const metadataBid = Number((txn.metadata as { waiver_bid?: number })?.waiver_bid ?? 0);
  if (Number.isFinite(metadataBid) && metadataBid > 0) return metadataBid;

  if (Array.isArray(txn.waiver_budget)) {
    const transfer = txn.waiver_budget.find((budget) => budget.receiver === rosterId);
    if (transfer && Number.isFinite(Number(transfer.amount))) {
      return Number(transfer.amount);
    }
  }
  return 0;
}
