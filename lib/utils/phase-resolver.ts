/**
 * Phase resolver utility for determining the current site phase and recap year.
 *
 * getRecapYear() is the source of truth for which completed fantasy season to
 * display. It is based on IMPORTANT_DATES, not on the calendar year, so it
 * always returns the most recently finished season regardless of whether the
 * Sleeper NFL state has caught up.
 */

import { IMPORTANT_DATES, CURRENT_SEASON } from '../constants/league';

export type SitePhase =
  | 'post_championship_pre_draft'
  | 'post_draft_pre_season'
  | 'regular_season'
  | 'playoffs';

function getNowInChicago(): number {
  const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  return new Date(nowStr).getTime();
}

export function getCurrentPhase(): SitePhase {
  const now = getNowInChicago();
  const draftDate   = IMPORTANT_DATES.NEXT_DRAFT.getTime();
  const seasonStart = IMPORTANT_DATES.NFL_WEEK_1_START.getTime();
  const playoffsTs  = IMPORTANT_DATES.PLAYOFFS_START.getTime();
  const newYearTs   = IMPORTANT_DATES.NEW_LEAGUE_YEAR.getTime();

  // After new league year, reset to pre-draft phase of next cycle
  if (now >= newYearTs) return 'post_championship_pre_draft';
  if (now >= playoffsTs) return 'playoffs';
  if (now >= seasonStart) return 'regular_season';
  if (now >= draftDate) return 'post_draft_pre_season';
  return 'post_championship_pre_draft';
}

export function hasRegularSeasonStarted(): boolean {
  const now = getNowInChicago();
  return now >= IMPORTANT_DATES.NFL_WEEK_1_START.getTime();
}

export function havePlayoffsStarted(): boolean {
  const now = getNowInChicago();
  return now >= IMPORTANT_DATES.PLAYOFFS_START.getTime();
}

/**
 * Returns the year of the most recently *completed* fantasy season.
 *
 * A season is considered complete once NEW_LEAGUE_YEAR has passed (after the
 * Super Bowl in February). Before that date, the current season (CURRENT_SEASON)
 * is still potentially in progress, so the last completed season is the prior year.
 *
 * Examples with CURRENT_SEASON = '2026':
 *   - Any date before Feb 7 2027 → 2025 (2026 season not yet concluded)
 *   - Any date on/after Feb 7 2027 → 2026 (2026 season is complete)
 *
 * Pass `now` for testability; defaults to the real current time.
 */
export function getRecapYear(now: Date = new Date()): number {
  const currentSeason = parseInt(CURRENT_SEASON, 10);
  if (now.getTime() >= IMPORTANT_DATES.NEW_LEAGUE_YEAR.getTime()) {
    return currentSeason;
  }
  return currentSeason - 1;
}

export function shouldShowRecapByDefault(): boolean {
  const phase = getCurrentPhase();
  return (
    phase === 'post_championship_pre_draft' ||
    phase === 'regular_season' ||
    phase === 'playoffs'
  );
}
