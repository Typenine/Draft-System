// Per-league explicit mapping of roster_id -> canonical team name.
// Fill these maps to guarantee correct mapping for trades, standings, teams, etc.
// Get roster_id and user info via /api/debug/roster-map?year=2025 (or 2024/2023)

export type RosterToCanonMap = Record<number, string>;

export const LEAGUE_ROSTER_CANONICAL: Record<string, RosterToCanonMap> = {
  // '1205237529570193408': {
  //   1: 'Belltown Raptors',
  //   2: 'Double Trouble',
  //   ...
  // },
  // '1116504942988107776': {
  //   ...
  // },
  // '991521604930772992': {
  //   ...
  // },
};
