import { getTeamsData, getLeagueMatchups, getLeagueTransactionsAllWeeks, getAllPlayersCached, SleeperTransaction, getLeagueRosters, getNFLState, buildYearToLeagueMapUnique } from '@/lib/utils/sleeper-api';
import { getObjectText } from '@/server/storage/r2';
import { resolveCanonicalTeamName } from '@/lib/utils/team-utils';

export type TaxiLimits = { maxSlots: number; maxQB: number };
export type TaxiPlayer = {
  playerId: string;
  name: string | null;
  position?: string | null;
  sinceTs?: string | null; // approx: last join date for this team when not activated since
  activatedSinceJoin: boolean; // after join AND week played
  potentialActivatedSinceJoin?: boolean; // after join but week not yet played
  activatedAt?: { year: string; week: number } | null;
  onTaxiSince?: { year: string; week: number } | null;
  // Details when ineligible
  ineligibleReason?: string | null;
  potentialAt?: { year: string; week: number } | null;
};

export type TaxiAnalysis = {
  team: { ownerId: string; teamName: string; selectedSeason: string; rosterId: number };
  limits: TaxiLimits;
  current: { taxi: TaxiPlayer[]; counts: { total: number; qbs: number } };
  violations: { overSlots: boolean; overQB: boolean; ineligibleOnTaxi: string[] };
};

/**
 * Compute taxi analysis for a franchise across seasons and return status for the selected season's roster.
 * - A player is ineligible for taxi if they have appeared in any matchup for this franchise since their last join event
 *   and have not left the franchise in between (carries across seasons).
 */
export async function computeTaxiAnalysisForRoster(selectedSeason: string, selectedRosterId: number): Promise<TaxiAnalysis | null> {
  const yearToLeague = await buildYearToLeagueMapUnique();
  const leagueId = yearToLeague[selectedSeason] || null;
  if (!leagueId) return null;

  // Resolve the franchise owner and canonical team name from selected season
  const teams = await getTeamsData(leagueId).catch(() => []);
  const thisTeam = teams.find((t) => t.rosterId === selectedRosterId);
  if (!thisTeam) return null;
  const ownerId = thisTeam.ownerId;
  const canonicalName = resolveCanonicalTeamName({ ownerId });

  // Build mapping of season -> rosterId for this franchise using canonical name
  const seasons: string[] = Object.keys(yearToLeague).sort();
  const rosterIdBySeason = new Map<string, number>();
  // Optional snapshot loader to include reserve (IR) per week if an admin created a snapshot
  const snapshotCache = new Map<string, Map<number, { starters: string[]; bench: string[]; reserve: string[] }>>();
  async function loadSnapshot(year: string, week: number): Promise<Map<number, { starters: string[]; bench: string[]; reserve: string[] }> | null> {
    const key = `${year}-W${week}`;
    if (snapshotCache.has(key)) return snapshotCache.get(key)!;
    try {
      const path = `logs/lineups/snapshots/${year}-W${week}.json`;
      const txt = await getObjectText({ key: path });
      if (!txt) { snapshotCache.set(key, new Map()); return null; }
      const j = JSON.parse(txt);
      const schemaVersion = Number(j?.meta?.schemaVersion || 1);
      if (!Number.isFinite(schemaVersion) || schemaVersion < 2) {
        snapshotCache.set(key, new Map());
        return null;
      }
      const map = new Map<number, { starters: string[]; bench: string[]; reserve: string[] }>();
      const teams = (j?.teams as Array<{ rosterId: number; starters: string[]; bench: string[]; reserve?: string[] }> | undefined) || [];
      for (const t of teams) {
        map.set(t.rosterId, {
          starters: Array.isArray(t.starters) ? t.starters : [],
          bench: Array.isArray(t.bench) ? t.bench : [],
          reserve: Array.isArray(t.reserve) ? t.reserve : [],
        });
      }
      snapshotCache.set(key, map);
      return map;
    } catch {
      snapshotCache.set(key, new Map());
      return null;
    }
  }

  for (const year of seasons) {
    const lid = yearToLeague[year];
    if (!lid) continue;
    try {
      const ts = await getTeamsData(lid);
      const seasonTeam = ts.find((t) => t.teamName === canonicalName) || ts.find((t) => t.ownerId === ownerId);
      if (seasonTeam) rosterIdBySeason.set(year, seasonTeam.rosterId);
    } catch {}
  }

  // Build per-season appearances: player -> { [yearWeek]: true }
  const appearedSinceJoin = new Map<string, { activated: boolean; when?: { year: string; week: number }; reason?: 'lineup' | 'bench' | 'ir' }>();
  const potentialSinceJoin = new Map<string, { pending: boolean; when?: { year: string; week: number }; reason?: 'lineup' | 'bench' | 'ir' }>();
  // Build last join (timestamp + season/week) per player across seasons for this franchise
  const lastJoin = new Map<string, { ts: number; year: string; week: number }>();

  for (const year of seasons) {
    const lid = yearToLeague[year];
    const rid = rosterIdBySeason.get(year);
    if (!lid || !rid) continue;

    // Transactions -> join/leave timestamps (track latest join; remove if a later drop occurs)
    try {
      const txns = await getLeagueTransactionsAllWeeks(lid);
      for (const txn of txns as SleeperTransaction[]) {
        if (!txn || txn.status !== 'complete') continue;
        const created = Number(txn.created || 0) || 0;
        const legWeek = Number(txn.leg || 0) || 0;
        // joins: adds[playerId] === rid
        if (txn.adds) {
          for (const [pid, recv] of Object.entries(txn.adds)) {
            if (recv === rid) {
              const prev = lastJoin.get(pid);
              if (!prev || created > prev.ts) {
                lastJoin.set(pid, { ts: created, year, week: legWeek });
              }
            }
          }
        }
        // leaves: drops[playerId] === rid
        if (txn.drops) {
          for (const [pid, from] of Object.entries(txn.drops)) {
            if (from === rid) {
              const prev = lastJoin.get(pid);
              if (!prev || created >= prev.ts) {
                // Leaving after the last join resets eligibility until a future join
                lastJoin.delete(pid);
                appearedSinceJoin.delete(pid);
              }
            }
          }
        }
      }
    } catch {}

    // Weekly matchups -> appearance markers for this roster
    try {
      // Determine current NFL week and whether the activation window is open (Thu–Mon ET)
      let currentSeason: string | null = null;
      let currentWeek: number | null = null;
      let windowOpen = false;
      try {
        const st = await getNFLState();
        currentSeason = String(st.season || '');
        currentWeek = typeof st.week === 'number' ? st.week : null;
        const now = new Date();
        const dowET = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' }).format(now);
        windowOpen = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon'].includes(dowET);
      } catch {}
      const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
      const weekly = await Promise.all(weeks.map((w) => getLeagueMatchups(lid, w).catch(() => [] as Array<{ matchup_id?: number; roster_id?: number; players?: string[]; starters?: string[]; points?: number; custom_points?: number }>)));
      for (let wi = 0; wi < weekly.length; wi++) {
        const week = wi + 1;
        const mus = weekly[wi] as Array<{ matchup_id?: number; roster_id?: number; players?: string[]; starters?: string[]; points?: number; custom_points?: number }>;
        const m = mus.find((mm) => mm.roster_id === rid);
        if (!m) continue;
        // Prefer admin-created weekly snapshot if available; else, fallback to Sleeper weekly data
        const starters = new Set<string>((m.starters || []).filter(Boolean) as string[]);
        const snap = await loadSnapshot(year, week).catch(() => null);
        const extra = snap?.get(rid);
        const isCurrentSeason = (currentSeason && currentSeason === year);
        const isRecentWeek = isCurrentSeason && (typeof currentWeek === 'number' && currentWeek !== null) ? (week >= (currentWeek! - 1)) : false;
        let ids = new Set<string>();
        let inStarters = (pid: string) => starters.has(pid);
        let inReserve: (pid: string) => boolean = () => false;
        const canTrustExtra = Boolean(extra && (extra.starters.length > 0 || extra.bench.length > 0 || extra.reserve.length > 0) && isRecentWeek);
        if (canTrustExtra) {
          ids = new Set<string>([...extra!.starters, ...extra!.bench, ...extra!.reserve].filter(Boolean));
          inStarters = (pid: string) => extra!.starters.includes(pid);
          inReserve = (pid: string) => extra!.reserve.includes(pid);
        } else {
          // Fallback: only starters for older weeks or when snapshot is missing
          ids = new Set<string>(Array.from(starters));
        }
        if (ids.size === 0) continue;
        // Determine if this matchup was played (either side scored > 0)
        const opp = mus.find((x) => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id);
        const myPts = Number((m.custom_points ?? m.points ?? 0) || 0);
        const oppPts = Number((opp?.custom_points ?? opp?.points ?? 0) || 0);
        const played = (myPts > 0) || (oppPts > 0);
        for (const pid of ids) {
          const lj = lastJoin.get(pid);
          if (!lj) continue;
          // Only consider appearances on/after the join point
          const isAfterJoin = lj.year === year ? (week >= lj.week) : true;
          if (!isAfterJoin) continue;
          // Classify reason: reserve -> ir; starters -> lineup; else -> bench
          const reason: 'lineup' | 'bench' | 'ir' = inReserve(pid) ? 'ir' : (inStarters(pid) ? 'lineup' : 'bench');
          if (played) {
            const prev = appearedSinceJoin.get(pid);
            if (!prev || !prev.activated) {
              appearedSinceJoin.set(pid, { activated: true, when: { year, week }, reason });
            }
            // Clear any pending potential flag since it's now actual
            potentialSinceJoin.delete(pid);
          } else {
            // Only surface potential during the current active NFL week and only within Thu–Mon ET window
            const isCurrentContext = (currentSeason && currentSeason === year) && (currentWeek && currentWeek === week);
            if (isCurrentContext && windowOpen) {
              const prevP = potentialSinceJoin.get(pid);
              if (!prevP || !prevP.pending) potentialSinceJoin.set(pid, { pending: true, when: { year, week }, reason });
            }
          }
        }
      }
    } catch {}
  }

  // Current season roster taxi list
  const selectedSeasonRosterId = rosterIdBySeason.get(selectedSeason) || selectedRosterId;
  let taxiIds: string[] = [];
  try {
    const rosters = await getLeagueRosters(leagueId);
    const cur = rosters.find((r) => r.roster_id === selectedSeasonRosterId) as unknown as { taxi?: unknown } | undefined;
    const rawTaxi = Array.isArray(cur?.taxi) ? (cur?.taxi as unknown[]) : [];
    taxiIds = (rawTaxi as string[]).filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {}

  // Enrich with player meta
  const players = await getAllPlayersCached().catch(() => ({} as Record<string, { first_name?: string; last_name?: string; position?: string }>));

  // Build taxi players list with eligibility and approximate sinceTs
  const items: TaxiPlayer[] = taxiIds.map((pid) => {
    const name = players[pid] ? `${players[pid].first_name || ''} ${players[pid].last_name || ''}`.trim() : null;
    const position = players[pid]?.position || null;
    const activated = appearedSinceJoin.get(pid);
    const lj = lastJoin.get(pid);
    return {
      playerId: pid,
      name,
      position,
      sinceTs: lj ? new Date(lj.ts).toISOString() : null,
      activatedSinceJoin: Boolean(activated?.activated),
      potentialActivatedSinceJoin: potentialSinceJoin.has(pid),
      activatedAt: activated?.when || null,
      onTaxiSince: lj && lj.week > 0 ? { year: lj.year, week: lj.week } : null,
      ineligibleReason: activated?.activated ? (activated?.reason === 'ir' ? 'Activated on IR' : activated?.reason === 'lineup' ? 'Activated in lineup' : 'Activated on bench') : null,
      potentialAt: potentialSinceJoin.get(pid)?.when || null,
    };
  });

  // Limits per your rules
  const limits: TaxiLimits = { maxSlots: 3, maxQB: 1 };
  const counts = {
    total: items.length,
    qbs: items.filter((p) => (p.position || '').toUpperCase() === 'QB').length,
  };

  const violations = {
    overSlots: counts.total > limits.maxSlots,
    overQB: counts.qbs > limits.maxQB,
    ineligibleOnTaxi: items.filter((p) => p.activatedSinceJoin).map((p) => p.playerId),
  };

  return {
    team: { ownerId, teamName: canonicalName, selectedSeason, rosterId: selectedSeasonRosterId },
    limits,
    current: { taxi: items, counts },
    violations,
  };
}
