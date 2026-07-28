/**
 * Year-aware league calendar for the East v. West countdown resolver.
 *
 * Each entry covers exactly one league year. The resolver selects the calendar
 * whose leagueYearStart ≤ now and uses its dates to determine the current phase
 * and two-card countdown targets.
 *
 * Confirmed dates: sourced from official NFL / league announcements.
 * Estimated dates: best-estimate placeholders based on NFL scheduling patterns.
 * Entries in `estimatedFields` are estimates — update them when official dates
 * are released; do not rely on them for precision timing.
 *
 * To add a new season, append an entry to LEAGUE_CALENDARS. No changes are
 * needed in countdown-resolver.ts.
 */

export type LeagueCalendar = {
  /** Fantasy season year (matches Sleeper season label). */
  season: number;
  /** Start of this league year (immediately after the Super Bowl for the prior NFL season). */
  leagueYearStart: Date;
  /** Rookie draft date. */
  rookieDraft: Date;
  /** FA bidding opens — first Monday after preseason Week 1. */
  faBiddingStart: Date;
  /** NFL regular-season opening kickoff. */
  regularSeasonStart: Date;
  /** End of Week 12 Monday Night Football (official East v. West trade deadline). */
  tradeDeadline: Date;
  /** Week 15 Thursday Night Football kickoff (East v. West playoffs begin). */
  postseasonStart: Date;
  /** Start of the NEXT league year (after the following Super Bowl). Required for cycle boundary detection. */
  nextLeagueYearStart: Date;
  /**
   * Fields whose exact dates are best-estimate placeholders.
   * Update these when official dates are confirmed.
   */
  estimatedFields?: ReadonlyArray<
    | 'rookieDraft'
    | 'faBiddingStart'
    | 'regularSeasonStart'
    | 'tradeDeadline'
    | 'postseasonStart'
    | 'nextLeagueYearStart'
  >;
};

/**
 * All supported league cycles, sorted ascending by leagueYearStart.
 *
 * 2026 cycle — all dates confirmed or already established.
 * 2027 cycle — rookieDraft confirmed (July 10); remaining dates are estimates.
 * 2028 cycle — all dates are estimates; present to ensure the resolver never
 *              exposes expired 2027 targets after February 2028.
 */
export const LEAGUE_CALENDARS: ReadonlyArray<LeagueCalendar> = [
  {
    season: 2026,
    // After Super Bowl LX (2025 NFL season, played February 2026)
    leagueYearStart:    new Date('2026-02-09T18:30:00-05:00'),
    rookieDraft:        new Date('2026-07-18T13:00:00-04:00'),
    // First Monday after preseason Week 1 2026 (rulebook §4.5(b))
    faBiddingStart:     new Date('2026-08-17T00:00:00-05:00'),
    // 2026 NFL Kickoff Game: Patriots at Seahawks, Wednesday night
    regularSeasonStart: new Date('2026-09-09T20:20:00-04:00'),
    // End of Week 12 Monday Night Football 2026
    tradeDeadline:      new Date('2026-11-30T23:45:00-05:00'),
    // Week 15 Thursday Night Football 2026
    postseasonStart:    new Date('2026-12-17T20:20:00-05:00'),
    // After Super Bowl LXI (2026 NFL season, played February 2027)
    nextLeagueYearStart: new Date('2027-02-07T18:30:00-05:00'),
  },
  {
    season: 2027,
    leagueYearStart:    new Date('2027-02-07T18:30:00-05:00'),
    // July 10 confirmed as draft day
    rookieDraft:        new Date('2027-07-10T13:00:00-04:00'),
    // Estimates below — update when the 2027 NFL schedule is officially released
    faBiddingStart:     new Date('2027-08-16T00:00:00-05:00'),
    regularSeasonStart: new Date('2027-09-09T20:20:00-04:00'),
    tradeDeadline:      new Date('2027-11-29T23:45:00-05:00'),
    postseasonStart:    new Date('2027-12-16T20:20:00-05:00'),
    // After Super Bowl LXII (2027 NFL season, played ~February 2028)
    nextLeagueYearStart: new Date('2028-02-06T18:30:00-05:00'),
    estimatedFields: [
      'faBiddingStart',
      'regularSeasonStart',
      'tradeDeadline',
      'postseasonStart',
      'nextLeagueYearStart',
    ],
  },
  {
    season: 2028,
    leagueYearStart:    new Date('2028-02-06T18:30:00-05:00'),
    // All 2028 dates are rough estimates based on NFL scheduling patterns
    rookieDraft:        new Date('2028-07-12T13:00:00-04:00'),
    faBiddingStart:     new Date('2028-08-20T00:00:00-05:00'),
    regularSeasonStart: new Date('2028-09-07T20:20:00-04:00'),
    tradeDeadline:      new Date('2028-11-27T23:45:00-05:00'),
    postseasonStart:    new Date('2028-12-14T20:20:00-05:00'),
    nextLeagueYearStart: new Date('2029-02-04T18:30:00-05:00'),
    estimatedFields: [
      'rookieDraft',
      'faBiddingStart',
      'regularSeasonStart',
      'tradeDeadline',
      'postseasonStart',
      'nextLeagueYearStart',
    ],
  },
] as const;

/**
 * Select the active calendar for a given timestamp.
 *
 * Returns the most recent calendar whose leagueYearStart is on or before `now`.
 * Falls back to the earliest calendar for dates that precede all known starts.
 */
export function selectCalendar(now: Date): LeagueCalendar {
  const ts = now.getTime();
  let best: LeagueCalendar = LEAGUE_CALENDARS[0];
  for (const cal of LEAGUE_CALENDARS) {
    if (ts >= cal.leagueYearStart.getTime()) best = cal;
  }
  return best;
}

/**
 * Return the next calendar after the given one, or null if none.
 */
export function nextCalendar(cal: LeagueCalendar): LeagueCalendar | null {
  for (let i = 0; i < LEAGUE_CALENDARS.length - 1; i++) {
    if (LEAGUE_CALENDARS[i] === cal) return LEAGUE_CALENDARS[i + 1];
  }
  return null;
}
