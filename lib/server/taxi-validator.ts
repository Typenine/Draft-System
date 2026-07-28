import { LEAGUE_IDS, IMPORTANT_DATES } from '@/lib/constants/league';
import { getTeamsData, getLeagueRosters, getAllPlayersCached, getLeagueTransactionsAllWeeks, getLeagueMatchups, SleeperTransaction, getNFLState, getLeagueDrafts, getDraftPicks, buildYearToLeagueMapUnique, type SleeperPlayer } from '@/lib/utils/sleeper-api';
import { resolveCanonicalTeamName } from '@/lib/utils/team-utils';
import { upsertTenure, deleteTenure, markTenureActive, bulkInsertTxnCacheWithPrune, getFirstTaxiSeenForPlayer, getTaxiObservation, setTaxiObservation } from '@/server/db/queries';
import { getObjectText } from '@/server/storage/r2';

export type Violation = { code: 'too_many_on_taxi' | 'too_many_qbs' | 'invalid_intake' | 'boomerang_active_player' | 'boomerang_reset_ineligible' | 'roster_inconsistent'; detail?: string; players?: string[] };

export type TaxiValidateResult = {
  team: { teamName: string; rosterId: number; selectedSeason: string };
  current: { taxi: Array<{ playerId: string; name: string | null; position: string | null; joinedAt?: string | null; joinedWeek?: number | null; firstTaxiAt?: string | null; firstTaxiWeek?: number | null }>; counts: { total: number; qbs: number } };
  compliant: boolean;
  violations: Violation[];
};

function getLeagueIdForSeason(season: string): string | null {
  // Use current NFL season logic, not calendar year
  const now = new Date();
  const currentYear = now.getFullYear();
  // NFL season spans two calendar years (e.g., 2025 season starts Sept 2025, ends Feb 2026)
  // If we're before March, the NFL season year is the previous calendar year
  const nflSeasonYear = now.getMonth() < 2 ? currentYear - 1 : currentYear;
  
  if (season === String(nflSeasonYear)) return LEAGUE_IDS.CURRENT;
  const prev = (LEAGUE_IDS.PREVIOUS as Record<string, string | undefined>)[season];
  return prev || null;
}

/**
 * Determine if we're in the offseason (taxi reset window).
 * Per rulebook 5.5(e): "During each offseason, a team may place a first-year or second-year player..."
 * Offseason = after league year ends (after Week 17) until NFL Week 1 kickoff.
 * This is more restrictive than draft-to-Week1; it's specifically the offseason period.
 */
function isInOffseason(): boolean {
  const now = new Date();
  const seasonStart = IMPORTANT_DATES.NFL_WEEK_1_START;
  
  // Simple check: if we're before Week 1 kickoff and after February (Super Bowl)
  // This covers the offseason period when reset is allowed
  const currentYear = now.getFullYear();
  
  // Offseason is roughly Feb-Sept (after Super Bowl, before Week 1)
  // More precisely: after league year ends through Week 1 kickoff
  if (now < seasonStart) {
    // We're before Week 1 - check if we're in the offseason window
    // Offseason starts after Super Bowl (early Feb) and runs until Week 1
    const superBowlApprox = new Date(currentYear, 1, 1); // Feb 1
    return now >= superBowlApprox;
  }
  
  return false;
}

/**
 * Check if a player is eligible for the offseason reset exception.
 * Per rulebook 5.5(e)(1): "a player remains eligible for the offseason reset until the kickoff 
 * of Week 1 of the NFL regular season of what would be the player's third NFL season."
 * 
 * This means:
 * - Rookie (year 1): Eligible through Week 1 of their 2nd season
 * - 2nd year: Eligible through Week 1 of their 3rd season  
 * - 3rd year+: NOT eligible (becomes ineligible at Week 1 kickoff of 3rd season)
 */
function isEligibleForOffseasonReset(player: SleeperPlayer | undefined, currentNFLSeason: number): boolean {
  if (!player) return false;
  
  // Check rookie_year first (most reliable)
  if (player.rookie_year !== undefined) {
    const rookieYear = Number(player.rookie_year);
    if (Number.isFinite(rookieYear)) {
      // Calculate which NFL season would be their third
      const thirdSeasonYear = rookieYear + 2;
      
      // Player is eligible if we haven't reached their third season yet
      // OR if we're in their third season but before Week 1 kickoff
      if (currentNFLSeason < thirdSeasonYear) {
        return true; // Still in year 1 or 2
      } else if (currentNFLSeason === thirdSeasonYear) {
        // We're in their third season - check if Week 1 has kicked off
        const now = new Date();
        const week1Kickoff = IMPORTANT_DATES.NFL_WEEK_1_START;
        return now < week1Kickoff; // Eligible until Week 1 kickoff
      }
      // currentNFLSeason > thirdSeasonYear - player is 3+ years, not eligible
      return false;
    }
  }
  
  // Fallback to years_exp (0 = rookie, 1 = second year)
  // Note: years_exp is less precise for the "until Week 1 of third season" rule
  if (player.years_exp !== undefined) {
    const yearsExp = Number(player.years_exp);
    if (yearsExp === 0 || yearsExp === 1) {
      return true; // First or second year
    }
  }
  
  return false;
}

function toVia(tx: SleeperTransaction['type'] | string): 'free_agent' | 'waiver' | 'trade' | 'draft' | 'other' {
  if (tx === 'free_agent') return 'free_agent';
  if (tx === 'waiver') return 'waiver';
  if (tx === 'trade') return 'trade';
  if (tx === 'draft') return 'draft';
  // Default to free_agent for any unknown type to avoid 'unknown' intakes in our logic
  return 'free_agent';
}

export async function validateTaxiForRoster(selectedSeason: string, selectedRosterId: number): Promise<TaxiValidateResult | null> {
  const leagueId = getLeagueIdForSeason(String(selectedSeason));
  if (!leagueId) return null;

  // Map rosterId -> team name (canonical)
  const teams = await getTeamsData(leagueId).catch(() => [] as Array<{ rosterId: number; ownerId: string; teamName: string }>
  );
  const thisTeam = teams.find((t) => t.rosterId === selectedRosterId) || null;
  const canonicalName = thisTeam ? resolveCanonicalTeamName({ ownerId: thisTeam.ownerId }) : `Roster ${selectedRosterId}`;

  // Current rosters to read taxi/reserve/players (treat missing as [])
  const rosters = await getLeagueRosters(leagueId).catch(() => [] as Array<{ roster_id: number; players?: string[]; starters?: string[]; reserve?: string[]; taxi?: string[] }>);
  const r = rosters.find((rr) => rr.roster_id === selectedRosterId) || { players: [], reserve: [], taxi: [] } as { players?: string[]; reserve?: string[]; taxi?: string[] };
  const taxiArr: string[] = Array.isArray(r.taxi) ? (r.taxi as string[]).filter(Boolean) : [];

  // Establish current NFL week for transaction fallback
  let currentWeek = 0;
  try {
    const st = await getNFLState();
    const wk = Number((st as { week?: number }).week || 0) || 0;
    currentWeek = wk;
  } catch {}

  // starters/reserve used only for same-week inconsistencies which we no longer flag

  // Seed txn_cache + tenures from transactions across seasons for this franchise
  const yearToLeague = await buildYearToLeagueMapUnique();
  const seasons = Object.keys(yearToLeague).sort();
  const rosterIdBySeason = new Map<string, number>();
  for (const y of seasons) {
    const lid = yearToLeague[y];
    try {
      const ts = await getTeamsData(lid).catch(() => [] as Array<{ rosterId: number; ownerId: string; teamName: string }>);
      const row = ts.find((t) => t.teamName === canonicalName) || (thisTeam ? ts.find((t) => t.ownerId === thisTeam.ownerId) : undefined);
      if (row) rosterIdBySeason.set(y, row.rosterId);
    } catch {}
  }

  const rowsForCache: Array<{ week: number; teamId: string; playerId: string; type: string; direction: string; ts: Date }> = [];
  const lastJoin = new Map<string, { ts: number; week: number; via: 'free_agent' | 'waiver' | 'trade' | 'draft' | 'other' }>();
  for (const y of seasons) {
    const lid = yearToLeague[y];
    const rid = rosterIdBySeason.get(y);
    if (!lid || !rid) continue;
    const txnsRaw = await getLeagueTransactionsAllWeeks(lid).catch(() => [] as SleeperTransaction[]);
    const txns = [...txnsRaw].sort((a, b) => Number(a?.created || 0) - Number(b?.created || 0));
    for (const tx of txns) {
      if (!tx || tx.status !== 'complete') continue;
      const weekRaw = Number(tx.leg || 0);
      const week = weekRaw > 0 ? weekRaw : (currentWeek || 0);
      const created = Number(tx.created || 0);
      if (tx.adds) {
        for (const [pid, recv] of Object.entries(tx.adds)) {
          if (recv === rid) {
            const via = toVia(tx.type);
            rowsForCache.push({ week, teamId: canonicalName, playerId: pid, type: tx.type, direction: 'in', ts: new Date(created) });
            const prev = lastJoin.get(pid);
            if (!prev || created > prev.ts) lastJoin.set(pid, { ts: created, week, via });
            try { await upsertTenure({ teamId: canonicalName, playerId: pid, acquiredAt: new Date(created), acquiredVia: via }); } catch {}
          }
        }
      }
      if (tx.drops) {
        for (const [pid, from] of Object.entries(tx.drops)) {
          if (from === rid) {
            rowsForCache.push({ week, teamId: canonicalName, playerId: pid, type: tx.type, direction: 'out', ts: new Date(created) });
            // Drop resets tenure until next join
            const prev = lastJoin.get(pid);
            if (!prev || created >= prev.ts) lastJoin.delete(pid);
            try { await deleteTenure({ teamId: canonicalName, playerId: pid }); } catch {}
          }
        }
      }
    }
    // Also consider draft picks as acquisition events to avoid unknown intake
    try {
      const drafts = await getLeagueDrafts(lid).catch(() => []);
      for (const d of drafts) {
        const picks = await getDraftPicks(d.draft_id).catch(() => []);
        for (const p of picks) {
          const pid = p.player_id;
          if (!pid) continue;
          if (p.roster_id === rid) {
            // Approximate draft timestamp early May of season; week as 1
            const created = Date.parse(`${y}-05-01T00:00:00Z`);
            const week = 1;
            rowsForCache.push({ week, teamId: canonicalName, playerId: pid, type: 'draft', direction: 'in', ts: new Date(created) });
            const prev = lastJoin.get(pid);
            if (!prev || created > prev.ts) lastJoin.set(pid, { ts: created, week, via: 'draft' });
            try { await upsertTenure({ teamId: canonicalName, playerId: pid, acquiredAt: new Date(created), acquiredVia: 'draft' }); } catch {}
          }
        }
      }
    } catch {}
  }
  await bulkInsertTxnCacheWithPrune(rowsForCache).catch(() => 0);

  // Check boomerang using prior locked weeks (exclude current week)
  if (!currentWeek) {
    try {
      const st2 = await getNFLState();
      currentWeek = Number((st2 as { week?: number }).week || 0) || 0;
    } catch {}
  }
  const lastLockedWeek = currentWeek > 1 ? currentWeek - 1 : 0;
  const weeks = lastLockedWeek > 0 ? Array.from({ length: lastLockedWeek }, (_, i) => i + 1) : [];
  const weekly = await Promise.all(weeks.map((w) => getLeagueMatchups(leagueId, w).catch(() => [] as Array<{ matchup_id?: number; roster_id?: number; starters?: string[]; players?: string[]; points?: number; custom_points?: number }>)));
  const appearedSinceJoin = new Set<string>();
  for (let wi = 0; wi < weekly.length; wi++) {
    const matches = weekly[wi] || [] as Array<{ matchup_id?: number; roster_id?: number; starters?: string[]; players?: string[]; points?: number; custom_points?: number }>;
    const matchupWeek = weeks[wi] || 0;
    const m = matches.find((mm) => mm && mm.roster_id === selectedRosterId);
    if (!m) continue;
    const startersRaw = Array.isArray(m.starters) ? (m.starters as string[]) : [];
    const starters = new Set<string>(startersRaw.filter(Boolean));
    // Prefer snapshot for full breakdown (starters/bench/reserve). If missing, only trust starters.
    let ids = new Set<string>(Array.from(starters));
    try {
      const key = `logs/lineups/snapshots/${String(selectedSeason)}-W${matchupWeek}.json`;
      const txt = await getObjectText({ key });
      if (txt) {
        const j = JSON.parse(txt) as { meta?: { schemaVersion?: number }; teams?: Array<{ rosterId: number; starters?: string[]; bench?: string[]; reserve?: string[] }> };
        const ver = Number(j?.meta?.schemaVersion || 1);
        if (Number.isFinite(ver) && ver >= 2) {
          const row = (j.teams || []).find((t) => t.rosterId === selectedRosterId);
          if (row) {
            const st = Array.isArray(row.starters) ? row.starters.filter(Boolean) : [];
            const bn = Array.isArray(row.bench) ? row.bench.filter(Boolean) : [];
            const ir = Array.isArray(row.reserve) ? row.reserve.filter(Boolean) : [];
            if (st.length + bn.length + ir.length > 0) ids = new Set<string>([...st, ...bn, ...ir]);
          }
        }
      }
    } catch {}
    // Only consider appearances if the matchup was played (points recorded)
    const opp = matches.find((x) => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id);
    const myPts = Number((m.custom_points ?? m.points ?? 0) || 0);
    const oppPts = Number((opp?.custom_points ?? opp?.points ?? 0) || 0);
    const played = (myPts > 0) || (oppPts > 0);
    if (!played) continue;
    const nonTaxiSet = ids;
    for (const pid of nonTaxiSet) {
      const lj = lastJoin.get(pid);
      if (!lj) continue;
      const recentMs = 7 * 24 * 60 * 60 * 1000;
      const joinWeekEff = (Date.now() - lj.ts < recentMs && currentWeek) ? currentWeek : lj.week;
      if (matchupWeek >= joinWeekEff) appearedSinceJoin.add(pid);
      await markTenureActive({ teamId: canonicalName, playerId: pid }).catch(() => null);
    }
  }

  // Players meta for positions and eligibility
  const playersMeta = await getAllPlayersCached().catch(() => ({} as Record<string, SleeperPlayer>));
  
  // Determine current NFL season for player year calculations
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentNFLSeason = now.getMonth() < 2 ? currentYear - 1 : currentYear;
  const inOffseason = isInOffseason();

  // Violations
  const violations: Violation[] = [];
  
  // Rule: Max 4 players on taxi at any time
  if (taxiArr.length > 4) violations.push({ code: 'too_many_on_taxi', detail: `${taxiArr.length} players on taxi (max 4)` });
  
  // Rule: Max 1 QB on taxi at any time
  const taxiQbIds = taxiArr.filter((pid) => (playersMeta[pid]?.position || '').toUpperCase() === 'QB');
  const taxiQbs = taxiQbIds.length;
  if (taxiQbs > 1) violations.push({ code: 'too_many_qbs', detail: `${taxiQbs} QBs on taxi (max 1)`, players: taxiQbIds });

  // Do not compute roster_inconsistent; Sleeper ensures a player is only in one bucket at a time

  const invalidIntake: string[] = [];
  const boomerang: string[] = [];
  const boomerangResetIneligible: string[] = [];
  
  // Check each taxi player for violations
  for (const pid of taxiArr) {
    const lj = lastJoin.get(pid);
    if (lj && !['free_agent', 'waiver', 'trade', 'draft'].includes(lj.via)) invalidIntake.push(pid);
    
    // Boomerang check per rulebook:
    // 5.5(c): "Once a player is Taxi Activated, that player may not be placed back on taxi 
    //          while the player remains rostered by that team."
    // 5.5(d): "A player who leaves the team's roster entirely may be placed on taxi again 
    //          only if the team later reacquires the player..."
    // → Base rule: Only check activation during CURRENT tenure (since last acquisition)
    //
    // 5.5(e): "During each offseason, a team may place a first-year or second-year player on taxi 
    //          even if that player was previously Taxi Activated by that team."
    // → Offseason exception: During offseason, 1st/2nd year players can go on taxi even if activated
    
    const appearedInCurrentTenure = appearedSinceJoin.has(pid);
    
    if (appearedInCurrentTenure) {
      // Player was activated during current tenure (since last acquisition)
      // Check if offseason reset exception applies
      if (inOffseason) {
        const player = playersMeta[pid];
        const isEligible = isEligibleForOffseasonReset(player, currentNFLSeason);
        if (isEligible) {
          // 5.5(e) exception: Allowed during offseason for 1st/2nd year players
          continue;
        } else {
          // Not eligible for reset exception (3+ year player or past Week 1 of third season)
          boomerangResetIneligible.push(pid);
        }
      } else {
        // Outside offseason - standard 5.5(c) boomerang violation
        boomerang.push(pid);
      }
    }
  }
  
  if (invalidIntake.length > 0) violations.push({ code: 'invalid_intake', detail: 'Taxi intake must be FA/Trade/Draft', players: invalidIntake });
  if (boomerang.length > 0) violations.push({ code: 'boomerang_active_player', detail: 'Previously active this tenure on taxi (outside offseason)', players: boomerang });
  if (boomerangResetIneligible.length > 0) violations.push({ code: 'boomerang_reset_ineligible', detail: 'Previously active, not eligible for offseason reset (3+ year player or past Week 1 of 3rd season)', players: boomerangResetIneligible });

  const seasonNum = Number(selectedSeason) || new Date().getFullYear();
  // Update taxi observations for this team (throttled)
  let obsPlayers: Record<string, { firstSeen: string; lastSeen: string; seenCount: number }> = {};
  try {
    const existing = await getTaxiObservation(canonicalName).catch(() => null as (null | { updatedAt?: Date | string; players?: Record<string, { firstSeen: string; lastSeen: string; seenCount: number }> }));
    obsPlayers = (existing?.players as typeof obsPlayers) || {};
    const prevUpdated = existing?.updatedAt ? (typeof existing.updatedAt === 'string' ? Date.parse(existing.updatedAt) : (existing.updatedAt as Date).getTime()) : 0;
    const now = new Date();
    const nowIso = now.toISOString();
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    const stale = !prevUpdated || (now.getTime() - prevUpdated) > twelveHoursMs;
    const prevSet = new Set(Object.keys(obsPlayers));
    const curSet = new Set(taxiArr);
    let changed = false;
    for (const id of curSet) if (!prevSet.has(id)) { changed = true; break; }
    if (!changed) {
      for (const id of prevSet) if (!curSet.has(id)) { changed = true; break; }
    }
    if (changed || stale) {
      for (const pid of taxiArr) {
        const prev = obsPlayers[pid];
        if (prev) {
          obsPlayers[pid] = { firstSeen: prev.firstSeen, lastSeen: nowIso, seenCount: (prev.seenCount || 0) + 1 };
        } else {
          obsPlayers[pid] = { firstSeen: nowIso, lastSeen: nowIso, seenCount: 1 };
        }
      }
      await setTaxiObservation(canonicalName, { updatedAt: now, players: obsPlayers }).catch(() => null);
    }
  } catch {}
  const items = [] as Array<{ playerId: string; name: string | null; position: string | null; joinedAt?: string | null; joinedWeek?: number | null; firstTaxiAt?: string | null; firstTaxiWeek?: number | null }>;
  for (const pid of taxiArr) {
    const name = playersMeta[pid] ? `${playersMeta[pid].first_name || ''} ${playersMeta[pid].last_name || ''}`.trim() : null;
    const position = playersMeta[pid]?.position || null;
    const lj = lastJoin.get(pid);
    let firstTaxiAt: string | null = null;
    let firstTaxiWeek: number | null = null;
    try {
      const first = await getFirstTaxiSeenForPlayer({ season: seasonNum, teamId: canonicalName, playerId: pid });
      if (first) {
        firstTaxiAt = new Date(first.runTs).toISOString();
        firstTaxiWeek = first.week;
      }
    } catch {}
    if (!firstTaxiAt) {
      const obs = obsPlayers[pid];
      if (obs?.firstSeen) firstTaxiAt = obs.firstSeen;
    }
    if (!firstTaxiAt) {
      firstTaxiAt = new Date().toISOString();
    }
    items.push({
      playerId: pid,
      name,
      position,
      joinedAt: lj ? new Date(lj.ts).toISOString() : null,
      joinedWeek: lj?.week ?? null,
      firstTaxiAt,
      firstTaxiWeek,
    });
  }

  const teamLabel = thisTeam?.teamName || canonicalName;
  const hardCodes = new Set<Violation['code']>(['too_many_on_taxi','too_many_qbs','invalid_intake','roster_inconsistent']);
  const hardViolationCount = violations.filter(v => hardCodes.has(v.code)).length;
  const out: TaxiValidateResult = {
    team: { teamName: teamLabel, rosterId: selectedRosterId, selectedSeason: String(selectedSeason) },
    current: { taxi: items, counts: { total: items.length, qbs: taxiQbs } },
    compliant: hardViolationCount === 0,
    violations,
  };
  return out;
}
