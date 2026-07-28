/**
 * Sleeper API utility functions
 * 
 * This file contains utilities for fetching data from the Sleeper API
 * using the provided league IDs.
 */

import { LEAGUE_IDS, CHAMPIONS, getLeagueIdForSeason } from '../constants/league';
import { resolveCanonicalTeamName } from '../utils/team-utils';

// Base URL for Sleeper API
const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

// Shared fetch options to control timeout, retries, and cancellation
export interface SleeperFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;      // default 8000ms
  retries?: number;        // number of retry attempts on retryable errors (default 2)
  retryDelayMs?: number;   // base delay before first retry (default 300ms), exponential backoff with jitter
  // When true, bypass in-memory caches in this module and add a cache-busting param to requests
  forceFresh?: boolean;
}

export async function getAllLeagueTransactions(options?: SleeperFetchOptions): Promise<Record<string, SleeperTransaction[]>> {
  try {
    const transactionsByYear: Record<string, SleeperTransaction[]> = {};
    const yearToLeague = await buildYearToLeagueMapUnique(options);
    for (const [year, leagueId] of Object.entries(yearToLeague)) {
      const transactions = await getLeagueTransactionsAllWeeks(leagueId, options);
      transactionsByYear[year] = transactions;
    }
    return transactionsByYear;
  } catch (error) {
    console.error('Error fetching all league transactions:', error);
    throw error;
  }
}

// ==========================
// Roster reconstruction from matchups
// ==========================
/**
 * Build a set of player IDs who appeared on a given roster (starters or bench)
 * for a season by scanning weekly matchups (Weeks 1–17).
 */
export async function buildSeasonRosterFromMatchups(
  season: string,
  leagueId: string,
  rosterId: number,
  options?: SleeperFetchOptions
): Promise<Set<string>> {
  type Match = { roster_id?: number; starters?: string[]; players?: string[] };
  const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
  const roster = new Set<string>();
  const all = await Promise.all(
    weeks.map((w) => getLeagueMatchups(leagueId, w, options).catch(() => [] as Match[]))
  );
  for (const weekMatches of all) {
    for (const m of weekMatches as Match[]) {
      if (!m || m.roster_id !== rosterId) continue;
      if (Array.isArray(m.starters)) for (const pid of m.starters) if (pid) roster.add(pid);
      if (Array.isArray(m.players)) for (const pid of m.players) if (pid) roster.add(pid);
    }
  }
  return roster;
}

// ==========================
// Weekly Highs by Season (per week top single-team)
// ==========================
export interface WeeklyHighByWeekEntry {
  week: number;
  teamName: string;
  ownerId: string;
  rosterId: number;
  points: number;
  opponentTeamName: string;
  opponentOwnerId: string;
  opponentRosterId: number;
  opponentPoints: number;
}

/**
 * For a given season string (e.g., '2025','2024','2023'), compute each week's highest
 * single-team score within that season's configured league. Weeks with no scoring are skipped.
 */
export async function getWeeklyHighsBySeason(
  season: string,
  options?: SleeperFetchOptions
): Promise<WeeklyHighByWeekEntry[]> {
  const y2l = await buildYearToLeagueMapUnique(options);
  const leagueId = y2l[season];
  if (!leagueId) return [];

  // Determine regular-season length using league settings (playoff start week - 1)
  const league = await getLeague(leagueId, options).catch(
    () => null as { settings?: { playoff_week_start?: number; playoff_start_week?: number } } | null
  );
  const settings = (league?.settings || {}) as { playoff_week_start?: number; playoff_start_week?: number };
  const startWeek = Number(settings.playoff_week_start ?? settings.playoff_start_week ?? 15);
  const regularWeeks = Math.max(1, startWeek - 1);

  const rosters = await getLeagueRosters(leagueId, options);
  const rosterOwner = new Map<number, string>();
  for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);
  const rosterIdToName = await getRosterIdToTeamNameMap(leagueId, options).catch(() => new Map<number, string>());

  const results: WeeklyHighByWeekEntry[] = [];
  const weeks = Array.from({ length: regularWeeks }, (_, i) => i + 1);
  const allWeekMatchups = await Promise.all(
    weeks.map((w) => getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[]))
  );

  for (let idx = 0; idx < allWeekMatchups.length; idx++) {
    const week = idx + 1;
    const matchups = allWeekMatchups[idx] || [];
    if (matchups.length === 0) continue;

    // Group by matchup_id into pairs
    const byId = new Map<number, SleeperMatchup[]>();
    for (const m of matchups) {
      const arr = byId.get(m.matchup_id) || [];
      arr.push(m);
      byId.set(m.matchup_id, arr);
    }

    // Build candidate entries for both sides of each matchup
    const candidates: WeeklyHighByWeekEntry[] = [];
    for (const pair of byId.values()) {
      if (!pair || pair.length < 2) continue;
      const [a, b] = pair;
      const aPts = a.custom_points ?? a.points ?? 0;
      const bPts = b.custom_points ?? b.points ?? 0;
      // Skip scheduled/unplayed matchups (both 0)
      if ((aPts ?? 0) === 0 && (bPts ?? 0) === 0) continue;

      const aOwner = rosterOwner.get(a.roster_id);
      const bOwner = rosterOwner.get(b.roster_id);
      if (!aOwner || !bOwner) continue;
      const aName = rosterIdToName.get(a.roster_id) || resolveCanonicalTeamName({ ownerId: aOwner });
      const bName = rosterIdToName.get(b.roster_id) || resolveCanonicalTeamName({ ownerId: bOwner });

      candidates.push({
        week,
        teamName: aName,
        ownerId: aOwner,
        rosterId: a.roster_id,
        points: aPts,
        opponentTeamName: bName,
        opponentOwnerId: bOwner,
        opponentRosterId: b.roster_id,
        opponentPoints: bPts,
      });
      candidates.push({
        week,
        teamName: bName,
        ownerId: bOwner,
        rosterId: b.roster_id,
        points: bPts,
        opponentTeamName: aName,
        opponentOwnerId: aOwner,
        opponentRosterId: a.roster_id,
        opponentPoints: aPts,
      });
    }

    if (candidates.length === 0) continue;
    let maxPts = -Infinity;
    for (const c of candidates) if (c.points > maxPts) maxPts = c.points;
    // Push all tied weekly-high winners for this week
    for (const c of candidates) if (c.points === maxPts) results.push(c);
  }

  // Only include weeks with scoring; keep ascending by week
  results.sort((a, b) => a.week - b.week);
  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Type guards for safe error inspection without using 'any'
function hasName(x: unknown): x is { name?: string } {
  return typeof x === 'object' && x !== null && 'name' in x;
}
function hasCode(x: unknown): x is { code?: string } {
  return typeof x === 'object' && x !== null && 'code' in x;
}

/**
 * Internal helper to perform fetch with timeout + retry + cancellation.
 * Retries on network errors, timeouts, and 5xx responses.
 */
async function sleeperFetchJson<T = unknown>(
  url: string,
  init?: RequestInit,
  opts?: SleeperFetchOptions
): Promise<T> {
  const retries = Math.max(0, opts?.retries ?? 2);
  const baseDelay = Math.max(0, opts?.retryDelayMs ?? 300);
  const timeoutMs = Math.max(1, opts?.timeoutMs ?? 8000);

  // allow retries unless aborted by caller's signal
  let abortedByCaller = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    if (opts?.signal) {
      signals.push(opts.signal);
      if (opts.signal.aborted) {
        abortedByCaller = true;
        controller.abort();
      } else {
        const onAbort = () => {
          abortedByCaller = true;
          controller.abort();
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...(init || {}), signal: controller.signal });
      if (!resp.ok) {
        // Retry on 5xx, 429 (rate limit), and 408 (request timeout)
        const retryable = resp.status >= 500 || resp.status === 429 || resp.status === 408;
        if (retryable && attempt < retries && !abortedByCaller) {
          // Respect Retry-After for 429 when present (seconds)
          let delay = baseDelay * Math.pow(2, attempt);
          if (resp.status === 429) {
            const ra = resp.headers.get('retry-after');
            const raSec = ra ? Number(ra) : NaN;
            if (Number.isFinite(raSec) && raSec > 0) delay = Math.max(delay, raSec * 1000);
          }
          const jitter = Math.random() * 100;
          await sleep(delay + jitter);
          continue;
        }
        throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
      }
      return (await resp.json()) as T;
    } catch (err: unknown) {
      // If explicitly aborted by caller, do not retry
      const isAbort = abortedByCaller
        || (err instanceof DOMException && err.name === 'AbortError')
        || (hasName(err) && err.name === 'AbortError');
      if (abortedByCaller) {
        throw err;
      }
      // Retry on timeout/network/abort (not by caller)
      const isNetTimeout = hasCode(err) && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT');
      if (attempt < retries && (isAbort || isNetTimeout)) {
        const jitter = Math.random() * 100;
        await sleep(baseDelay * Math.pow(2, attempt) + jitter);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  // Should be unreachable
  throw new Error(`Failed to fetch ${url}`);
}

// Types for Sleeper API responses
export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  settings: Record<string, unknown>;
  scoring_settings: Record<string, unknown>;
  roster_positions: string[];
  status: string;
  total_rosters: number;
  draft_id: string;
  metadata: Record<string, unknown>;
}

/**
 * Fetch NFL weekly stats from Sleeper and cache them briefly.
 * Example endpoint (pattern inferred from season stats):
 *   https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}
 */
export async function getNFLWeekStats(
  season: string | number,
  week: number,
  ttlMs: number = 15 * 60 * 1000,
  options?: SleeperFetchOptions
): Promise<Record<string, SleeperNFLSeasonPlayerStats>> {
  const key = `${season}-${week}`;
  const now = Date.now();
  const cached = weekStatsCache[key];
  if (cached && now - cached.ts < ttlMs) return cached.data;

  const url = `${SLEEPER_API_BASE}/stats/nfl/regular/${season}/${week}`;
  const json = await sleeperFetchJson<Record<string, SleeperNFLSeasonPlayerStats>>(url, undefined, options);
  weekStatsCache[key] = { ts: now, data: json };
  return json;
}

/**
 * Sleeper NFL state object (subset used)
 */
export interface SleeperNFLState {
  week?: number;
  season?: string;
  season_type?: string;
  display_week?: number;
  league_season?: string;
  previous_season?: string;
  season_start_date?: string; // ISO date string
  season_has_scores?: boolean;
}

let nflStateCache: { ts: number; data: SleeperNFLState } | null = null;
const NFL_STATE_TTL_DEFAULT = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch current NFL state from Sleeper (cached).
 */
export async function getNFLState(ttlMs: number = NFL_STATE_TTL_DEFAULT, options?: SleeperFetchOptions): Promise<SleeperNFLState> {
  const now = Date.now();
  if (!options?.forceFresh && nflStateCache && now - nflStateCache.ts < ttlMs) return nflStateCache.data;
  const bust = options?.forceFresh ? `?t=${now}` : '';
  const data = await sleeperFetchJson<SleeperNFLState>(`${SLEEPER_API_BASE}/state/nfl${bust}`, undefined, options);
  nflStateCache = { ts: now, data };
  return data;
}

/**
 * Build a dynamic, unique mapping of season year -> leagueId.
 * - Current season resolves to LEAGUE_IDS.CURRENT
 * - Previous season (current-1) resolves from LEAGUE_IDS.PREVIOUS when available
 * - Older seasons from PREVIOUS are included only if not already present
 */
export async function buildYearToLeagueMapUnique(options?: SleeperFetchOptions): Promise<Record<string, string>> {
  let seasonNum = new Date().getFullYear();
  try {
    const st = await getNFLState(undefined, options);
    const s = Number((st as { season?: string | number }).season ?? seasonNum);
    if (Number.isFinite(s)) seasonNum = s;
  } catch {}

  const map: Record<string, string> = {};
  if (LEAGUE_IDS.CURRENT) map[String(seasonNum)] = LEAGUE_IDS.CURRENT;

  // Offseason backfill: when the calendar year advances before LEAGUE_IDS rotates,
  // still resolve last season string to CURRENT league id so queries for the last
  // completed season (e.g., '2025') continue to work.
  const lastSeasonStr = String(seasonNum - 1);
  if (LEAGUE_IDS.CURRENT && !map[lastSeasonStr]) {
    const prevMapProbe = (LEAGUE_IDS.PREVIOUS as Record<string, string | undefined>) || {};
    if (!prevMapProbe[lastSeasonStr]) {
      map[lastSeasonStr] = LEAGUE_IDS.CURRENT;
    }
  }

  const prevMap = LEAGUE_IDS.PREVIOUS as Record<string, string | undefined>;
  const prevYear = String(seasonNum - 1);
  if (prevMap?.[prevYear]) map[prevYear] = prevMap[prevYear] as string;

  for (const [y, lid] of Object.entries(prevMap || {})) {
    if (!(y in map) && lid) map[y] = lid;
  }
  return map;
}

/**
 * Get all unique owner IDs that have participated across configured seasons
 */
export async function getAllOwnerIdsAcrossSeasons(options?: SleeperFetchOptions): Promise<string[]> {
  const yearToLeague = await buildYearToLeagueMapUnique(options);
  const ownerSet = new Set<string>();
  for (const leagueId of Object.values(yearToLeague)) {
    if (!leagueId) continue;
    const rosters = await getLeagueRosters(leagueId, options);
    for (const r of rosters) ownerSet.add(r.owner_id);
  }
  return Array.from(ownerSet);
}

export interface FranchiseSummary {
  ownerId: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  totalPF: number;
  totalPA: number;
  avgPF: number;
  avgPA: number;
  championships: number;
}

/**
 * Compute franchise summaries (all-time) for every owner across seasons
 */
export async function getFranchisesAllTime(options?: SleeperFetchOptions): Promise<FranchiseSummary[]> {
  const owners = await getAllOwnerIdsAcrossSeasons(options);
  const results: FranchiseSummary[] = [];
  for (const ownerId of owners) {
    const stats = await getTeamAllTimeStatsByOwner(ownerId, options);
    const teamName = resolveCanonicalTeamName({ ownerId });
    // Count championships by canonical team name
    let champs = 0;
    for (const year of Object.keys(CHAMPIONS)) {
      const champName = CHAMPIONS[year as keyof typeof CHAMPIONS]?.champion;
      if (champName && champName !== 'TBD' && champName === teamName) champs += 1;
    }
    results.push({
      ownerId,
      teamName,
      wins: stats.wins,
      losses: stats.losses,
      ties: stats.ties,
      totalPF: stats.totalPF,
      totalPA: stats.totalPA,
      avgPF: stats.avgPF,
      avgPA: stats.avgPA,
      championships: champs,
    });
  }
  // Sort alphabetically by team name for stable display
  results.sort((a, b) => a.teamName.localeCompare(b.teamName));
  return results;
}

export interface LeagueRecordBook {
  highestScoringGame: {
    points: number;
    teamName: string;
    ownerId: string;
    week: number;
    year: string;
  } | null;
  lowestScoringGame: {
    points: number;
    teamName: string;
    ownerId: string;
    week: number;
    year: string;
  } | null;
  biggestVictory: {
    margin: number;
    winnerTeamName: string;
    winnerOwnerId: string;
    loserTeamName: string;
    loserOwnerId: string;
    week: number;
    year: string;
  } | null;
  closestVictory: {
    margin: number;
    winnerTeamName: string;
    winnerOwnerId: string;
    loserTeamName: string;
    loserOwnerId: string;
    week: number;
    year: string;
  } | null;
  highestCombined: {
    combined: number;
    teamAName: string;
    teamAOwnerId: string;
    teamAPoints: number;
    teamBName: string;
    teamBOwnerId: string;
    teamBPoints: number;
    week: number;
    year: string;
  } | null;
  longestWinStreak: {
    length: number;
    ownerId: string;
    teamName: string;
    start: { year: string; week: number };
    end: { year: string; week: number };
  } | null;
  longestLosingStreak: {
    length: number;
    ownerId: string;
    teamName: string;
    start: { year: string; week: number };
    end: { year: string; week: number };
  } | null;
}

/**
 * Compute league record book across all seasons using weekly matchups
 */
export async function getLeagueRecordBook(options?: SleeperFetchOptions): Promise<LeagueRecordBook> {
  const yearToLeague = await buildYearToLeagueMapUnique(options);

  let highestScoringGame: LeagueRecordBook['highestScoringGame'] = null;
  let lowestScoringGame: LeagueRecordBook['lowestScoringGame'] = null;
  let biggestVictory: LeagueRecordBook['biggestVictory'] = null;
  let closestVictory: LeagueRecordBook['closestVictory'] = null;
  let highestCombined: LeagueRecordBook['highestCombined'] = null;
  let longestWinStreak: LeagueRecordBook['longestWinStreak'] = null;
  let longestLosingStreak: LeagueRecordBook['longestLosingStreak'] = null;

  // Track chronological results per owner across seasons
  const timelineByOwner = new Map<string, Array<{ year: string; week: number; result: 'W' | 'L' | 'T' }>>();

  // Iterate seasons in chronological order to support streak computation
  const sortedYears = Object.keys(yearToLeague).sort();
  for (const year of sortedYears) {
    const leagueId = yearToLeague[year];
    if (!leagueId) continue;
    const rosters = await getLeagueRosters(leagueId, options);
    const rosterOwner = new Map<number, string>();
    for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);
    const rosterIdToName = await getRosterIdToTeamNameMap(leagueId, options);

    const weekPromises = Array.from({ length: 17 }, (_, i) => i + 1).map((w) => getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[]));
    const allWeekMatchups = await Promise.all(weekPromises);

    for (const weekIdx in allWeekMatchups) {
      const week = Number(weekIdx) + 1;
      const matchups = allWeekMatchups[weekIdx as unknown as number] || [];
      if (matchups.length === 0) continue;

      // Group by matchup_id to ensure pairs
      const byId = new Map<number, SleeperMatchup[]>();
      for (const m of matchups) {
        const arr = byId.get(m.matchup_id) || [];
        arr.push(m);
        byId.set(m.matchup_id, arr);
      }

      for (const pair of byId.values()) {
        if (!pair || pair.length < 2) continue;
        const [a, b] = pair;
        const aPts = a.custom_points ?? a.points ?? 0;
        const bPts = b.custom_points ?? b.points ?? 0;
        // Skip unplayed 0-0
        if ((aPts ?? 0) === 0 && (bPts ?? 0) === 0) continue;

        const aOwner = rosterOwner.get(a.roster_id)!;
        const bOwner = rosterOwner.get(b.roster_id)!;
        const aName = rosterIdToName.get(a.roster_id) || resolveCanonicalTeamName({ ownerId: aOwner });
        const bName = rosterIdToName.get(b.roster_id) || resolveCanonicalTeamName({ ownerId: bOwner });

        // Highest and lowest single-team
        if (!highestScoringGame || aPts > highestScoringGame.points) {
          highestScoringGame = { points: aPts, teamName: aName, ownerId: aOwner, week, year };
        }
        if (!highestScoringGame || bPts > highestScoringGame.points) {
          highestScoringGame = { points: bPts, teamName: bName, ownerId: bOwner, week, year };
        }
        if (!lowestScoringGame || aPts < lowestScoringGame.points) {
          lowestScoringGame = { points: aPts, teamName: aName, ownerId: aOwner, week, year };
        }
        if (!lowestScoringGame || bPts < lowestScoringGame.points) {
          lowestScoringGame = { points: bPts, teamName: bName, ownerId: bOwner, week, year };
        }

        // Victory margins (ignore ties)
        const margin = Math.abs(aPts - bPts);
        if (margin > 0) {
          const winnerIsA = aPts > bPts;
          const winnerName = winnerIsA ? aName : bName;
          const winnerOwner = winnerIsA ? aOwner : bOwner;
          const loserName = winnerIsA ? bName : aName;
          const loserOwner = winnerIsA ? bOwner : aOwner;

          if (!biggestVictory || margin > biggestVictory.margin) {
            biggestVictory = { margin, winnerTeamName: winnerName, winnerOwnerId: winnerOwner, loserTeamName: loserName, loserOwnerId: loserOwner, week, year };
          }
          if (!closestVictory || margin < closestVictory.margin) {
            closestVictory = { margin, winnerTeamName: winnerName, winnerOwnerId: winnerOwner, loserTeamName: loserName, loserOwnerId: loserOwner, week, year };
          }
        }

        // Highest combined score
        const combined = aPts + bPts;
        if (!highestCombined || combined > highestCombined.combined) {
          highestCombined = {
            combined,
            teamAName: aName,
            teamAOwnerId: aOwner,
            teamAPoints: aPts,
            teamBName: bName,
            teamBOwnerId: bOwner,
            teamBPoints: bPts,
            week,
            year,
          };
        }

        // Append to chronological timelines for streak computation
        const resA: 'W' | 'L' | 'T' = aPts > bPts ? 'W' : aPts < bPts ? 'L' : 'T';
        const resB: 'W' | 'L' | 'T' = bPts > aPts ? 'W' : bPts < aPts ? 'L' : 'T';
        if (!timelineByOwner.has(aOwner)) timelineByOwner.set(aOwner, []);
        if (!timelineByOwner.has(bOwner)) timelineByOwner.set(bOwner, []);
        timelineByOwner.get(aOwner)!.push({ year, week, result: resA });
        timelineByOwner.get(bOwner)!.push({ year, week, result: resB });
      }
    }
  }

  // Compute win and losing streaks across entire timelines
  for (const [ownerId, timeline] of timelineByOwner.entries()) {
    // timeline already in chronological order (years asc, weeks asc)
    let curW = 0;
    let curL = 0;
    let curWStart: { year: string; week: number } | null = null;
    let curLStart: { year: string; week: number } | null = null;

    for (const node of timeline) {
      if (node.result === 'W') {
        // extend win streak, reset loss
        curW += 1;
        if (curW === 1) curWStart = { year: node.year, week: node.week };
        curL = 0;
        curLStart = null;
        if (!longestWinStreak || curW > longestWinStreak.length) {
          longestWinStreak = {
            length: curW,
            ownerId,
            teamName: resolveCanonicalTeamName({ ownerId }),
            start: curWStart!,
            end: { year: node.year, week: node.week },
          };
        }
      } else if (node.result === 'L') {
        // extend losing streak, reset win
        curL += 1;
        if (curL === 1) curLStart = { year: node.year, week: node.week };
        curW = 0;
        curWStart = null;
        if (!longestLosingStreak || curL > longestLosingStreak.length) {
          longestLosingStreak = {
            length: curL,
            ownerId,
            teamName: resolveCanonicalTeamName({ ownerId }),
            start: curLStart!,
            end: { year: node.year, week: node.week },
          };
        }
      } else {
        // Tie resets both streaks
        curW = 0;
        curL = 0;
        curWStart = null;
        curLStart = null;
      }
    }
  }

  return { highestScoringGame, lowestScoringGame, biggestVictory, closestVictory, highestCombined, longestWinStreak, longestLosingStreak };
}

export async function getWeeklyHighScoreTallyAcrossSeasons(
  params?: { tuesdayFlip?: boolean },
  options?: SleeperFetchOptions
): Promise<Record<string, number>> {
  const yearToLeague = await buildYearToLeagueMapUnique(options);

  const tally: Record<string, number> = {};

  // Iterate through seasons; process weeks in parallel per season
  // Determine cutoff for current season using Tuesday flip policy (ET)
  const useTuesdayFlip = params?.tuesdayFlip ?? true;
  let currentSeasonCutoffWeek: number | null = null;
  if (useTuesdayFlip && LEAGUE_IDS.CURRENT) {
    try {
      const state = await getNFLState(undefined, options);
      const rawWeek = (state.week ?? state.display_week ?? 1) as number;
      const now = new Date();
      const dowET = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' }).format(now);
      if (dowET === 'Tue' || dowET === 'Wed') {
        // On Wednesday, include last completed week. If Sleeper hasn't advanced rawWeek yet,
        // rawWeek still corresponds to last week (has points) -> include rawWeek.
        // If it has advanced, rawWeek is next week (likely 0-0) -> include rawWeek - 1.
        try {
          const mus = await getLeagueMatchups(LEAGUE_IDS.CURRENT, rawWeek, options).catch(() => [] as SleeperMatchup[]);
          const hasAnyPoints = mus.some((m) => ((m.custom_points ?? m.points ?? 0) > 0));
          currentSeasonCutoffWeek = hasAnyPoints ? Math.max(1, rawWeek) : Math.max(1, rawWeek - 1);
        } catch {
          currentSeasonCutoffWeek = Math.max(1, rawWeek - 1);
        }
      } else {
        // On Mon and Thu-Sun, include only fully completed weeks (rawWeek - 1)
        currentSeasonCutoffWeek = Math.max(1, (typeof rawWeek === 'number' ? rawWeek : 1) - 1);
      }
    } catch {
      // Fallback: if state fails, default to include up to previous week
      currentSeasonCutoffWeek = null;
    }
  }

  for (const leagueId of Object.values(yearToLeague)) {
    if (!leagueId) continue;

    // Map roster_id -> ownerId for this league
    const rosters = await getLeagueRosters(leagueId, options);
    const rosterOwner = new Map<number, string>();
    for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);

    // Decide weeks to process: limit to regular season (before playoffs) and apply Tuesday flip cutoff for current season
    const league = await getLeague(leagueId, options).catch(
      () => null as { settings?: { playoff_week_start?: number; playoff_start_week?: number } } | null
    );
    const settings = (league?.settings || {}) as { playoff_week_start?: number; playoff_start_week?: number };
    const startWeek = Number(settings.playoff_week_start ?? settings.playoff_start_week ?? 15);
    const regularLastWeek = Math.max(1, startWeek - 1);
    const isCurrentSeason = leagueId === LEAGUE_IDS.CURRENT;
    const cutoff = isCurrentSeason && currentSeasonCutoffWeek != null ? currentSeasonCutoffWeek : regularLastWeek;
    const upToWeek = Math.min(regularLastWeek, cutoff);
    if (upToWeek <= 0) continue;

    // Fetch weeks 1..upToWeek matchups in parallel
    const weekPromises = Array.from({ length: upToWeek }, (_, i) => i + 1).map((w) =>
      getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[])
    );
    const allWeekMatchups = await Promise.all(weekPromises);

    for (const weekMatchups of allWeekMatchups) {
      if (!weekMatchups || weekMatchups.length === 0) continue;

      // Compute per-roster points
      const ptsByRoster: Array<{ rosterId: number; pts: number }> = [];
      for (const m of weekMatchups) {
        const pts = m.custom_points ?? m.points ?? 0;
        ptsByRoster.push({ rosterId: m.roster_id, pts });
      }

      if (ptsByRoster.length === 0) continue;
      let maxPts = -Infinity;
      for (const p of ptsByRoster) if (p.pts > maxPts) maxPts = p.pts;

      // Skip weeks with no scoring (all zero)
      if (!(maxPts > 0)) continue;

      // Award all rosters tied for weekly high
      for (const p of ptsByRoster) {
        if (p.pts === maxPts) {
          const ownerId = rosterOwner.get(p.rosterId);
          if (ownerId) {
            tally[ownerId] = (tally[ownerId] || 0) + 1;
          }
        }
      }
    }
  }

  return tally;
}

// ==========================
// All-Time Split Records (Regular, Playoffs, Toilet Bowl)
// ==========================

export interface SplitRecord {
  wins: number;
  losses: number;
  ties: number;
  pf: number; // points for
  pa: number; // points against
}

/**
 * Compute per-owner all-time split records across seasons:
 *  - Regular season (weeks < playoff_start_week)
 *  - Playoffs (winners bracket games at/after playoff start)
 *  - Toilet Bowl (losers bracket games at/after playoff start)
 *
 * Classification rules per league-year:
 *  - Determine playoff start via league settings: playoff_week_start | playoff_start_week
 *  - Build winners/losers roster-id sets from brackets.
 *  - For each weekly head-to-head (skip 0-0 unplayed), if week < start -> Regular.
 *    Otherwise, if both rosters are in winners set -> Playoffs.
 *    Else if losers set is available and both rosters in losers -> Toilet.
 *    Else if losers set is empty, treat any non-winners pairs as Toilet (fallback).
 */
export async function getSplitRecordsAllTime(
  options?: SleeperFetchOptions
): Promise<Record<string, { teamName: string; regular: SplitRecord; playoffs: SplitRecord; toilet: SplitRecord }>> {
  const yearToLeague = await buildYearToLeagueMapUnique(options);

  const agg: Record<string, { teamName: string; regular: SplitRecord; playoffs: SplitRecord; toilet: SplitRecord }> = {};

  // Deduplicate league IDs to avoid counting the same season twice
  const uniqueLeagueIds = [...new Set(Object.values(yearToLeague).filter(Boolean))];

  // Iterate seasons
  for (const leagueId of uniqueLeagueIds) {
    if (!leagueId) continue;

    // Build mapping roster_id -> owner_id and a stable team name via canonical resolution
    const rosters = await getLeagueRosters(leagueId, options);
    const rosterOwner = new Map<number, string>();
    for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);

    // Name map not required for aggregation; omit to save a call if it fails

    // League settings: playoff start week
    const league = await getLeague(leagueId, options);
    const settings = (league?.settings || {}) as {
      playoff_week_start?: number;
      playoff_start_week?: number;
    };
    const startWeek = Number(settings.playoff_week_start ?? settings.playoff_start_week ?? 15);

    // Brackets -> build sets of specific matchups (t1, t2 pairs) for each bracket
    const [winnersBracket, losersBracket] = await Promise.all([
      getLeagueWinnersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]),
      getLeagueLosersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]),
    ]);
    
    // Build sets of matchup pairs for TRUE winners bracket games vs consolation
    // Key format: "rosterId1-rosterId2" where rosterId1 < rosterId2 for consistency
    const makeMatchupKey = (r1: number, r2: number) => {
      const [lo, hi] = r1 < r2 ? [r1, r2] : [r2, r1];
      return `${lo}-${hi}`;
    };
    const winnersMatchups = new Set<string>();
    const consolationMatchups = new Set<string>();
    
    // Analyze winners_bracket games to separate true winners bracket from consolation
    for (const g of winnersBracket) {
      if (typeof g.t1 !== 'number' || typeof g.t2 !== 'number') continue;
      const key = makeMatchupKey(g.t1, g.t2);
      
      // A game is CONSOLATION if either team came from a loser
      const t1FromLoser = typeof g.t1_from?.l === 'number';
      const t2FromLoser = typeof g.t2_from?.l === 'number';
      const anyFromLoser = t1FromLoser || t2FromLoser;
      
      // A game is TRUE winners bracket ONLY if:
      // 1. Championship game (p=1) - the final
      // 2. First round (r=1) - all teams still competing for championship
      // 3. Round 2+ with NO placement designation (p is null/undefined) AND no teams from losers
      //    (this covers semifinals and any other continuing winners bracket rounds)
      const isChampionship = g.p === 1;
      const isFirstRound = g.r === 1;
      const isPlacementGame = typeof g.p === 'number' && g.p > 1; // 3rd place, 5th place, etc.
      
      if (anyFromLoser || isPlacementGame) {
        // Consolation: teams from losers OR any placement game (3rd, 5th, 7th, etc.)
        consolationMatchups.add(key);
      } else if (isFirstRound || isChampionship) {
        // True winners bracket: first round or championship
        winnersMatchups.add(key);
      } else if (g.r > 1 && !anyFromLoser && !isPlacementGame) {
        // Semifinals or other continuing winners bracket rounds
        winnersMatchups.add(key);
      } else {
        // Safety fallback
        consolationMatchups.add(key);
      }
    }
    
    // Losers bracket (toilet bowl) games - teams that didn't make playoffs
    for (const g of losersBracket) {
      if (typeof g.t1 === 'number' && typeof g.t2 === 'number') {
        consolationMatchups.add(makeMatchupKey(g.t1, g.t2));
      }
    }

    // Fetch weeks 1..17 matchups
    const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
    const allWeekMatchups = await Promise.all(
      weeks.map((w) => getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[]))
    );

    for (let wIdx = 0; wIdx < allWeekMatchups.length; wIdx++) {
      const week = wIdx + 1;
      const matchups = allWeekMatchups[wIdx] || [];
      if (matchups.length === 0) continue;

      // Group by matchup_id
      const byId = new Map<number, SleeperMatchup[]>();
      for (const m of matchups) {
        const arr = byId.get(m.matchup_id) || [];
        arr.push(m);
        byId.set(m.matchup_id, arr);
      }

      for (const pair of byId.values()) {
        if (!pair || pair.length < 2) continue;
        const [a, b] = pair;
        const aPts = a.custom_points ?? a.points ?? 0;
        const bPts = b.custom_points ?? b.points ?? 0;
        if ((aPts ?? 0) === 0 && (bPts ?? 0) === 0) continue; // unplayed

        const aOwner = rosterOwner.get(a.roster_id);
        const bOwner = rosterOwner.get(b.roster_id);
        if (!aOwner || !bOwner) continue;

        // Initialize aggregates
        const initFor = (ownerId: string) => {
          if (!agg[ownerId]) {
            const teamName = resolveCanonicalTeamName({ ownerId });
            agg[ownerId] = {
              teamName,
              regular: { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 },
              playoffs: { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 },
              toilet: { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 },
            };
          }
        };
        initFor(aOwner);
        initFor(bOwner);

        // Determine category
        let category: 'regular' | 'playoffs' | 'toilet' | null = null;
        if (week < startWeek) {
          category = 'regular';
        } else {
          // Check if this specific matchup is in winners or consolation bracket
          const matchupKey = makeMatchupKey(a.roster_id, b.roster_id);
          const isWinnersBracketGame = winnersMatchups.has(matchupKey);
          const isConsolationGame = consolationMatchups.has(matchupKey);
          if (isWinnersBracketGame) category = 'playoffs';
          else if (isConsolationGame) category = 'toilet';
          else category = null; // not in any bracket (skip)
        }
        if (!category) continue;

        // Apply result to both owners
        if (aPts > bPts) {
          agg[aOwner][category].wins += 1;
          agg[bOwner][category].losses += 1;
        } else if (aPts < bPts) {
          agg[bOwner][category].wins += 1;
          agg[aOwner][category].losses += 1;
        } else {
          agg[aOwner][category].ties += 1;
          agg[bOwner][category].ties += 1;
        }

        // Accumulate points for/against
        agg[aOwner][category].pf += aPts; agg[aOwner][category].pa += bPts;
        agg[bOwner][category].pf += bPts; agg[bOwner][category].pa += aPts;
      }
    }
  }

  return agg;
}

export interface TopScoringWeekEntry {
  points: number;
  teamName: string;
  ownerId: string;
  rosterId?: number;
  opponentPoints: number;
  opponentTeamName: string;
  opponentOwnerId: string;
  opponentRosterId?: number;
  week: number;
  year: string;
  category: 'regular' | 'playoffs' | 'toilet';
}

/**
 * Return the top N single-team scoring weeks across seasons, filtered by category.
 * category: 'regular' | 'playoffs' | 'toilet' | 'all'
 * - 'regular': weeks < playoff start week
 * - 'playoffs': winners-bracket matchups at/after playoff start
 * - 'toilet': losers-bracket (or non-winners at/after playoff start where losers bracket exists)
 * - 'all': includes regular + playoffs + toilet
 */
export async function getTopScoringWeeksAllTime(
  params: { category: 'regular' | 'playoffs' | 'toilet' | 'all'; top?: number },
  options?: SleeperFetchOptions
): Promise<TopScoringWeekEntry[]> {
  const { category, top = 10 } = params;
  const yearToLeague = await buildYearToLeagueMapUnique(options);

  const rows: TopScoringWeekEntry[] = [];

  // Process each season
  for (const [year, leagueId] of Object.entries(yearToLeague)) {
    if (!leagueId) continue;

    const rosters = await getLeagueRosters(leagueId, options);
    const rosterOwner = new Map<number, string>();
    for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);
    const rosterIdToName = await getRosterIdToTeamNameMap(leagueId, options).catch(() => new Map<number, string>());

    // Playoff start
    const league = await getLeague(leagueId, options);
    const settings = (league?.settings || {}) as { playoff_week_start?: number; playoff_start_week?: number };
    const startWeek = Number(settings.playoff_week_start ?? settings.playoff_start_week ?? 15);

    // Brackets sets
    const winnersBracket = await getLeagueWinnersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]);
    const winnersSet = new Set<number>();
    for (const g of winnersBracket) {
      if (typeof g.t1 === 'number') winnersSet.add(g.t1);
      if (typeof g.t2 === 'number') winnersSet.add(g.t2);
    }

    // Weeks 1..17
    const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
    const allWeekMatchups = await Promise.all(
      weeks.map((w) => getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[]))
    );

    for (let wIdx = 0; wIdx < allWeekMatchups.length; wIdx++) {
      const week = wIdx + 1;
      const matchups = allWeekMatchups[wIdx] || [];
      if (matchups.length === 0) continue;

      // Group by matchup_id for pairs
      const byId = new Map<number, SleeperMatchup[]>();
      for (const m of matchups) {
        const arr = byId.get(m.matchup_id) || [];
        arr.push(m);
        byId.set(m.matchup_id, arr);
      }

      for (const pair of byId.values()) {
        if (!pair || pair.length < 2) continue;
        const [a, b] = pair;
        const aPts = a.custom_points ?? a.points ?? 0;
        const bPts = b.custom_points ?? b.points ?? 0;
        if ((aPts ?? 0) === 0 && (bPts ?? 0) === 0) continue;

        // Determine category of this matchup
        let cat: 'regular' | 'playoffs' | 'toilet' | null = null;
        if (week < startWeek) {
          cat = 'regular';
        } else {
          const aInW = winnersSet.has(a.roster_id);
          const bInW = winnersSet.has(b.roster_id);
          if (aInW && bInW) cat = 'playoffs';
          else cat = 'toilet';
        }
        if (category !== 'all' && cat !== category) continue; // filter strictly unless 'all'

        const aOwner = rosterOwner.get(a.roster_id);
        const bOwner = rosterOwner.get(b.roster_id);
        if (!aOwner || !bOwner) continue;
        const aName = rosterIdToName.get(a.roster_id) || resolveCanonicalTeamName({ ownerId: aOwner });
        const bName = rosterIdToName.get(b.roster_id) || resolveCanonicalTeamName({ ownerId: bOwner });

        // Push both perspectives so the top single-team entries emerge
        rows.push({
          points: aPts,
          teamName: aName,
          ownerId: aOwner,
          rosterId: a.roster_id,
          opponentPoints: bPts,
          opponentTeamName: bName,
          opponentOwnerId: bOwner,
          opponentRosterId: b.roster_id,
          week,
          year,
          category: cat,
        });
        rows.push({
          points: bPts,
          teamName: bName,
          ownerId: bOwner,
          rosterId: b.roster_id,
          opponentPoints: aPts,
          opponentTeamName: aName,
          opponentOwnerId: aOwner,
          opponentRosterId: a.roster_id,
          week,
          year,
          category: cat,
        });
      }
    }
  }

  rows.sort((a, b) => b.points - a.points);
  return rows.slice(0, Math.max(1, top));
}

// Returns the top N scoring weeks for a specific franchise owner across all configured seasons.
export interface TeamTopWeek {
  points: number;
  opponentPoints: number;
  opponentTeamName: string;
  week: number;
  year: string;
  category: 'regular' | 'playoffs' | 'toilet';
}

export async function getTopScoringWeeksByOwner(
  ownerId: string,
  params?: { top?: number; category?: 'regular' | 'playoffs' | 'toilet' | 'all'; sort?: 'asc' | 'desc' },
  options?: SleeperFetchOptions
): Promise<TeamTopWeek[]> {
  const { top = 5, category = 'all', sort = 'desc' } = params || {};

  const yearToLeague = await buildYearToLeagueMapUnique(options);

  const rows: TeamTopWeek[] = [];

  for (const [year, leagueId] of Object.entries(yearToLeague)) {
    if (!leagueId) continue;

    // Build rosterId -> ownerId and rosterId -> teamName maps
    const rosters = await getLeagueRosters(leagueId, options);
    const rosterOwner = new Map<number, string>();
    for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);
    const rosterIdToName = await getRosterIdToTeamNameMap(leagueId, options).catch(() => new Map<number, string>());

    // Determine playoff start week
    const league = await getLeague(leagueId, options);
    const settings = (league?.settings || {}) as { playoff_week_start?: number; playoff_start_week?: number };
    const startWeek = Number(settings.playoff_week_start ?? settings.playoff_start_week ?? 15);

    // Winners bracket set to distinguish playoffs vs toilet after playoff start
    const winnersBracket = await getLeagueWinnersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]);
    const winnersSet = new Set<number>();
    for (const g of winnersBracket) {
      if (typeof g.t1 === 'number') winnersSet.add(g.t1);
      if (typeof g.t2 === 'number') winnersSet.add(g.t2);
    }

    // Weeks 1..17 (exclude Week 18 from team Top High/Low)
    const weekNums = Array.from({ length: 17 }, (_, i) => i + 1);
    const weekMatchups = await Promise.all(
      weekNums.map((w) => getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[]))
    );

    for (let idx = 0; idx < weekMatchups.length; idx++) {
      const week = idx + 1;
      const matchups = weekMatchups[idx];
      if (!Array.isArray(matchups) || matchups.length === 0) continue;

      // Find entries for this owner
      for (const m of matchups) {
        const mOwner = rosterOwner.get(m.roster_id);
        if (mOwner !== ownerId) continue;

        const opponent = matchups.find((om) => om.matchup_id === m.matchup_id && om.roster_id !== m.roster_id);
        if (!opponent) continue;

        const myPts = m.custom_points ?? m.points ?? 0;
        const oppPts = opponent.custom_points ?? opponent.points ?? 0;
        if ((myPts ?? 0) === 0 && (oppPts ?? 0) === 0) continue; // skip unplayed scheduled

        // Determine category of this matchup
        let cat: 'regular' | 'playoffs' | 'toilet';
        if (week < startWeek) {
          cat = 'regular';
        } else {
          const meInW = winnersSet.has(m.roster_id);
          const oppInW = winnersSet.has(opponent.roster_id);
          cat = (meInW && oppInW) ? 'playoffs' : 'toilet';
        }
        if (category !== 'all' && cat !== category) continue;

        const opponentTeamName = rosterIdToName.get(opponent.roster_id) || resolveCanonicalTeamName({ ownerId: rosterOwner.get(opponent.roster_id) || '' });

        rows.push({
          points: myPts,
          opponentPoints: oppPts,
          opponentTeamName,
          week,
          year,
          category: cat,
        });
      }
    }
  }

  rows.sort((a, b) => (sort === 'asc' ? a.points - b.points : b.points - a.points));
  return rows.slice(0, Math.max(1, top));
}

/**
 * Get a team's all-time aggregate stats across all configured league seasons by owner_id
 * Uses LEAGUE_IDS.CURRENT and LEAGUE_IDS.PREVIOUS years.
 */
export async function getTeamAllTimeStatsByOwner(ownerId: string, options?: SleeperFetchOptions): Promise<{
  wins: number;
  losses: number;
  ties: number;
  totalPF: number;
  totalPA: number;
  avgPF: number;
  avgPA: number;
  highestScore: number;
  lowestScore: number;
}> {
  try {
    const yearToLeague = await buildYearToLeagueMapUnique(options);

    let wins = 0;
    let losses = 0;
    let ties = 0;
    let totalPF = 0;
    let totalPA = 0;
    let highestScore = -Infinity;
    let lowestScore = Infinity;
    let games = 0;

    for (const leagueId of Object.values(yearToLeague)) {
      if (!leagueId) continue;

      // Build rosterId -> ownerId map for this league
      const rosters = await getLeagueRosters(leagueId, options);
      const rosterOwner = new Map<number, string>();
      for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);

      // Add season totals directly from roster settings to match Sleeper
      const myRoster = rosters.find((r) => r.owner_id === ownerId);
      if (myRoster) {
        const seasonWins = myRoster.settings.wins || 0;
        const seasonLosses = myRoster.settings.losses || 0;
        const seasonTies = myRoster.settings.ties || 0;
        wins += seasonWins;
        losses += seasonLosses;
        ties += seasonTies;
        games += seasonWins + seasonLosses + seasonTies;

        const seasonPF = (myRoster.settings.fpts || 0) + ((myRoster.settings.fpts_decimal || 0) / 100);
        const seasonPA = (myRoster.settings.fpts_against || 0) + ((myRoster.settings.fpts_against_decimal || 0) / 100);
        totalPF += seasonPF;
        totalPA += seasonPA;
      }

      // Fetch all weeks' matchups in parallel (1..17)
      const weekPromises = Array.from({ length: 17 }, (_, i) => i + 1).map((w) =>
        getLeagueMatchups(leagueId, Math.min(w, 17), options).catch(() => [] as SleeperMatchup[])
      );
      const allWeekMatchups = await Promise.all(weekPromises);

      for (const weekMatchups of allWeekMatchups) {
        if (!weekMatchups || weekMatchups.length === 0) continue;

        for (const m of weekMatchups) {
          const mOwner = rosterOwner.get(m.roster_id);
          if (mOwner !== ownerId) continue;

          const opponent = weekMatchups.find((om) => om.matchup_id === m.matchup_id && om.roster_id !== m.roster_id);
          if (!opponent) continue;

          // Use custom_points when present, else points
          const myPts = m.custom_points ?? m.points ?? 0;
          const oppPts = opponent.custom_points ?? opponent.points ?? 0;

          // Skip unplayed scheduled matchups (0-0)
          if ((myPts ?? 0) === 0 && (oppPts ?? 0) === 0) continue;

          // Track weekly extremes only
          if (myPts > highestScore) highestScore = myPts;
          if (myPts < lowestScore) lowestScore = myPts;
        }
      }
    }

    if (games === 0) {
      return {
        wins: 0,
        losses: 0,
        ties: 0,
        totalPF: 0,
        totalPA: 0,
        avgPF: 0,
        avgPA: 0,
        highestScore: 0,
        lowestScore: 0,
      };
    }

    return {
      wins,
      losses,
      ties,
      totalPF,
      totalPA,
      avgPF: totalPF / games,
      avgPA: totalPA / games,
      highestScore: isFinite(highestScore) ? highestScore : 0,
      lowestScore: isFinite(lowestScore) ? lowestScore : 0,
    };
  } catch (error) {
    console.error('Error computing all-time stats:', error);
    throw error;
  }
}

/**
 * Get a team's all-time head-to-head records across all configured league seasons by owner_id
 * Returns a map of opponentOwnerId -> record
 */
export async function getTeamH2HRecordsAllTimeByOwner(ownerId: string, options?: SleeperFetchOptions): Promise<Record<string, { wins: number; losses: number; ties: number }>> {
  try {
    const yearToLeague = await buildYearToLeagueMapUnique(options);

    const h2h: Record<string, { wins: number; losses: number; ties: number }> = {};

    for (const leagueId of Object.values(yearToLeague)) {
      if (!leagueId) continue;

      const rosters = await getLeagueRosters(leagueId, options);
      const rosterOwner = new Map<number, string>();
      for (const r of rosters) rosterOwner.set(r.roster_id, r.owner_id);

      const weekPromises = Array.from({ length: 17 }, (_, i) => i + 1).map((w) =>
        getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[])
      );
      const allWeekMatchups = await Promise.all(weekPromises);

      for (const weekMatchups of allWeekMatchups) {
        if (!weekMatchups || weekMatchups.length === 0) continue;

        for (const m of weekMatchups) {
          const mOwner = rosterOwner.get(m.roster_id);
          if (mOwner !== ownerId) continue;
          const opponent = weekMatchups.find((om) => om.matchup_id === m.matchup_id && om.roster_id !== m.roster_id);
          if (!opponent) continue;
          const opponentOwnerId = rosterOwner.get(opponent.roster_id);
          if (!opponentOwnerId) continue;

          const myPts = m.custom_points ?? m.points ?? 0;
          const oppPts = opponent.custom_points ?? opponent.points ?? 0;
          // Skip unplayed scheduled matchups (0-0)
          if ((myPts ?? 0) === 0 && (oppPts ?? 0) === 0) continue;

          if (!h2h[opponentOwnerId]) h2h[opponentOwnerId] = { wins: 0, losses: 0, ties: 0 };
          if (myPts > oppPts) h2h[opponentOwnerId].wins += 1;
          else if (myPts < oppPts) h2h[opponentOwnerId].losses += 1;
          else h2h[opponentOwnerId].ties += 1;
        }
      }
    }

    return h2h;
  } catch (error) {
    console.error('Error computing all-time H2H records:', error);
    throw error;
  }
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  league_id: string;
  players: string[];
  taxi?: string[];
  reserve?: string[];
  metadata?: Record<string, string> | null;
  settings: {
    wins: number;
    waiver_position: number;
    waiver_budget_used: number;
    total_moves: number;
    ties: number;
    losses: number;
    fpts: number;
    fpts_decimal: number;
    fpts_against: number;
    fpts_against_decimal: number;
  };
}

export interface SleeperMatchup {
  matchup_id: number;
  roster_id: number;
  points: number;
  custom_points?: number;
  // Map of player_id -> fantasy points for this matchup under the league's scoring
  // This is provided by Sleeper and already includes all bonuses and custom settings.
  players_points?: Record<string, number>;
  players: string[];
  starters: string[];
  matchup_week: number;
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string;
  team: string;
  status: string;
  injury_status: string;
  injury_body_part?: string | null;
  practice_participation?: string | null;
  depth_chart_order?: number | null;
  depth_chart_position?: string | null;
  starting_status?: string | null;
  years_exp: number;
  college?: string | null;
  // Sleeper includes rookie_year for many players; used to identify ROY by season
  rookie_year?: string | number;
}

/**
 * Counts wins/losses/ties from regular-season-only weekly matchups (excludes playoff weeks).
 * Returns a Map of rosterId -> { wins, losses, ties, fpts }.
 */
export async function getRegularSeasonRecords(
  leagueId: string,
  options?: SleeperFetchOptions
): Promise<Map<number, { wins: number; losses: number; ties: number; fpts: number }>> {
  const league = await getLeague(leagueId, options).catch(
    () => null as { settings?: { playoff_week_start?: number; playoff_start_week?: number } } | null
  );
  const settings = (league?.settings || {}) as { playoff_week_start?: number; playoff_start_week?: number };
  const startWeek = Number(settings.playoff_week_start ?? settings.playoff_start_week ?? 15);
  const regularLastWeek = Math.max(1, startWeek - 1);

  const rosters = await getLeagueRosters(leagueId, options);
  const records = new Map<number, { wins: number; losses: number; ties: number; fpts: number }>();
  for (const r of rosters) records.set(r.roster_id, { wins: 0, losses: 0, ties: 0, fpts: 0 });

  const weekPromises = Array.from({ length: regularLastWeek }, (_, i) => i + 1).map((w) =>
    getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[])
  );
  const allWeekMatchups = await Promise.all(weekPromises);

  for (const weekMatchups of allWeekMatchups) {
    const byMatchup = new Map<number, SleeperMatchup[]>();
    for (const m of weekMatchups) {
      if (!m.matchup_id) continue;
      const arr = byMatchup.get(m.matchup_id) || [];
      arr.push(m);
      byMatchup.set(m.matchup_id, arr);
    }
    for (const [, pair] of byMatchup) {
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      const apts = a.custom_points ?? a.points ?? 0;
      const bpts = b.custom_points ?? b.points ?? 0;
      const recA = records.get(a.roster_id);
      const recB = records.get(b.roster_id);
      if (recA) recA.fpts += apts;
      if (recB) recB.fpts += bpts;
      if (apts > bpts) {
        if (recA) recA.wins++;
        if (recB) recB.losses++;
      } else if (bpts > apts) {
        if (recB) recB.wins++;
        if (recA) recA.losses++;
      } else {
        if (recA) recA.ties++;
        if (recB) recB.ties++;
      }
    }
  }
  return records;
}

export interface TeamData {
  teamName: string;  // Canon team name
  rosterId: number;
  ownerId: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
  players: string[];
}

export interface SleeperTransaction {
  type: 'trade' | 'free_agent' | 'waiver';
  transaction_id: string;
  status_updated: number;
  status: 'complete' | 'pending' | 'vetoed';
  settings: Record<string, unknown> | null;
  roster_ids: number[];
  metadata: Record<string, unknown> | null;
  leg: number;
  drops: Record<string, number> | null;
  draft_picks: {
    season: string;
    round: number;
    roster_id: number;
    previous_owner_id: number;
    owner_id: number;
  }[];
  creator: string;
  created: number;
  consenter_ids: number[];
  adds: Record<string, number> | null;
  waiver_budget: {
    sender: number;
    receiver: number;
    amount: number;
  }[];
}

// Draft types
export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  status: string;
  type: string;
  metadata?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
}

export interface SleeperDraftPick {
  pick_no: number; // overall pick number
  round: number;
  roster_id: number; // current owner roster id
  player_id: string;
  picked_by: string;
  draft_slot: number;
  // Raw metadata from Sleeper. Auction drafts store bid as string in metadata.amount
  metadata?: (Record<string, unknown> & { amount?: string }) | null;
  // Auction winning bid amount (only present for auction-type drafts)
  amount?: number;
}

// Draft details (includes draft_order mapping roster_id -> draft slot)
export interface SleeperDraftDetails extends SleeperDraft {
  // Sleeper API returns a mapping of roster_id to draft position slot
  // Keys may be strings; we'll normalize to numbers when consuming
  draft_order?: Record<string, number> | null;
}

// ---------------------------------
// Lightweight in-memory caches (per runtime)
// ---------------------------------
const USERS_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ROSTERS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MATCHUPS_TTL_MS = 20 * 1000;    // 20 seconds (scoreboard updates frequently)
const MATCHUPS_STALE_WHEN_EMPTY_MS = 2 * 60 * 1000; // within 2 minutes, prefer last non-empty over sudden empty
const INJURIES_TTL_MS = 5 * 60 * 1000; // 5 minutes

const leagueUsersCache: Record<string, { ts: number; data: SleeperUser[] }> = {};
const leagueRostersCache: Record<string, { ts: number; data: SleeperRoster[] }> = {};
const leagueMatchupsCache: Record<string, { ts: number; data: SleeperMatchup[] }> = {};

let injuriesCache: { ts: number; data: SleeperInjury[] } | null = null;

export interface SleeperInjury {
  player_id: string;
  status?: string;
  practice_participation?: string;
  notes?: string;
  update_time?: number;
}

export async function getSleeperInjuriesCached(ttlMs: number = INJURIES_TTL_MS, options?: SleeperFetchOptions): Promise<SleeperInjury[]> {
  const now = Date.now();
  if (!options?.forceFresh && injuriesCache && now - injuriesCache.ts < ttlMs) return injuriesCache.data;
  try {
    const bust = options?.forceFresh ? `?t=${now}` : '';
    const data = await sleeperFetchJson<SleeperInjury[]>(`${SLEEPER_API_BASE}/players/nfl/injuries${bust}`, undefined, options);
    injuriesCache = { ts: now, data };
    return data;
  } catch (err) {
    console.warn('[sleeper] injuries fetch failed', err);
    injuriesCache = { ts: now, data: [] };
    return [];
  }
}

export type PlayerAvailabilityTier = 'starter' | 'primary_backup' | 'rotational' | 'inactive' | 'unknown';

export interface PlayerAvailabilityInfo {
  tier: PlayerAvailabilityTier;
  reasons: string[];
}

export function resolveAvailabilityFromSleeper(player: SleeperPlayer | undefined, injury: SleeperInjury | undefined): PlayerAvailabilityInfo {
  if (!player) return { tier: 'unknown', reasons: ['missing-player'] };
  const reasons: string[] = [];
  const depthOrder = typeof player.depth_chart_order === 'number' ? player.depth_chart_order : null;
  const starting = player.starting_status?.toLowerCase() === 'starter';
  const injured = injury?.status?.toLowerCase();
  const inactiveStatuses = new Set(['out', 'injured reserve', 'physically unable to perform']);
  if (injured && inactiveStatuses.has(injured)) {
    reasons.push(`injury:${injured}`);
    return { tier: 'inactive', reasons };
  }
  if (starting || depthOrder === 1) {
    if (starting) reasons.push('sleeper-starting');
    if (depthOrder === 1) reasons.push('depth-order-1');
    return { tier: 'starter', reasons };
  }
  if (depthOrder === 2) {
    reasons.push('depth-order-2');
    return { tier: 'primary_backup', reasons };
  }
  if (depthOrder === 3) {
    reasons.push('depth-order-3');
    return { tier: 'rotational', reasons };
  }
  if (depthOrder && depthOrder > 3) {
    reasons.push(`depth-order-${depthOrder}`);
    return { tier: 'rotational', reasons };
  }
  if ((player.status?.toLowerCase() || '') === 'inactive') {
    reasons.push('sleeper-inactive');
    return { tier: 'inactive', reasons };
  }
  return { tier: 'unknown', reasons };
}

/**
 * Fetch league information from Sleeper API
 * @param leagueId The Sleeper league ID
 * @returns Promise with league data
 */
export async function getLeague(leagueId: string, options?: SleeperFetchOptions): Promise<SleeperLeague> {
  return sleeperFetchJson<SleeperLeague>(`${SLEEPER_API_BASE}/league/${leagueId}`, undefined, options);
}

/**
 * Fetch users in a league from Sleeper API
 * @param leagueId The Sleeper league ID
 * @returns Promise with array of users
 */
export async function getLeagueUsers(leagueId: string, options?: SleeperFetchOptions): Promise<SleeperUser[]> {
  const now = Date.now();
  const key = leagueId;
  const cached = leagueUsersCache[key];
  if (!options?.forceFresh && cached && now - cached.ts < USERS_TTL_MS) return cached.data;
  try {
    const bust = options?.forceFresh ? `?t=${now}` : '';
    const data = await sleeperFetchJson<SleeperUser[]>(`${SLEEPER_API_BASE}/league/${leagueId}/users${bust}`,
      undefined,
      options
    );
    leagueUsersCache[key] = { ts: now, data };
    return data;
  } catch (err) {
    if (cached) return cached.data; // stale-on-error
    throw err;
  }
}

/**
 * Fetch rosters in a league from Sleeper API
 * @param leagueId The Sleeper league ID
 * @returns Promise with array of rosters
 */
export async function getLeagueRosters(leagueId: string, options?: SleeperFetchOptions): Promise<SleeperRoster[]> {
  const now = Date.now();
  const key = leagueId;
  const cached = leagueRostersCache[key];
  if (!options?.forceFresh && cached && now - cached.ts < ROSTERS_TTL_MS) return cached.data;
  try {
    const bust = options?.forceFresh ? `?t=${now}` : '';
    const data = await sleeperFetchJson<SleeperRoster[]>(`${SLEEPER_API_BASE}/league/${leagueId}/rosters${bust}`,
      undefined,
      options
    );
    leagueRostersCache[key] = { ts: now, data };
    return data;
  } catch (err) {
    if (cached) return cached.data; // stale-on-error
    throw err;
  }
}

/**
 * Fetch matchups for a specific week from Sleeper API
 * @param leagueId The Sleeper league ID
 * @param week The week number
 * @returns Promise with array of matchups
 */
export async function getLeagueMatchups(leagueId: string, week: number, options?: SleeperFetchOptions): Promise<SleeperMatchup[]> {
  const now = Date.now();
  const key = `${leagueId}-${week}`;
  const cached = leagueMatchupsCache[key];
  if (!options?.forceFresh && cached && now - cached.ts < MATCHUPS_TTL_MS) return cached.data;
  try {
    const bust = options?.forceFresh ? `?t=${now}` : '';
    const data = await sleeperFetchJson<SleeperMatchup[]>(`${SLEEPER_API_BASE}/league/${leagueId}/matchups/${week}${bust}`,
      undefined,
      options
    );
    // If Sleeper suddenly returns an empty array but we have a recent non-empty cache,
    // keep showing the last known good data to avoid flashing empty UIs.
    if (Array.isArray(data) && data.length === 0 && cached && Array.isArray(cached.data) && cached.data.length > 0) {
      const age = now - cached.ts;
      if (age < MATCHUPS_STALE_WHEN_EMPTY_MS) {
        return cached.data;
      }
    }
    leagueMatchupsCache[key] = { ts: now, data };
    return data;
  } catch (err) {
    if (cached) return cached.data; // stale-on-error
    throw err;
  }
}

/**
 * Fetch player information from Sleeper API
 * @param playerId The Sleeper player ID
 * @returns Promise with player data
 */
export async function getPlayer(playerId: string, options?: SleeperFetchOptions): Promise<SleeperPlayer> {
  return sleeperFetchJson<SleeperPlayer>(`${SLEEPER_API_BASE}/players/nfl/${playerId}`, undefined, options);
}

/**
 * Fetch all players from Sleeper API
 * This is a large request, so use sparingly
 * @returns Promise with object of all players
 */
export async function getAllPlayers(options?: SleeperFetchOptions): Promise<Record<string, SleeperPlayer>> {
  return sleeperFetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_API_BASE}/players/nfl`, undefined, options);
}

// Lightweight in-memory cache for all players to avoid repeated large downloads
let allPlayersCache: { ts: number; data: Record<string, SleeperPlayer> } | null = null;
const ALL_PLAYERS_TTL_DEFAULT = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Cached wrapper for getAllPlayers with a TTL to reduce repeated network calls.
 */
export async function getAllPlayersCached(ttlMs: number = ALL_PLAYERS_TTL_DEFAULT, options?: SleeperFetchOptions): Promise<Record<string, SleeperPlayer>> {
  const now = Date.now();
  if (allPlayersCache && now - allPlayersCache.ts < ttlMs) {
    return allPlayersCache.data;
  }
  const data = await getAllPlayers(options);
  allPlayersCache = { ts: now, data };
  return data;
}

/**
 * Get teams data with canon team names for a specific league
 * @param leagueId The Sleeper league ID
 * @returns Promise with array of team data
 */
export async function getTeamsData(leagueId: string, options?: SleeperFetchOptions): Promise<TeamData[]> {
  try {
    const [rostersRes, usersRes] = await Promise.allSettled([
      getLeagueRosters(leagueId, options),
      getLeagueUsers(leagueId, options)
    ]);
    if (rostersRes.status !== 'fulfilled') throw rostersRes.reason;
    const rosters = rostersRes.value;
    const usersData = usersRes.status === 'fulfilled' ? usersRes.value : [] as SleeperUser[];
    
    // Map user ids
    const usersById: Record<string, SleeperUser | undefined> = {};
    for (const u of usersData) usersById[u.user_id] = u;

    // Build team objects with canonical names resolved via owner_id and aliases
    const teams: TeamData[] = rosters.map((roster) => {
      const user = usersById[roster.owner_id];
      const rosterTeamName = roster.metadata?.team_name ?? null;
      const teamName = resolveCanonicalTeamName({
        ownerId: roster.owner_id,
        rosterTeamName,
        userDisplayName: user?.display_name ?? null,
        username: user?.username ?? null,
      });

      return {
        teamName,
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        wins: roster.settings.wins,
        losses: roster.settings.losses,
        ties: roster.settings.ties,
        fpts: roster.settings.fpts + (roster.settings.fpts_decimal || 0) / 100,
        fptsAgainst: roster.settings.fpts_against + (roster.settings.fpts_against_decimal || 0) / 100,
        players: roster.players || [],
      };
    });

    return teams;
  } catch (error) {
    console.error('Error fetching teams data:', error);
    throw error;
  }
}

/**
 * Build a quick lookup Map from rosterId to canonical team name for a league.
 */
export async function getRosterIdToTeamNameMap(leagueId: string, options?: SleeperFetchOptions): Promise<Map<number, string>> {
  const teams = await getTeamsData(leagueId, options);
  return new Map(teams.map((t) => [t.rosterId, t.teamName]));
}

/**
 * Sleeper playoff bracket game shape (minimal fields used)
 */
export interface SleeperBracketGame {
  r: number; // round number (1 = first round)
  m: number; // match number within the round
  t1?: number | null; // roster_id for team 1 (may be null for bye)
  t2?: number | null; // roster_id for team 2 (may be null for bye)
  w?: number | null;  // winner roster_id (if known)
  l?: number | null;  // loser roster_id (if known)
  p?: number | null;  // placement (1=championship, 3=3rd place, etc.)
  t1_from?: { w?: number; l?: number } | null; // where t1 came from (w=winner of match, l=loser of match)
  t2_from?: { w?: number; l?: number } | null; // where t2 came from
}

/**
 * Bracket game with optional score fields attached from weekly matchups
 */
export interface SleeperBracketGameWithScore extends SleeperBracketGame {
  t1_points?: number | null;
  t2_points?: number | null;
}

/**
 * Fetch winners bracket for a league. Returns empty array if unavailable.
 */
export async function getLeagueWinnersBracket(leagueId: string, options?: SleeperFetchOptions): Promise<SleeperBracketGame[]> {
  try {
    return await sleeperFetchJson<SleeperBracketGame[]>(`${SLEEPER_API_BASE}/league/${leagueId}/winners_bracket`, undefined, options);
  } catch {
    return [];
  }
}

/**
 * Fetch losers bracket for a league. Returns empty array if unavailable.
 */
export async function getLeagueLosersBracket(leagueId: string, options?: SleeperFetchOptions): Promise<SleeperBracketGame[]> {
  try {
    return await sleeperFetchJson<SleeperBracketGame[]>(`${SLEEPER_API_BASE}/league/${leagueId}/losers_bracket`, undefined, options);
  } catch {
    return [];
  }
}

/**
 * Convenience wrapper to fetch both winners and losers brackets in parallel.
 */
export async function getLeaguePlayoffBrackets(leagueId: string, options?: SleeperFetchOptions): Promise<{ winners: SleeperBracketGame[]; losers: SleeperBracketGame[] }> {
  const [winners, losers] = await Promise.all([
    getLeagueWinnersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]),
    getLeagueLosersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]),
  ]);
  return { winners, losers };
}

/**
 * Fetch playoff brackets and attach scores for each game by correlating rounds
 * to league playoff weeks from league settings. If scores are 0-0 (unplayed),
 * they will be omitted (left as null).
 */
export async function getLeaguePlayoffBracketsWithScores(
  leagueId: string,
  options?: SleeperFetchOptions
): Promise<{ winners: SleeperBracketGameWithScore[]; losers: SleeperBracketGameWithScore[] }> {
  const [league, { winners, losers }] = await Promise.all([
    getLeague(leagueId, options),
    getLeaguePlayoffBrackets(leagueId, options),
  ]);

  const settings = (league?.settings || {}) as {
    playoff_week_start?: number;
    playoff_start_week?: number;
  };
  const startWeek = Number(
    settings.playoff_week_start ?? settings.playoff_start_week ?? 15
  );

  // Collect unique rounds across both brackets and compute their weeks
  const rounds = new Set<number>();
  for (const g of winners) if (typeof g.r === 'number') rounds.add(g.r);
  for (const g of losers) if (typeof g.r === 'number') rounds.add(g.r);
  const roundWeeks = new Map<number, number>();
  for (const r of rounds) roundWeeks.set(r, startWeek + (r - 1));

  // Fetch matchups for relevant weeks in parallel
  const weeksToFetch = Array.from(new Set(Array.from(roundWeeks.values())));
  const weekMatchupsMap = new Map<number, SleeperMatchup[]>();
  await Promise.all(
    weeksToFetch.map(async (week) => {
      const mus = await getLeagueMatchups(leagueId, week, options).catch(() => [] as SleeperMatchup[]);
      weekMatchupsMap.set(week, mus);
    })
  );

  const attachScores = (games: SleeperBracketGame[]): SleeperBracketGameWithScore[] => {
    return games.map((g) => {
      const res: SleeperBracketGameWithScore = { ...g, t1_points: null, t2_points: null };
      const r = g.r ?? 0;
      const week = roundWeeks.get(r);
      if (!week || !g.t1 || !g.t2) return res;
      const matchups = weekMatchupsMap.get(week) || [];
      // Try to locate the specific head-to-head between t1 and t2
      for (const m of matchups) {
        if (m.roster_id !== g.t1 && m.roster_id !== g.t2) continue;
        const opp = matchups.find((x) => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id);
        if (!opp) continue;
        const myPts = (m.custom_points ?? m.points ?? 0);
        const oppPts = (opp.custom_points ?? opp.points ?? 0);
        // Skip scheduled/unplayed
        if ((myPts ?? 0) === 0 && (oppPts ?? 0) === 0) break;
        if (m.roster_id === g.t1) {
          res.t1_points = myPts;
          res.t2_points = oppPts;
        } else {
          res.t2_points = myPts;
          res.t1_points = oppPts;
        }
        break;
      }
      return res;
    });
  };

  return {
    winners: attachScores(winners),
    losers: attachScores(losers),
  };
}

/**
 * Derive podium (champion, runner-up, third place) team names from the winners bracket for a given season year.
 * Falls back to nulls when bracket data is unavailable or incomplete.
 */
export async function derivePodiumFromWinnersBracketByYear(
  year: string,
  options?: SleeperFetchOptions
): Promise<{ champion: string | null; runnerUp: string | null; thirdPlace: string | null } | null> {
  try {
    const leagueId = getLeagueIdForSeason(year);
    if (!leagueId) return null;

    const [games, rosterIdToName] = await Promise.all([
      getLeagueWinnersBracket(leagueId, options).catch(() => [] as SleeperBracketGame[]),
      getRosterIdToTeamNameMap(leagueId, options).catch(() => new Map<number, string>()),
    ]);
    if (!games || games.length === 0) return null;

    // Group by round and find the maximum round number
    const byRound: Record<number, SleeperBracketGame[]> = {};
    for (const g of games) {
      const r = g.r ?? 0;
      if (!byRound[r]) byRound[r] = [];
      byRound[r].push(g);
    }
    const rounds = Object.keys(byRound).map((n) => Number(n));
    if (rounds.length === 0) return null;
    const maxRound = Math.max(...rounds);
    const lastRoundGames = byRound[maxRound] || [];

    // Helper to reverse lookup rosterId by canonical team name
    const findRosterIdByTeamName = (teamName: string | undefined): number | null => {
      if (!teamName) return null;
      for (const [rid, name] of rosterIdToName.entries()) {
        if (name === teamName) return rid;
      }
      return null;
    };

    // If champion is known in constants, use it to identify the final game reliably
    const expectedChampion = CHAMPIONS[year as keyof typeof CHAMPIONS]?.champion;
    const expectedChampionRid = expectedChampion && expectedChampion !== 'TBD' ? findRosterIdByTeamName(expectedChampion) : null;

    // Final game heuristics: prefer the game whose winner matches expected champion; otherwise, pick the game
    // in the last round with both participants present and a winner (w) recorded.
    let finalGame: SleeperBracketGame | undefined = undefined;
    if (expectedChampionRid != null) {
      finalGame = lastRoundGames.find((g) => g.w === expectedChampionRid);
    }
    if (!finalGame) {
      finalGame = lastRoundGames.find((g) => (g.t1 != null && g.t2 != null && g.w != null));
    }

    const championRid = finalGame?.w ?? null;
    const runnerUpRid = finalGame?.l ?? null;

    // Third place: if there is another game in the last round, treat its winner as 3rd place.
    // If not, attempt to infer from semifinal losers (round maxRound-1) if available.
    let thirdPlaceRid: number | null = null;
    const thirdPlaceGame = lastRoundGames.find((g) => g !== finalGame && g.w != null);
    if (thirdPlaceGame) {
      thirdPlaceRid = thirdPlaceGame.w ?? null;
    } else if (byRound[maxRound - 1]) {
      // Infer from semifinal losers if no explicit 3rd place game exists.
      const semiLosers = byRound[maxRound - 1]
        .map((g) => g.l)
        .filter((rid): rid is number => rid != null);
      // If exactly two semifinal losers exist and one appears as a winner in any later game, pick that winner; otherwise pick null.
      if (semiLosers.length >= 2) {
        // Try to locate a head-to-head between semifinal losers in any round >= maxRound - 1
        const laterGames = [
          ...(byRound[maxRound] || []),
          ...((byRound[maxRound - 1] || []).filter((g) => g.w != null)),
        ];
        const possibleThird = laterGames.find(
          (g) => g.w != null && ((semiLosers.includes(g.t1 ?? -1) && semiLosers.includes(g.t2 ?? -1)) || semiLosers.includes(g.w))
        );
        thirdPlaceRid = possibleThird?.w ?? null;
      }
    }

    return {
      champion: championRid != null ? rosterIdToName.get(championRid) || null : null,
      runnerUp: runnerUpRid != null ? rosterIdToName.get(runnerUpRid) || null : null,
      thirdPlace: thirdPlaceRid != null ? rosterIdToName.get(thirdPlaceRid) || null : null,
    };
  } catch (e) {
    console.error('Failed to derive podium from winners bracket for year', year, e);
    return null;
  }
}

/**
 * Get all teams data across multiple seasons
 * @returns Promise with object of team data by year
 */
export async function getAllTeamsData(options?: SleeperFetchOptions): Promise<Record<string, TeamData[]>> {
  try {
    const currentYearTeams = getTeamsData(LEAGUE_IDS.CURRENT, options);
    const year2024Teams = getTeamsData(LEAGUE_IDS.PREVIOUS['2024'], options);
    const year2023Teams = getTeamsData(LEAGUE_IDS.PREVIOUS['2023'], options);
    
    const [current, y2024, y2023] = await Promise.all([
      currentYearTeams,
      year2024Teams,
      year2023Teams
    ]);
    
    return {
      '2025': current,
      '2024': y2024,
      '2023': y2023
    };
  } catch (error) {
    console.error('Error fetching all teams data:', error);
    throw error;
  }
}

/**
 * Get a team's weekly matchup results for a season
 * @param leagueId The Sleeper league ID
 * @param rosterId The team's roster ID
 * @returns Promise with array of weekly results
 */
export async function getTeamWeeklyResults(leagueId: string, rosterId: number, options?: SleeperFetchOptions): Promise<{
  week: number;
  points: number;
  opponent: number;
  opponentPoints: number;
  // result is null for scheduled/unplayed games
  result: 'W' | 'L' | 'T' | null;
  opponentRosterId: number;
  // whether the game has been played (any side scored > 0)
  played: boolean;
}[]> {
  try {
    // Fantasy season uses Weeks 1–17 (exclude NFL Week 18)
    const weekPromises = Array.from({ length: 17 }, (_, i) => i + 1).map((week) =>
      getLeagueMatchups(leagueId, week, options)
    );
    
    const allWeekMatchups = await Promise.all(weekPromises);
    const teamResults = [];
    
    for (let week = 0; week < allWeekMatchups.length; week++) {
      const weekMatchups = allWeekMatchups[week];
      const teamMatchup = weekMatchups.find(m => m.roster_id === rosterId);
      
      if (teamMatchup) {
        // Find opponent
        const matchupId = teamMatchup.matchup_id;
        const opponent = weekMatchups.find(m => m.matchup_id === matchupId && m.roster_id !== rosterId);
        
        if (opponent) {
          const teamPts = teamMatchup.custom_points ?? teamMatchup.points ?? 0;
          const oppPts = opponent.custom_points ?? opponent.points ?? 0;
          const played = ((teamPts ?? 0) > 0) || ((oppPts ?? 0) > 0);
          const result: {
            week: number;
            points: number;
            opponent: number;
            opponentPoints: number;
            opponentRosterId: number;
            result: 'W' | 'L' | 'T' | null;
            played: boolean;
          } = {
            week: week + 1,
            points: teamPts,
            opponent: opponent.roster_id,
            opponentPoints: oppPts,
            opponentRosterId: opponent.roster_id,
            result: played ? (teamPts > oppPts ? 'W' : teamPts < oppPts ? 'L' : 'T') : null,
            played,
          };
          
          teamResults.push(result);
        }
      }
    }
    
    return teamResults;
  } catch (error) {
    console.error('Error fetching team weekly results:', error);
    throw error;
  }
}

export async function getCurrentStreaksForLeague(
  leagueId: string,
  options?: SleeperFetchOptions
): Promise<Record<number, { type: 'W' | 'L' | 'T' | null; length: number }>> {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const allWeekMatchups = await Promise.all(
    weeks.map((w) => getLeagueMatchups(leagueId, w, options).catch(() => [] as SleeperMatchup[]))
  );
  const resultsByRoster: Record<number, Array<'W' | 'L' | 'T' | null>> = {};
  for (const weekMatchups of allWeekMatchups) {
    if (!weekMatchups || weekMatchups.length === 0) continue;
    const byId = new Map<number, SleeperMatchup[]>();
    for (const m of weekMatchups) {
      const arr = byId.get(m.matchup_id) || [];
      arr.push(m);
      byId.set(m.matchup_id, arr);
    }
    for (const pair of byId.values()) {
      if (!pair || pair.length < 2) continue;
      const [a, b] = pair;
      const aPts = a.custom_points ?? a.points ?? 0;
      const bPts = b.custom_points ?? b.points ?? 0;
      const played = ((aPts ?? 0) > 0) || ((bPts ?? 0) > 0);
      const resA: 'W' | 'L' | 'T' | null = played ? (aPts > bPts ? 'W' : aPts < bPts ? 'L' : 'T') : null;
      const resB: 'W' | 'L' | 'T' | null = played ? (bPts > aPts ? 'W' : bPts < aPts ? 'L' : 'T') : null;
      if (!resultsByRoster[a.roster_id]) resultsByRoster[a.roster_id] = [];
      if (!resultsByRoster[b.roster_id]) resultsByRoster[b.roster_id] = [];
      resultsByRoster[a.roster_id].push(resA);
      resultsByRoster[b.roster_id].push(resB);
    }
  }
  const out: Record<number, { type: 'W' | 'L' | 'T' | null; length: number }> = {};
  for (const [ridStr, arr] of Object.entries(resultsByRoster)) {
    const rid = Number(ridStr);
    if (!Array.isArray(arr) || arr.length === 0) {
      out[rid] = { type: null, length: 0 };
      continue;
    }
    let i = arr.length - 1;
    while (i >= 0 && arr[i] == null) i--;
    if (i < 0) {
      out[rid] = { type: null, length: 0 };
      continue;
    }
    const last = arr[i];
    if (last === 'T') {
      let len = 0;
      while (i >= 0 && arr[i] === 'T') { len++; i--; }
      out[rid] = { type: 'T', length: len };
    } else {
      let len = 0;
      while (i >= 0 && arr[i] === last) { len++; i--; }
      out[rid] = { type: last as 'W' | 'L', length: len };
    }
  }
  return out;
}

/**
 * Get head-to-head records for a team against all other teams
 * @param leagueId The Sleeper league ID
 * @param rosterId The team's roster ID
 * @returns Promise with object of H2H records
 */
export async function getTeamH2HRecords(leagueId: string, rosterId: number, options?: SleeperFetchOptions): Promise<Record<number, { wins: number, losses: number, ties: number }>> {
  try {
    // Assuming 18 weeks in a season
    const weekPromises = Array.from({ length: 18 }, (_, i) => i + 1).map(week => 
      getLeagueMatchups(leagueId, week, options)
    );
    
    const allWeekMatchups = await Promise.all(weekPromises);
    const h2hRecords: Record<number, { wins: number, losses: number, ties: number }> = {};
    
    for (const weekMatchups of allWeekMatchups) {
      const teamMatchup = weekMatchups.find(m => m.roster_id === rosterId);
      
      if (teamMatchup) {
        // Find opponent
        const matchupId = teamMatchup.matchup_id;
        const opponent = weekMatchups.find(m => m.matchup_id === matchupId && m.roster_id !== rosterId);
        
        if (opponent) {
          const opponentId = opponent.roster_id;

          if (!h2hRecords[opponentId]) {
            h2hRecords[opponentId] = { wins: 0, losses: 0, ties: 0 };
          }

          const teamPts = teamMatchup.custom_points ?? teamMatchup.points ?? 0;
          const oppPts = opponent.custom_points ?? opponent.points ?? 0;
          const played = ((teamPts ?? 0) > 0) || ((oppPts ?? 0) > 0);
          if (!played) continue;

          if (teamPts > oppPts) {
            h2hRecords[opponentId].wins++;
          } else if (teamPts < oppPts) {
            h2hRecords[opponentId].losses++;
          } else {
            h2hRecords[opponentId].ties++;
          }
        }
      }
    }
    
    return h2hRecords;
  } catch (error) {
    console.error('Error fetching team H2H records:', error);
    throw error;
  }
}

/**
 * Fetch transactions for a specific league and week
 * @param leagueId The Sleeper league ID
 * @param week The week number (optional)
 * @returns Promise with array of transactions
 */
export async function getLeagueTransactions(leagueId: string, week?: number, options?: SleeperFetchOptions): Promise<SleeperTransaction[]> {
  try {
    const weekParam = week !== undefined ? `/${week}` : '';
    const bust = options?.forceFresh ? `?t=${Date.now()}` : '';
    const url = `${SLEEPER_API_BASE}/league/${leagueId}/transactions${weekParam}${bust}`;
    const init: RequestInit = options?.forceFresh ? { cache: 'no-store' } : {};
    return await sleeperFetchJson<SleeperTransaction[]>(url, init, options);
  } catch (error) {
    console.error('Error fetching league transactions:', error);
    throw error;
  }
}

export async function getLeagueTransactionsAllWeeks(leagueId: string, options?: SleeperFetchOptions): Promise<SleeperTransaction[]> {
  try {
    // Include offseason transactions (week 0) through week 18
    const weeks = Array.from({ length: 19 }, (_, i) => i); // 0..18
    const weekly = await Promise.all(
      weeks.map((w) => getLeagueTransactions(leagueId, w, options).catch(() => [] as SleeperTransaction[]))
    );
    return weekly.flat();
  } catch (error) {
    console.error('Error fetching all-week league transactions:', error);
    throw error;
  }
}

/**
 * Fetch all trades for a specific league
 * @param leagueId The Sleeper league ID
 * @returns Promise with array of trade transactions
 */
export async function getLeagueTrades(leagueId: string, options?: SleeperFetchOptions): Promise<SleeperTransaction[]> {
  try {
    // Fetch transactions for all weeks in parallel including offseason week 0
    const weeks = Array.from({ length: 19 }, (_, i) => i); // 0..18
    const weeklyTransactions = await Promise.all(
      weeks.map(week =>
        getLeagueTransactions(leagueId, week, options).catch(() => [] as SleeperTransaction[])
      )
    );
    const allTransactions = weeklyTransactions.flat();
    // Only include completed trades
    return allTransactions.filter(
      (transaction) => {
        if (!transaction || transaction.type !== 'trade') return false;
        const statusNorm = String((transaction as unknown as { status?: unknown }).status ?? '').trim().toLowerCase();
        return statusNorm === 'complete' || statusNorm === 'completed';
      }
    );
  } catch (error) {
    console.error('Error fetching league trades:', error);
    throw error;
  }
}

/**
 * Fetch all trades across all league years
 * @returns Promise with object of trades by year
 */
export async function getAllLeagueTrades(options?: SleeperFetchOptions): Promise<Record<string, SleeperTransaction[]>> {
  try {
    const yearToLeague = await buildYearToLeagueMapUnique(options);
    const pairs = await Promise.all(
      Object.entries(yearToLeague).map(async ([year, leagueId]) => {
        if (!leagueId) return [year, [] as SleeperTransaction[]] as const;
        const trades = await getLeagueTrades(leagueId, options);
        return [year, trades] as const;
      })
    );
    const tradesByYear: Record<string, SleeperTransaction[]> = {};
    for (const [year, trades] of pairs) {
      tradesByYear[year] = trades;
    }
    return tradesByYear;
  } catch (error) {
    console.error('Error fetching all league trades:', error);
    throw error;
  }
}

/**
 * Fetch all drafts for a league
 * @param leagueId The Sleeper league ID
 * @returns Promise with array of drafts
 */
export async function getLeagueDrafts(leagueId: string, options?: SleeperFetchOptions): Promise<SleeperDraft[]> {
  return sleeperFetchJson<SleeperDraft[]>(`${SLEEPER_API_BASE}/league/${leagueId}/drafts`, undefined, options);
}

/**
 * Fetch a single draft by ID (to get draft_order mapping)
 * @param draftId The Sleeper draft ID
 */
export async function getDraftById(draftId: string, options?: SleeperFetchOptions): Promise<SleeperDraftDetails> {
  return sleeperFetchJson<SleeperDraftDetails>(`${SLEEPER_API_BASE}/draft/${draftId}`, undefined, options);
}

/**
 * Fetch all picks for a draft
 * @param draftId The Sleeper draft ID
 * @returns Promise with array of draft picks
 */
export async function getDraftPicks(draftId: string, options?: SleeperFetchOptions): Promise<SleeperDraftPick[]> {
  return sleeperFetchJson<SleeperDraftPick[]>(`${SLEEPER_API_BASE}/draft/${draftId}/picks`, undefined, options);
}

/**
 * NFL season aggregate player stats (subset of fields we use)
 * Keys are Sleeper player IDs (stringified numbers).
 * Example endpoint: https://api.sleeper.app/v1/stats/nfl/regular/2024
 */
export interface SleeperNFLSeasonPlayerStats {
  gp?: number;             // games played
  gms_active?: number;     // games active (fallback)
  pts_ppr?: number;        // total PPR fantasy points
  pts_std?: number;        // total standard points (not used here)
  // ... many other fields exist; we only type what's needed
  // Allow dynamic stat keys so we can apply league scoring_settings directly
  [stat: string]: number | undefined;
}

// Simple in-memory cache for season stats within a single runtime
const seasonStatsCache: Record<string, { ts: number; data: Record<string, SleeperNFLSeasonPlayerStats> }> = {};

// In-memory cache for weekly stats
const weekStatsCache: Record<string, { ts: number; data: Record<string, SleeperNFLSeasonPlayerStats> }> = {};

/**
 * Fetch NFL season stats from Sleeper and cache them briefly to avoid repeated large downloads.
 * @param season Year as string or number (e.g., '2024')
 * @param ttlMs Cache TTL in milliseconds (default 15 minutes)
 */
export async function getNFLSeasonStats(
  season: string | number,
  ttlMs: number = 15 * 60 * 1000,
  options?: SleeperFetchOptions
): Promise<Record<string, SleeperNFLSeasonPlayerStats>> {
  const key = String(season);
  const now = Date.now();
  const cached = seasonStatsCache[key];
  if (cached && now - cached.ts < ttlMs) return cached.data;

  const url = `${SLEEPER_API_BASE}/stats/nfl/regular/${key}`;
  const json = await sleeperFetchJson<Record<string, SleeperNFLSeasonPlayerStats>>(url, undefined, options);
  seasonStatsCache[key] = { ts: now, data: json };
  return json;
}

/**
 * Compute total PPR and PPG for a set of players for a given season.
 * @param season Season year (e.g., '2024')
 * @param playerIds Array of Sleeper player IDs
 */
export async function getPlayersPPRAndPPG(
  season: string | number,
  playerIds: string[],
  options?: SleeperFetchOptions
): Promise<Record<string, { totalPPR: number; gp: number; ppg: number }>> {
  const stats = await getNFLSeasonStats(season, 15 * 60 * 1000, options);
  const result: Record<string, { totalPPR: number; gp: number; ppg: number }> = {};
  for (const pid of playerIds) {
    const s = stats[pid];
    const gp = (s?.gp ?? s?.gms_active ?? 0) || 0;
    const total = s?.pts_ppr ?? 0;
    const ppg = gp > 0 ? total / gp : 0;
    result[pid] = { totalPPR: total, gp, ppg };
  }
  return result;
}

// ==========================
// Awards (MVP / Rookie of the Year) using league custom scoring
// ==========================

export interface AwardWinner {
  playerId: string;
  name: string;
  points: number;
  rosterId: number | null;
  teamName: string | null;
}

export interface SeasonAwards {
  season: string;
  throughWeek: number; // inclusive
  mvp: AwardWinner[];  // support ties
  roy: AwardWinner[];  // support ties
}

function toNumericScoring(obj: Record<string, unknown> | undefined | null): Record<string, number> {
  const res: Record<string, number> = {};
  if (!obj) return res;
  for (const [k, v] of Object.entries(obj)) {
    const num = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : NaN);
    if (Number.isFinite(num)) res[k] = num as number;
  }
  return res;
}

/**
 * Compute per-player custom fantasy points for a single week using league scoring_settings.
 */
function computeWeekPointsCustom(
  weeklyStats: Record<string, SleeperNFLSeasonPlayerStats>,
  scoring: Record<string, number>
): Record<string, number> {
  const totals: Record<string, number> = {};
  const entries = Object.entries(weeklyStats) as Array<[string, SleeperNFLSeasonPlayerStats]>;
  for (const [playerId, stat] of entries) {
    let sum = 0;
    for (const [k, mult] of Object.entries(scoring)) {
      const raw = stat?.[k];
      if (!raw) continue;
      sum += (raw || 0) * (mult || 0);
    }
    if (sum !== 0) totals[playerId] = Number(sum.toFixed(4));
  }
  return totals;
}

/**
 * Aggregate per-player totals using the league's own computed weekly player points
 * from matchups (players_points). This matches Sleeper's custom scoring exactly,
 * including bonuses, TE premiums, kicker distances, etc.
 */
async function computeSeasonTotalsFromLeagueMatchups(
  leagueId: string,
  endWeek: number = 14,
  options?: SleeperFetchOptions
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  const maxWeek = Math.max(1, Math.min(18, Math.floor(endWeek)));
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  const weeklyMatchupsArr = await Promise.all(
    weeks.map((week) => getLeagueMatchups(leagueId, week, options).catch(() => [] as SleeperMatchup[]))
  );
  for (const matchups of weeklyMatchupsArr) {
    for (const m of matchups) {
      const pp = m.players_points || {};
      for (const [pid, pts] of Object.entries(pp)) {
        if (!Number.isFinite(pts as number)) continue;
        totals[pid] = Number(((totals[pid] || 0) + (pts as number)).toFixed(4));
      }
    }
  }
  return totals;
}

/**
 * Aggregate custom-scored totals across weeks 1..endWeek for a season and league.
 */
export async function computeSeasonTotalsCustomScoring(
  season: string | number,
  leagueId: string,
  endWeek: number = 14,
  options?: SleeperFetchOptions
): Promise<Record<string, number>> {
  // Preferred: derive per-player totals from league matchups players_points (exact parity with Sleeper)
  try {
    const fromMatchups = await computeSeasonTotalsFromLeagueMatchups(leagueId, endWeek, options);
    return fromMatchups;
  } catch {
    // Fallback: compute from weekly NFL stats and league scoring_settings (approximation)
    const league = await getLeague(leagueId, options);
    const scoring = toNumericScoring(league?.scoring_settings as Record<string, unknown>);
    const weeks = Array.from({ length: Math.max(1, Math.min(18, Math.floor(endWeek))) }, (_, i) => i + 1);
    const weeklyStatsArr = await Promise.all(
      weeks.map((w) => getNFLWeekStats(season, w, 15 * 60 * 1000, options).catch(() => ({} as Record<string, SleeperNFLSeasonPlayerStats>)))
    );
    const totals: Record<string, number> = {};
    for (const weeklyStats of weeklyStatsArr) {
      const weekPoints = computeWeekPointsCustom(weeklyStats, scoring);
      for (const [pid, pts] of Object.entries(weekPoints)) {
        totals[pid] = Number(((totals[pid] || 0) + pts).toFixed(4));
      }
    }
    return totals;
  }
}

/**
 * Compute per-player totals for a season using the league's scoring_settings
 * applied to NFL weekly stats (Weeks 1..endWeek). This includes players even if
 * they were not rostered in your league for certain weeks.
 */
export async function computeSeasonTotalsCustomScoringFromStats(
  season: string | number,
  leagueId: string,
  endWeek: number = 18,
  options?: SleeperFetchOptions
): Promise<Record<string, number>> {
  const league = await getLeague(leagueId, options);
  const scoring = toNumericScoring(league?.scoring_settings as Record<string, unknown>);
  const weeks = Array.from({ length: Math.max(1, Math.min(18, Math.floor(endWeek))) }, (_, i) => i + 1);
  const weeklyStatsArr = await Promise.all(
    weeks.map((w) => getNFLWeekStats(season, w, 15 * 60 * 1000, options).catch(() => ({} as Record<string, SleeperNFLSeasonPlayerStats>)))
  );
  const totals: Record<string, number> = {};
  for (const weeklyStats of weeklyStatsArr) {
    const weekPoints = computeWeekPointsCustom(weeklyStats, scoring);
    for (const [pid, pts] of Object.entries(weekPoints)) {
      totals[pid] = Number(((totals[pid] || 0) + pts).toFixed(4));
    }
  }
  return totals;
}

/**
 * Find the roster (team) that owned a player as of the last played week up to endWeek, scanning backward.
 * Uses weekly matchups players/starters arrays as a proxy for roster ownership.
 */
export async function findPlayerOwnerAtOrBeforeWeek(
  leagueId: string,
  playerId: string,
  endWeek: number,
  options?: SleeperFetchOptions,
  nameMap?: Map<number, string>
): Promise<{ rosterId: number | null; teamName: string | null }> {
  // Allow caller to pass a precomputed name map to avoid redundant network calls
  const rosterIdToName = nameMap ?? (await getRosterIdToTeamNameMap(leagueId, options));
  const weeks = Array.from({ length: Math.max(1, Math.min(14, Math.floor(endWeek))) }, (_, i) => endWeek - i);

  // Derive a shorter per-request timeout for these many small calls to prevent long sequential stalls
  const baseTimeout = Math.max(1, options?.timeoutMs ?? 8000);
  const perWeekOpts: SleeperFetchOptions = { ...(options || {}), timeoutMs: Math.min(5000, baseTimeout) };

  // Fetch all candidate weeks in parallel, then scan from most recent to oldest
  const weeklyMatchupsArr: SleeperMatchup[][] = await Promise.all(
    weeks.map((w) => getLeagueMatchups(leagueId, w, perWeekOpts).catch(() => [] as SleeperMatchup[]))
  );

  for (let idx = 0; idx < weeks.length; idx++) {
    if (options?.signal?.aborted) return { rosterId: null, teamName: null };
    const matchups = weeklyMatchupsArr[idx] || [];
    for (const m of matchups) {
      const has = (m.players || []).includes(playerId) || (m.starters || []).includes(playerId);
      if (has) {
        const name = rosterIdToName.get(m.roster_id) || null;
        return { rosterId: m.roster_id, teamName: name };
      }
    }
  }

  // Fallback: if never found in matchups, check roster membership for the league (fast timeout)
  try {
    const rosters = await getLeagueRosters(leagueId, perWeekOpts);
    for (const r of rosters) {
      const has = (r.players || []).includes(playerId);
      if (has) {
        const name = rosterIdToName.get(r.roster_id) || null;
        return { rosterId: r.roster_id, teamName: name };
      }
    }
  } catch {}
  return { rosterId: null, teamName: null };
}

/** Determine if a player is a rookie for the given season. */
function isRookieForSeason(player: SleeperPlayer | undefined, season: string | number): boolean {
  if (!player) return false;
  const s = String(season);
  // Prefer explicit rookie_year from Sleeper
  if (player.rookie_year !== undefined && String(player.rookie_year) === s) return true;
  // Fallback: if rookie_year is unavailable, we cannot reliably infer from years_exp across historical seasons.
  // Return false rather than guess.
  return false;
}

/**
 * Compute MVP and ROY for a season up to endWeek using league custom scoring.
 */
export async function getSeasonAwardsUsingLeagueScoring(
  season: string | number,
  leagueId: string,
  endWeek: number = 14,
  options?: SleeperFetchOptions
): Promise<SeasonAwards> {
  // Prefer league matchups-derived totals (players_points) to match exact custom scoring.
  // Fallback to deriving from weekly NFL stats if matchups data is unavailable.
  let totals: Record<string, number> = {};
  try {
    totals = await computeSeasonTotalsFromLeagueMatchups(leagueId, endWeek, options);
  } catch {}
  if (!totals || Object.keys(totals).length === 0) {
    totals = await computeSeasonTotalsCustomScoring(season, leagueId, endWeek, options);
  }
  const players = await getAllPlayersCached(12 * 60 * 60 * 1000, options);

  // Restrict to real players in eligible positions (exclude team/DST pseudo-IDs like TEAM_BAL)
  const allowedPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
  const eligibleIds = Object.keys(totals).filter((pid) => {
    const pl = players[pid];
    if (!pl) return false; // filter out pseudo/team IDs not present in players map
    const pos = (pl.position || '').toUpperCase();
    return allowedPositions.has(pos);
  });

  // If no eligible players, return empty awards cleanly
  if (eligibleIds.length === 0) {
    return {
      season: String(season),
      throughWeek: Math.max(1, Math.min(14, Math.floor(endWeek))),
      mvp: [],
      roy: [],
    };
  }

  // Find MVP (max total) among eligible players only
  const MIN_POINTS = 0.01; // avoid listing mass ties when all totals are ~0
  let maxPts = -Infinity;
  for (const pid of eligibleIds) {
    const v = totals[pid] || 0;
    if (v > maxPts) maxPts = v;
  }
  const eps = 1e-6;
  let mvpIds = eligibleIds.filter((pid) => Math.abs((totals[pid] || 0) - maxPts) < eps);
  if (!(maxPts > MIN_POINTS)) {
    // No meaningful points yet -> no winner for this season
    mvpIds = [];
  }

  // Find ROY (max among rookies for this season) from eligible players only
  const rookieTotals: Record<string, number> = {};
  for (const pid of eligibleIds) {
    const pl = players[pid];
    const pts = totals[pid] || 0;
    if (isRookieForSeason(pl, season)) rookieTotals[pid] = pts;
  }
  let royMax = -Infinity;
  for (const v of Object.values(rookieTotals)) if (v > royMax) royMax = v;
  let royIds = Object.keys(rookieTotals).filter((pid) => Math.abs((rookieTotals[pid] || 0) - royMax) < eps);
  if (!(royMax > MIN_POINTS)) {
    // No meaningful rookie scoring detected in primary path
    royIds = [];
  }

  // Fallback: derive rookies by first season with stats among a small lookback window
  if (royIds.length === 0) {
    const seasonNum = Number(season);
    const prevSeasons: number[] = [seasonNum - 1, seasonNum - 2].filter((n) => Number.isFinite(n) && n >= 2000);
    const hadPrev = new Set<string>();
    for (const y of prevSeasons) {
      try {
        const stats = await getNFLSeasonStats(y, 15 * 60 * 1000, options);
        for (const pid of Object.keys(stats)) {
          const s = stats[pid];
          const gp = (s?.gp ?? s?.gms_active ?? 0) || 0;
          const total = s?.pts_ppr ?? 0;
          if (gp > 0 || (total && total > 0)) hadPrev.add(pid);
        }
      } catch {}
    }
    const rookieEligibleIds = eligibleIds.filter((pid) => !hadPrev.has(pid));
    if (rookieEligibleIds.length > 0) {
      let rMax = -Infinity;
      for (const pid of rookieEligibleIds) {
        const v = totals[pid] || 0;
        if (v > rMax) rMax = v;
      }
      royIds = rookieEligibleIds.filter((pid) => Math.abs((totals[pid] || 0) - rMax) < eps);
      if (!(rMax > MIN_POINTS)) {
        royIds = [];
      }
    }
  }

  async function buildWinners(ids: string[]): Promise<AwardWinner[]> {
    if (!ids || ids.length === 0) return [];
    // Reuse a single rosterId->teamName map to avoid redundant fetches per winner
    const rosterIdToName = await getRosterIdToTeamNameMap(leagueId, options);
    const winners = await Promise.all(
      ids.map(async (pid) => {
        const { rosterId, teamName } = await findPlayerOwnerAtOrBeforeWeek(leagueId, pid, endWeek, options, rosterIdToName);
        const pl = players[pid];
        const name = [pl?.first_name || '', pl?.last_name || ''].join(' ').trim() || pid;
        return {
          playerId: pid,
          name,
          points: Number((totals[pid] || 0).toFixed(2)),
          rosterId,
          teamName,
        } as AwardWinner;
      })
    );
    return winners;
  }

  const [mvp, roy] = await Promise.all([
    buildWinners(mvpIds),
    buildWinners(royIds),
  ]);

  return {
    season: String(season),
    throughWeek: Math.max(1, Math.min(14, Math.floor(endWeek))),
    mvp,
    roy,
  };
}

