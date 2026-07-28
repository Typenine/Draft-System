import { CURRENT_SEASON, LEAGUE_IDS, getLeagueIdForSeason as getLeagueIdForSeasonFromConstants } from '@/lib/constants/league';
import { SleeperTransaction, SleeperDraftPick, SleeperRoster, getLeagueTrades, getLeagueRosters, getAllPlayers, getRosterIdToTeamNameMap, getLeagueDrafts, getDraftById, getDraftPicks, getAllLeagueTrades, buildYearToLeagueMapUnique } from '@/lib/utils/sleeper-api';

// Define trade types
export type TradeAsset = {
  type: 'player' | 'pick' | 'faab';
  name: string;
  position?: string;
  team?: string;
  // Stable identifiers (when available)
  playerId?: string; // Sleeper player_id for player assets
  year?: string;
  round?: number;
  draftSlot?: number; // Original draft slot (1..N consistent across rounds)
  value?: number; // For trade value analysis
  // Pick lineage (only for type === 'pick')
  originalOwner?: string; // Canonical team name of original owner of the pick
  became?: string; // Player name the pick turned into (if drafted)
  becamePosition?: string; // Position of the player the pick turned into
  becameTeam?: string; // NFL team of the player the pick turned into
  becamePlayerId?: string; // Sleeper player_id for the drafted player (if available)
  pickInRound?: number; // Exact pick number within the round (1..N), if determinable
  // Structured pick context (for type === 'pick')
  pick?: {
    season: string;
    round: number;
    originalOwner: string;
    currentOwner: string;
  };
  // FAAB-specific metadata (for type === 'faab')
  faabAmount?: number;
};

/**
 * Fetch all trades across all configured seasons
 */
export const fetchTradesAllTime = async (): Promise<Trade[]> => {
  try {
    const transactionsByYear = await getAllLeagueTrades({ forceFresh: true });

    // Map year -> leagueId like sleeper-api does internally
    const yearToLeague = await buildYearToLeagueMapUnique();

    const ctxByLeague = new Map<string, TradeLeagueContext>();
    async function ctxFor(leagueId: string): Promise<TradeLeagueContext> {
      let c = ctxByLeague.get(leagueId);
      if (!c) {
        c = await loadTradeLeagueContext(leagueId);
        ctxByLeague.set(leagueId, c);
      }
      return c;
    }

    if (!playersCache) {
      playersCache = await getAllPlayers();
    }

    const yearChunks = await Promise.all(
      Object.entries(transactionsByYear).map(async ([year, txns]) => {
        const leagueId = yearToLeague[year];
        if (!leagueId) return [] as Trade[];
        const ctx = await ctxFor(leagueId);
        return Promise.all(
          txns.map(async (transaction) => {
            const cacheKey = cacheKeyForTxn(transaction.transaction_id);
            if (tradesCache[cacheKey]) {
              return tradesCache[cacheKey];
            }
            const trade = await convertSleeperTradeToTrade(transaction, leagueId, year, ctx);
            tradesCache[cacheKey] = trade;
            return trade;
          })
        );
      })
    );

    const trades = yearChunks.flat();

    // Merge manual trades (all years)
    const manual = await fetchManualTrades({ all: true });
    if (manual.length) {
      const map = new Map<string, Trade>();
      trades.forEach((t) => map.set(t.id, t));
      for (const m of manual) {
        const id = (m.overrideOf && typeof m.overrideOf === 'string') ? m.overrideOf : m.id;
        map.set(id, m);
      }
      return Array.from(map.values());
    }
    return trades;
  } catch (error) {
    console.error('Error fetching all-time trades:', error);
    return [];
  }
};

export type TradeTeam = {
  name: string;
  assets: TradeAsset[];
  gets?: TradeAsset[];
  gives?: TradeAsset[];
  totalValue?: number;
};

export type Trade = {
  id: string;
  date: string;
  teams: TradeTeam[];
  status: 'completed' | 'pending' | 'vetoed';
  notes?: string;
  relatedTrades?: string[]; // IDs of related trades for trade trees
  // Enriched metadata used by exports and analysis helpers
  season?: string;
  week?: number | null;
  created?: number | null;
  tradeId?: string;
};

// Manual trade payload from our API (superset of Trade with override flags)
type ManualTradeApi = Trade & {
  overrideOf?: string | null;
  active?: boolean;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

async function fetchManualTrades(params?: { year?: string; all?: boolean }): Promise<ManualTradeApi[]> {
  try {
    const sp = new URLSearchParams();
    if (params?.year) sp.set('year', params.year);
    if (params?.all) sp.set('all', '1');
    const url = `/api/manual-trades${sp.toString() ? `?${sp.toString()}` : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const j = (await res.json()) as { trades?: ManualTradeApi[] };
    const arr = Array.isArray(j?.trades) ? j.trades : [];
    // Ensure shape is consistent
    return arr.filter((t) => (t as { id?: unknown }).id && (t as { teams?: unknown }).teams) as ManualTradeApi[];
  } catch {
    return [];
  }
}

export type TradeTreeNode = {
  tradeId: string;
  date: string;
  teams: string[];
  children: TradeTreeNode[];
};

// Cache for player data to avoid repeated API calls
// Using any here is acceptable since we're caching Sleeper API player data with unknown structure
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let playersCache: Record<string, any> | null = null;

// Cache draft context per league-season to avoid repeated Sleeper API calls
type DraftContext = {
  draftId: string;
  draftOrderRosterToSlot: Map<number, number>; // roster_id -> draft slot (when keys are roster ids)
  draftOrderSlotToRoster: Map<number, number>; // draft slot -> roster_id (when keys are slots)
  // Keep raw order as fallback (may be keyed by user_id in some seasons)
  orderRaw: Record<string, number>;
  picks: SleeperDraftPick[];
  // Season context
  ownerIdByRosterId: Map<number, string>;
  rosterCount: number;
};
const draftContextCache: Map<string, Map<string, DraftContext>> = new Map(); // leagueId -> season -> ctx

function getLeagueIdForSeason(season: string): string | null {
  return getLeagueIdForSeasonFromConstants(season);
}

async function getDraftContext(leagueId: string, season: string): Promise<DraftContext | null> {
  try {
    // Check cache
    const bySeason = draftContextCache.get(leagueId) || new Map<string, DraftContext>();
    if (bySeason.has(season)) return bySeason.get(season)!;

    // Find draft for the season
    const drafts = await getLeagueDrafts(leagueId);
    const draft = drafts.find((d) => d.season === season);
    if (!draft) return null;

    // Get draft details (order), picks, and rosters for this season
    const [draftDetails, picks, rosters] = await Promise.all([
      getDraftById(draft.draft_id),
      getDraftPicks(draft.draft_id),
      getLeagueRosters(leagueId),
    ]);
    const orderObj = (draftDetails.draft_order || {}) as Record<string, number>;
    const orderRosterToSlot = new Map<number, number>();
    const orderSlotToRoster = new Map<number, number>();
    for (const [key, val] of Object.entries(orderObj)) {
      const kNum = Number(key);
      const vNum = Number(val);
      if (Number.isFinite(kNum) && Number.isFinite(vNum)) {
        // Populate both interpretations to be robust to API shape
        orderRosterToSlot.set(kNum, vNum);
        orderSlotToRoster.set(vNum, kNum);
      }
    }
    const ownerIdByRosterId = new Map<number, string>();
    for (const r of rosters) ownerIdByRosterId.set(r.roster_id, r.owner_id);

    const ctx: DraftContext = {
      draftId: draft.draft_id,
      draftOrderRosterToSlot: orderRosterToSlot,
      draftOrderSlotToRoster: orderSlotToRoster,
      orderRaw: orderObj,
      picks,
      ownerIdByRosterId,
      rosterCount: rosters.length,
    };
    bySeason.set(season, ctx);
    draftContextCache.set(leagueId, bySeason);
    return ctx;
  } catch (e) {
    console.error('Failed to build draft context:', e);
    return null;
  }
}

type BecameInfo = { name?: string; position?: string; team?: string; pickInRound?: number; playerId?: string; draftSlot?: number };

type TradeLeagueContext = {
  rosterIdToTeam: Map<number, string>;
  rosterMap: Map<number, SleeperRoster>;
};

async function loadTradeLeagueContext(leagueId: string): Promise<TradeLeagueContext> {
  const rosterIdToTeam = await getRosterIdToTeamNameMap(leagueId);
  const rosters = await getLeagueRosters(leagueId);
  const rosterMap = new Map(rosters.map((r) => [r.roster_id, r] as const));
  return { rosterIdToTeam, rosterMap };
}

async function resolvePickBecame(season: string, round: number, originalRosterId: number): Promise<BecameInfo | undefined> {
  const seasonLeagueId = getLeagueIdForSeason(season);
  if (!seasonLeagueId) return undefined;
  const ctx = await getDraftContext(seasonLeagueId, season);
  if (!ctx) return undefined;
  // Determine the original draft slot for the original roster
  let slot = ctx.draftOrderRosterToSlot.get(originalRosterId);
  if (!slot) {
    // Try inverse mapping (slot -> roster)
    for (const [s, rid] of ctx.draftOrderSlotToRoster.entries()) {
      if (rid === originalRosterId) {
        slot = s;
        break;
      }
    }
  }
  if (!slot) {
    // Try via owner_id if draft_order keyed by owner id
    const ownerId = ctx.ownerIdByRosterId.get(originalRosterId);
    if (ownerId) {
      const ownerSlot = ctx.orderRaw[ownerId as unknown as string];
      if (Number.isFinite(Number(ownerSlot))) slot = Number(ownerSlot);
    }
  }
  if (!slot) {
    // Fallback: infer slot from a round 1 pick if available
    const r1 = ctx.picks.find((p) => Number(p.round) === 1 && (p.roster_id === originalRosterId));
    if (r1 && Number.isFinite(Number(r1.draft_slot))) slot = Number(r1.draft_slot);
  }
  if (!slot) return undefined;

  // Find the specific pick in that season/round/slot
  const dp = ctx.picks.find((p) => Number(p.round) === Number(round) && Number(p.draft_slot) === Number(slot));
  // Compute pick number within the round accurately using overall pick_no
  let pickInRound: number | undefined = undefined;
  if (dp && Number.isFinite(Number(dp.pick_no)) && Number.isFinite(Number(ctx.rosterCount)) && ctx.rosterCount > 0) {
    pickInRound = ((Number(dp.pick_no) - 1) % ctx.rosterCount) + 1;
  } else {
    // Fallback to slot when pick_no unavailable
    pickInRound = slot;
  }
  const info: BecameInfo = { pickInRound, draftSlot: slot };
  if (dp && dp.player_id) {
    info.playerId = dp.player_id;
    if (!playersCache) playersCache = await getAllPlayers();
    const pl = playersCache[dp.player_id];
    if (pl) {
      info.name = `${pl.first_name} ${pl.last_name}`.trim();
      info.position = pl.position;
      info.team = pl.team;
    }
  }
  return info;
}

// Sleeper reports 'complete'; the Trade type (and manual trades) use 'completed'.
// Unknown statuses (e.g. 'failed') map to 'pending' so they never pass completed checks.
function normalizeTradeStatus(status: string | undefined): Trade['status'] {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'complete' || s === 'completed') return 'completed';
  if (s === 'vetoed') return 'vetoed';
  return 'pending';
}

// Convert Sleeper transaction to our Trade format
async function convertSleeperTradeToTrade(
  transaction: SleeperTransaction,
  leagueId: string,
  seasonHint?: string,
  preloaded?: TradeLeagueContext,
): Promise<Trade> {
  const rosterIdToTeam = preloaded
    ? preloaded.rosterIdToTeam
    : await getRosterIdToTeamNameMap(leagueId);
  const rosterMap = preloaded
    ? preloaded.rosterMap
    : new Map((await getLeagueRosters(leagueId)).map((r) => [r.roster_id, r] as const));

  // Resolve canonical names in transaction order
  const teamNames = transaction.roster_ids.map((rosterId) => {
    const name = rosterIdToTeam.get(rosterId);
    if (name) return name;
    // Fallback to roster metadata team name if available
    const roster = rosterMap.get(rosterId);
    const metaName = roster?.metadata?.team_name;
    return metaName ? metaName : `Roster ${rosterId}`;
  });

  // Fetch players data if not already cached
  if (!playersCache) {
    playersCache = await getAllPlayers();
  }

  // Create trade teams
  const tradeTeams: TradeTeam[] = [];

  // Process each roster involved in the trade
  for (let i = 0; i < transaction.roster_ids.length; i++) {
    const rosterId = transaction.roster_ids[i];
    const teamName = teamNames[i];
    const assets: TradeAsset[] = [];
    const gets: TradeAsset[] = [];
    const gives: TradeAsset[] = [];

    // Process player adds (players received by this team)
    if (transaction.adds) {
      Object.entries(transaction.adds).forEach(([playerId, receivingRosterId]) => {
        if (receivingRosterId === rosterId) {
          const player = playersCache?.[playerId];
          if (player) {
            const senderRosterId = Number(transaction.drops?.[playerId]);
            const senderName = Number.isFinite(senderRosterId)
              ? (rosterIdToTeam.get(senderRosterId) || rosterMap.get(senderRosterId)?.metadata?.team_name || `Roster ${senderRosterId}`)
              : undefined;
            const baseAsset: TradeAsset = {
              type: 'player',
              name: `${player.first_name} ${player.last_name}`,
              position: player.position,
              team: player.team || 'FA',
              playerId: playerId
            };
            assets.push(baseAsset);
            gets.push({
              ...baseAsset,
              name: senderName && senderName !== teamName ? `${baseAsset.name} (from ${senderName})` : baseAsset.name,
            });
          }
        }
      });
    }

    // Process players given by this team
    if (transaction.drops) {
      Object.entries(transaction.drops).forEach(([playerId, droppingRosterId]) => {
        if (droppingRosterId === rosterId) {
          const player = playersCache?.[playerId];
          if (player) {
            const receiverRosterId = Number(transaction.adds?.[playerId]);
            const receiverName = Number.isFinite(receiverRosterId)
              ? (rosterIdToTeam.get(receiverRosterId) || rosterMap.get(receiverRosterId)?.metadata?.team_name || `Roster ${receiverRosterId}`)
              : undefined;
            gives.push({
              type: 'player',
              name: receiverName && receiverName !== teamName
                ? `${player.first_name} ${player.last_name} → ${receiverName}`
                : `${player.first_name} ${player.last_name}`,
              position: player.position,
              team: player.team || 'FA',
              playerId,
            });
          }
        }
      });
    }

    // Process draft picks received by this team
    if (transaction.draft_picks) {
      const picksReceived = transaction.draft_picks
        .filter((pick) => {
          const ownerId = Number((pick as { owner_id?: number | string }).owner_id);
          const prevOwnerId = Number((pick as { previous_owner_id?: number | string }).previous_owner_id);
          const thisRoster = Number(rosterId);
          if (!Number.isFinite(ownerId) || !Number.isFinite(thisRoster)) return false;
          // A received pick is any pick whose post-trade owner is this roster
          // and whose previous owner differs (strictly by numeric value).
          return ownerId === thisRoster && prevOwnerId !== thisRoster;
        });
      for (const pick of picksReceived) {
        const originalRosterId = Number((pick as { roster_id?: number | string }).roster_id);
        const originalOwnerName = rosterIdToTeam.get(originalRosterId) || (rosterMap.get(originalRosterId)?.metadata?.team_name ?? `Roster ${originalRosterId}`);
        let became: string | undefined = undefined;
        let becamePosition: string | undefined = undefined;
        let becameTeam: string | undefined = undefined;
        let pickInRound: number | undefined = undefined;
        let becamePlayerId: string | undefined = undefined;
        let draftSlot: number | undefined = undefined;
        try {
          const info = await resolvePickBecame(String(pick.season), Number(pick.round), originalRosterId);
          if (info) {
            became = info.name;
            becamePosition = info.position;
            becameTeam = info.team;
            pickInRound = info.pickInRound;
            becamePlayerId = info.playerId;
            draftSlot = info.draftSlot;
          }
        } catch {
          // Non-fatal
        }
        const basePickName = `${pick.season} ${getOrdinal(pick.round)} Round Pick${originalOwnerName && originalOwnerName !== teamName ? ` (${originalOwnerName}'s slot)` : ''}`;
        const senderRosterId = Number((pick as { previous_owner_id?: number | string }).previous_owner_id);
        const senderName = Number.isFinite(senderRosterId)
          ? (rosterIdToTeam.get(senderRosterId) || rosterMap.get(senderRosterId)?.metadata?.team_name || `Roster ${senderRosterId}`)
          : undefined;
        const baseAsset: TradeAsset = {
          type: 'pick',
          name: basePickName,
          year: pick.season,
          round: pick.round,
          draftSlot,
          originalOwner: originalOwnerName,
          became,
          becamePosition,
          becameTeam,
          becamePlayerId,
          pickInRound,
          pick: {
            season: String(pick.season),
            round: pick.round,
            originalOwner: originalOwnerName,
            currentOwner: teamName,
          },
        };
        assets.push(baseAsset);
        gets.push({
          ...baseAsset,
          name: senderName && senderName !== teamName ? `${baseAsset.name} (from ${senderName})` : baseAsset.name,
        });
      }

      const picksGiven = transaction.draft_picks
        .filter((pick) => Number((pick as { previous_owner_id?: number | string }).previous_owner_id) === Number(rosterId));
      for (const pick of picksGiven) {
        const ownerId = Number((pick as { owner_id?: number | string }).owner_id);
        const receiverName = Number.isFinite(ownerId)
          ? (rosterIdToTeam.get(ownerId) || rosterMap.get(ownerId)?.metadata?.team_name || `Roster ${ownerId}`)
          : undefined;
        const originalRosterId = Number((pick as { roster_id?: number | string }).roster_id);
        const originalOwnerName = rosterIdToTeam.get(originalRosterId) || (rosterMap.get(originalRosterId)?.metadata?.team_name ?? `Roster ${originalRosterId}`);
        const pickName = `${pick.season} ${getOrdinal(pick.round)} Round Pick${originalOwnerName && originalOwnerName !== teamName ? ` (${originalOwnerName}'s slot)` : ''}`;
        gives.push({
          type: 'pick',
          name: receiverName && receiverName !== teamName ? `${pickName} → ${receiverName}` : pickName,
          year: pick.season,
          round: pick.round,
          originalOwner: originalOwnerName,
          pick: {
            season: String(pick.season),
            round: pick.round,
            originalOwner: originalOwnerName,
            currentOwner: receiverName || `Roster ${ownerId}`,
          },
        });
      }
    }

    // Add FAAB if applicable
    if (transaction.waiver_budget) {
      transaction.waiver_budget
        .filter(budget => budget.receiver === rosterId)
        .forEach(budget => {
          const amt = Number(budget.amount ?? 0) || 0;
          const senderName = rosterIdToTeam.get(budget.sender) || rosterMap.get(budget.sender)?.metadata?.team_name || `Roster ${budget.sender}`;
          const baseAsset: TradeAsset = {
            type: 'faab',
            name: `$${amt} FAAB`,
            faabAmount: amt,
          };
          assets.push(baseAsset);
          gets.push({
            ...baseAsset,
            name: senderName && senderName !== teamName ? `$${amt} FAAB from ${senderName}` : baseAsset.name,
          });
        });
      transaction.waiver_budget
        .filter(budget => budget.sender === rosterId)
        .forEach(budget => {
          const amt = Number(budget.amount ?? 0) || 0;
          const receiverName = rosterIdToTeam.get(budget.receiver) || rosterMap.get(budget.receiver)?.metadata?.team_name || `Roster ${budget.receiver}`;
          gives.push({
            type: 'faab',
            name: receiverName && receiverName !== teamName ? `$${amt} FAAB → ${receiverName}` : `$${amt} FAAB`,
            faabAmount: amt,
          });
        });
    }

    tradeTeams.push({
      name: teamName,
      assets,
      gets,
      gives,
    });
  }

  // Create the trade object with enriched metadata
  const created = Number(transaction.created ?? 0) || 0;
  // Sleeper uses `leg` for NFL week; treat non-positive as null/offseason
  const legRaw = Number((transaction as { leg?: number }).leg ?? 0);
  const week = Number.isFinite(legRaw) && legRaw > 0 ? legRaw : null;
  const season = seasonHint || (created ? new Date(created).getFullYear().toString() : undefined);
  return {
    id: transaction.transaction_id,
    date: new Date(created || Number(transaction.created ?? Date.now())).toISOString().split('T')[0],
    teams: tradeTeams,
    status: normalizeTradeStatus(transaction.status),
    relatedTrades: [], // We'll populate this later if needed
    season,
    week,
    created: created || null,
    tradeId: transaction.transaction_id,
  };
}

// Helper function to get ordinal suffix
function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Cache for converted trades
const tradesCache: Record<string, Trade> = {};
// v4: trade status normalized ('complete' → 'completed') at conversion
const TRADES_CACHE_VERSION = 'v4';
const cacheKeyForTxn = (txnId: string) => `${TRADES_CACHE_VERSION}:${txnId}`;

/* Sample trades removed - replaced with real Sleeper API data */
/*
  'trade-001': {
    id: 'trade-001',
    date: '2025-07-10',
    teams: [
      {
        name: TEAM_NAMES[0], // Belltown Raptors
        assets: [
          { type: 'player', name: 'Justin Jefferson', position: 'WR', team: 'MIN', value: 95 },
          { type: 'pick', name: '2026 2nd Round Pick', year: '2026', round: 2, value: 15 }
        ],
        totalValue: 110
      },
      {
        name: TEAM_NAMES[1], // Double Trouble
        assets: [
          { type: 'player', name: 'Ja\'Marr Chase', position: 'WR', team: 'CIN', value: 92 },
          { type: 'pick', name: '2026 3rd Round Pick', year: '2026', round: 3, value: 10 }
        ],
        totalValue: 102
      }
    ],
    status: 'completed',
    notes: 'A blockbuster WR swap between two contending teams. Both Jefferson and Chase are considered elite dynasty assets, with Jefferson having a slight edge in value due to his consistent production.',
    relatedTrades: ['trade-004']
  },
  'trade-002': {
    id: 'trade-002',
    date: '2025-06-22',
    teams: [
      {
        name: 'Kittle Me This',
        assets: [
          { type: 'player', name: 'Travis Kelce', position: 'TE', team: 'KC', value: 40 },
          { type: 'player', name: 'Rachaad White', position: 'RB', team: 'TB', value: 25 }
        ],
        totalValue: 65
      },
      {
        name: TEAM_NAMES[3], // Mt. Lebanon Cake Eaters
        assets: [
          { type: 'player', name: 'George Kittle', position: 'TE', team: 'SF', value: 35 },
          { type: 'player', name: 'Javonte Williams', position: 'RB', team: 'DEN', value: 20 },
          { type: 'pick', name: '2026 1st Round Pick', year: '2026', round: 1, value: 25 }
        ],
        totalValue: 80
      }
    ],
    status: 'completed',
    notes: 'Kittle Me This is making a win-now move with Kelce, while Waddle Waddle gets younger at TE and adds future draft capital.',
    relatedTrades: []
  },
  'trade-003': {
    id: 'trade-003',
    date: '2025-05-15',
    teams: [
      {
        name: TEAM_NAMES[4], // Belleview Badgers
        assets: [
          { type: 'player', name: 'Nick Chubb', position: 'RB', team: 'CLE', value: 35 },
          { type: 'pick', name: '2026 4th Round Pick', year: '2026', round: 4, value: 5 }
        ],
        totalValue: 40
      },
      {
        name: 'Lamb Chops',
        assets: [
          { type: 'player', name: 'Tony Pollard', position: 'RB', team: 'DAL', value: 30 },
          { type: 'pick', name: '2026 2nd Round Pick', year: '2026', round: 2, value: 15 }
        ],
        totalValue: 45
      }
    ],
    status: 'completed',
    notes: 'A running back swap with Chubb Thumpers getting the more established but older RB in Chubb, while Lamb Chops gets a younger option plus draft capital.',
    relatedTrades: ['trade-007']
  },
  'trade-004': {
    id: 'trade-004',
    date: '2024-11-10',
    teams: [
      {
        name: TEAM_NAMES[6], // Detroit Dawgs
        assets: [
          { type: 'player', name: 'Joe Mixon', position: 'RB', team: 'CIN', value: 28 }
        ],
        totalValue: 28
      },
      {
        name: 'Najee By Nature',
        assets: [
          { type: 'player', name: 'Najee Harris', position: 'RB', team: 'PIT', value: 25 },
          { type: 'pick', name: '2025 3rd Round Pick', year: '2025', round: 3, value: 10 }
        ],
        totalValue: 35
      }
    ],
    status: 'completed',
    notes: 'A mid-season RB swap with Mixon It Up getting the more productive back for a playoff push.',
    relatedTrades: ['trade-001', 'trade-008']
  },
  'trade-005': {
    id: 'trade-005',
    date: '2024-10-28',
    teams: [
      {
        name: TEAM_NAMES[8], // Minshew's Maniacs
        assets: [
          { type: 'player', name: 'Jalen Hurts', position: 'QB', team: 'PHI', value: 75 },
          { type: 'pick', name: '2025 2nd Round Pick', year: '2025', round: 2, value: 15 }
        ],
        totalValue: 90
      },
      {
        name: TEAM_NAMES[9], // Red Pandas
        assets: [
          { type: 'player', name: 'Patrick Mahomes', position: 'QB', team: 'KC', value: 85 }
        ],
        totalValue: 85
      }
    ],
    status: 'completed',
    notes: 'A swap of elite QBs with Chase-ing Wins getting the slightly more valuable Mahomes, while Hurts So Good gets Hurts plus draft capital.',
    relatedTrades: []
  },
  'trade-006': {
    id: 'trade-006',
    date: '2024-09-15',
    teams: [
      {
        name: TEAM_NAMES[10], // The Lone Ginger
        assets: [
          { type: 'player', name: 'Justin Herbert', position: 'QB', team: 'LAC', value: 70 },
          { type: 'player', name: 'Mike Williams', position: 'WR', team: 'LAC', value: 15 }
        ],
        totalValue: 85
      },
      {
        name: TEAM_NAMES[11], // Maholmes and Watson
        assets: [
          { type: 'player', name: 'Kyle Pitts', position: 'TE', team: 'ATL', value: 30 },
          { type: 'player', name: 'Tua Tagovailoa', position: 'QB', team: 'MIA', value: 40 },
          { type: 'pick', name: '2025 1st Round Pick', year: '2025', round: 1, value: 25 }
        ],
        totalValue: 95
      }
    ],
    status: 'completed',
    notes: 'Herbert the Pervert consolidates value at QB, while Pitts and Giggles gets a high-upside TE, a serviceable QB, and valuable draft capital.',
    relatedTrades: []
  },
  'trade-007': {
    id: 'trade-007',
    date: '2024-08-20',
    teams: [
      {
        name: TEAM_NAMES[5], // BeerNeverBrokeMyHeart
        assets: [
          { type: 'player', name: 'Nick Chubb', position: 'RB', team: 'CLE', value: 35 }
        ],
        totalValue: 35
      },
      {
        name: TEAM_NAMES[10], // The Lone Ginger
        assets: [
          { type: 'player', name: 'Austin Ekeler', position: 'RB', team: 'LAC', value: 25 },
          { type: 'pick', name: '2025 3rd Round Pick', year: '2025', round: 3, value: 10 }
        ],
        totalValue: 35
      }
    ],
    status: 'completed',
    notes: 'Lamb Chops acquires Nick Chubb shortly after trading for him, flipping him for Ekeler and a pick.',
    relatedTrades: ['trade-003']
  },
  'trade-008': {
    id: 'trade-008',
    date: '2024-07-15',
    teams: [
      {
        name: TEAM_NAMES[7], // bop pop
        assets: [
          { type: 'player', name: 'Joe Mixon', position: 'RB', team: 'CIN', value: 28 },
          { type: 'pick', name: '2025 4th Round Pick', year: '2025', round: 4, value: 5 }
        ],
        totalValue: 33
      },
      {
        name: TEAM_NAMES[2], // Elemental Heroes
        assets: [
          { type: 'player', name: 'Jonathan Taylor', position: 'RB', team: 'IND', value: 45 }
        ],
        totalValue: 45
      }
    ],
    status: 'completed',
    notes: 'Najee By Nature acquires Mixon before flipping him to Mixon It Up later in the season.',
    relatedTrades: ['trade-004']
  }
};

/**
 * Fetch trades for a specific year
 * @param year The year to filter trades by
 * @returns Array of trades for the specified year
 */
export const fetchTradesByYear = async (year: string): Promise<Trade[]> => {
  try {
    // Map the provided year to the correct league ID
    const leagueId = getLeagueIdForSeasonFromConstants(year);
    if (!leagueId) {
      console.error(`No league ID found for year ${year}`);
      return [];
    }
    
    const sleeperTrades = await getLeagueTrades(leagueId, { forceFresh: true });
    const ctx = await loadTradeLeagueContext(leagueId);

    if (!playersCache) {
      playersCache = await getAllPlayers();
    }

    const trades = await Promise.all(
      sleeperTrades.map(async (transaction) => {
        const cacheKey = cacheKeyForTxn(transaction.transaction_id);
        if (tradesCache[cacheKey]) {
          return tradesCache[cacheKey];
        }
        const trade = await convertSleeperTradeToTrade(transaction, leagueId, year, ctx);
        tradesCache[cacheKey] = trade;
        return trade;
      })
    );

    // Merge manual trades for this year
    const manual = await fetchManualTrades({ year });
    if (manual.length) {
      const map = new Map<string, Trade>();
      trades.forEach((t) => map.set(t.id, t));
      for (const m of manual) {
        const id = (m.overrideOf && typeof m.overrideOf === 'string') ? m.overrideOf : m.id;
        map.set(id, m);
      }
      return Array.from(map.values());
    }
    return trades;
  } catch (error) {
    console.error('Error fetching trades by year:', error);
    return [];
  }
};

/**
 * Fetch a specific trade by ID
 * @param id The trade ID to fetch
 * @returns The trade object or null if not found
 */
export const fetchTradeById = async (id: string): Promise<Trade | null> => {
  try {
    // Check manual trades (overrides/additions) first
    try {
      const manual = await fetchManualTrades({ all: true });
      const hit = manual.find((t) => t.id === id || t.overrideOf === id);
      if (hit) return hit;
    } catch {
      // ignore and fallback to Sleeper
    }
    
    // Check if the trade is already in the cache
    const byIdKey = cacheKeyForTxn(id);
    if (tradesCache[byIdKey]) {
      return tradesCache[byIdKey];
    }
    
    // If not in cache, we need to fetch all trades and find it
    // This is inefficient but necessary since we don't know which league the trade belongs to
    const yearToLeague = await buildYearToLeagueMapUnique();

    for (const leagueId of Object.values(yearToLeague)) {
      const sleeperTrades = await getLeagueTrades(leagueId, { forceFresh: true });
      const transaction = sleeperTrades.find(t => t.transaction_id === id);
      if (transaction) {
        const trade = await convertSleeperTradeToTrade(transaction, leagueId);
        tradesCache[cacheKeyForTxn(id)] = trade;
        return trade;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching trade by ID:', error);
    return null;
  }
};

/**
 * Build trade trees from real trade data
 * @returns Array of trade tree nodes
 */
export const buildTradeTrees = async (): Promise<TradeTreeNode[]> => {
  try {
    // Fetch all trades from all years
    const allTrades: Trade[] = [];
    
    const years = [CURRENT_SEASON, ...Object.keys(LEAGUE_IDS.PREVIOUS || {})];
    for (const yearKey of years) {
      const yearTrades = await fetchTradesByYear(yearKey);
      allTrades.push(...yearTrades);
    }
    
    // For now, we don't have related trades information from the Sleeper API
    // So we'll return an empty array until we implement a way to determine related trades
    return [];
    
    // In a real implementation, we would analyze the trades to find related ones
    // For example, trades involving the same draft picks or players within a short time period
  } catch (error) {
    console.error('Error building trade trees:', error);
    return [];
  }
};

/**
 * Get related trades for a specific trade
 * @param tradeId The trade ID to get related trades for
 * @returns Array of related trade objects
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const getRelatedTrades = async (_tradeId: string): Promise<Trade[]> => {
  // Parameter is prefixed with underscore to indicate it's intentionally unused
  try {
    // For now, we don't have related trades information from the Sleeper API
    // In a real implementation, we would analyze the trades to find related ones
    return [];
  } catch (error) {
    console.error('Error getting related trades:', error);
    return [];
  }
};
