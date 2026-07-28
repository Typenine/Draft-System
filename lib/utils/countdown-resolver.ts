/**
 * Six-stage countdown resolver for the East v. West homepage.
 *
 * Always returns exactly two CountdownCard objects representing the two most
 * relevant upcoming events for the current moment in the league calendar.
 *
 * Stages per cycle (each stage runs between two consecutive calendar events):
 *   1. leagueYearStart → rookieDraft         → [rookieDraft, regularSeasonStart]
 *   2. rookieDraft → faBiddingStart           → [faBiddingStart, regularSeasonStart]
 *   3. faBiddingStart → regularSeasonStart    → [regularSeasonStart, tradeDeadline]
 *   4. regularSeasonStart → tradeDeadline     → [tradeDeadline, postseasonStart]
 *   5. tradeDeadline → postseasonStart        → [postseasonStart, nextLeagueYearStart]
 *   6. postseasonStart → nextLeagueYearStart  → [nextLeagueYearStart, nextCycle.rookieDraft]
 *
 * At nextLeagueYearStart the next calendar cycle begins at Stage 1.
 *
 * Calendar data lives in LEAGUE_CALENDARS (league-calendar.ts).
 * To add a new season, append an entry there — no changes needed here.
 *
 * Invariants guaranteed:
 *   - Exactly two cards are always returned.
 *   - Every returned targetDate is strictly later than `now`.
 *   - Expired events from prior cycles are never shown.
 */

import {
  selectCalendar,
  nextCalendar,
} from '@/lib/constants/league-calendar';

export type CountdownCard = {
  title: string;
  targetDate: Date;
};

/**
 * Homepage phase — drives which content sections are shown.
 *
 *   1  post_championship_pre_draft   – offseason recap is primary
 *   2  post_draft_pre_fa             – roster consequences of draft
 *   3  fa_open_pre_season            – free agency active
 *   4  regular_season                – live matchups, through trade deadline
 *   5  post_deadline_pre_postseason  – playoff race
 *   6  postseason                    – playoff center
 */
export type HomepagePhase =
  | 'post_championship_pre_draft'
  | 'post_draft_pre_fa'
  | 'fa_open_pre_season'
  | 'regular_season'
  | 'post_deadline_pre_postseason'
  | 'postseason';

export function getHomepagePhase(now: Date = new Date()): HomepagePhase {
  const cal = selectCalendar(now);
  const ts = now.getTime();

  if (ts >= cal.postseasonStart.getTime())    return 'postseason';
  if (ts >= cal.tradeDeadline.getTime())      return 'post_deadline_pre_postseason';
  if (ts >= cal.regularSeasonStart.getTime()) return 'regular_season';
  if (ts >= cal.faBiddingStart.getTime())     return 'fa_open_pre_season';
  if (ts >= cal.rookieDraft.getTime())        return 'post_draft_pre_fa';
  return 'post_championship_pre_draft';
}

/** Return the two-card countdown pair for the current date. */
export function getCountdownCards(now: Date = new Date()): [CountdownCard, CountdownCard] {
  const cal = selectCalendar(now);
  const ts = now.getTime();
  const next = nextCalendar(cal);

  // Stage 6: postseason through next league year
  if (ts >= cal.postseasonStart.getTime()) {
    return [
      { title: 'New league year in', targetDate: cal.nextLeagueYearStart },
      next?.rookieDraft
        ? { title: 'Next draft in',   targetDate: next.rookieDraft }
        : { title: 'Next season in',  targetDate: next?.regularSeasonStart ?? cal.nextLeagueYearStart },
    ];
  }

  // Stage 5: trade deadline through postseason
  if (ts >= cal.tradeDeadline.getTime()) {
    return [
      { title: 'Postseason starts in', targetDate: cal.postseasonStart },
      { title: 'New league year in',   targetDate: cal.nextLeagueYearStart },
    ];
  }

  // Stage 4: regular season through trade deadline
  if (ts >= cal.regularSeasonStart.getTime()) {
    return [
      { title: 'Trade deadline in',    targetDate: cal.tradeDeadline },
      { title: 'Postseason starts in', targetDate: cal.postseasonStart },
    ];
  }

  // Stage 3: FA bidding open through regular season start
  if (ts >= cal.faBiddingStart.getTime()) {
    return [
      { title: 'Season starts in',  targetDate: cal.regularSeasonStart },
      { title: 'Trade deadline in', targetDate: cal.tradeDeadline },
    ];
  }

  // Stage 2: rookie draft through FA bidding start
  if (ts >= cal.rookieDraft.getTime()) {
    return [
      { title: 'FA bidding opens in', targetDate: cal.faBiddingStart },
      { title: 'Season starts in',    targetDate: cal.regularSeasonStart },
    ];
  }

  // Stage 1: league year start through rookie draft (default offseason)
  return [
    { title: 'Draft in',         targetDate: cal.rookieDraft },
    { title: 'Season starts in', targetDate: cal.regularSeasonStart },
  ];
}
