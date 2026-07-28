// League constants for East v. West fantasy football league

import { LEAGUE_CALENDARS } from './league-calendar';

// Sleeper League IDs
export const LEAGUE_IDS = {
  CURRENT: '1312872384503484416', // 2026
  PREVIOUS: {
    '2025': '1205237529570193408',
    '2024': '1116504942988107776',
    '2023': '991521604930772992',
  }
};

export const CURRENT_SEASON = '2026';

// Accepts a string or number season. Coerces internally so callers can pass a
// numeric season (e.g. a DB integer column) without silently getting null — the
// comparison against CURRENT_SEASON (a string) is otherwise strict and would fail
// for the current season when given a number. See run-newsletter.mjs queue path.
export function getLeagueIdForSeason(season: string | number): string | null {
  const s = String(season);
  if (s === CURRENT_SEASON) return LEAGUE_IDS.CURRENT;
  const prev = LEAGUE_IDS.PREVIOUS[s as keyof typeof LEAGUE_IDS.PREVIOUS];
  return prev || null;
}

// Canon Team Names - use these everywhere, never display Sleeper usernames or real names
export const TEAM_NAMES = [
  'Belltown Raptors',
  'Double Trouble',
  'Elemental Heroes',
  'Mt. Lebanon Cake Eaters',
  'Belleview Badgers',
  'BeerNeverBrokeMyHeart',
  'Detroit Dawgs',
  'bop pop',
  'Cascade Marauders',
  'Red Pandas',
  'The Lone Ginger',
  'Bimg Bamg Boomg'
];

// Current year for copyright and other displays
export const CURRENT_YEAR = new Date().getFullYear();

// IMPORTANT_DATES is retained for existing consumers, but all values now come
// from the same year-aware calendar used by the homepage countdown resolver.
// This prevents Draft Central, APIs, newsletters, and homepage phases from
// drifting onto separate hardcoded dates.
const currentCalendar =
  LEAGUE_CALENDARS.find((calendar) => calendar.season === Number(CURRENT_SEASON)) ??
  LEAGUE_CALENDARS[0];
const nextCalendar =
  LEAGUE_CALENDARS.find((calendar) => calendar.season === Number(CURRENT_SEASON) + 1) ??
  currentCalendar;

export const IMPORTANT_DATES = {
  NFL_WEEK_1_START: currentCalendar.regularSeasonStart,
  TRADE_DEADLINE: currentCalendar.tradeDeadline,
  PLAYOFFS_START: currentCalendar.postseasonStart,
  NEW_LEAGUE_YEAR: currentCalendar.nextLeagueYearStart,
  NEXT_DRAFT: currentCalendar.rookieDraft,
  FA_BIDDING_START: currentCalendar.faBiddingStart,
  NEXT_LEAGUE_YEAR_DRAFT: nextCalendar.rookieDraft,
  NEXT_LEAGUE_YEAR_SEASON_START: nextCalendar.regularSeasonStart,
};

// Champions by year
export const CHAMPIONS = {
  '2026': { champion: 'TBD',                    runnerUp: 'TBD',              thirdPlace: 'TBD' },
  '2025': { champion: 'BeerNeverBrokeMyHeart',  runnerUp: 'Double Trouble',   thirdPlace: 'Mt. Lebanon Cake Eaters' },
  '2024': { champion: 'Belltown Raptors',       runnerUp: 'Double Trouble',   thirdPlace: 'Belleview Badgers' },
  '2023': { champion: 'Double Trouble',         runnerUp: 'Elemental Heroes', thirdPlace: 'Detroit Dawgs' },
};