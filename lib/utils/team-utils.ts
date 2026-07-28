/**
 * Utility functions for team-related operations
 * Includes functions for team logos, colors, and other team-specific operations
 */

import { TEAM_COLORS, TeamColors } from '../constants/team-colors';
import { TEAM_NAMES } from '../constants/league';
import { CANONICAL_TEAM_BY_USER_ID, TEAM_ALIASES, normalizeName } from '../constants/team-mapping';

/**
 * Shared position ranking for roster sorting
 * Order: QB > RB > WR > TE > K > DEF/DST > IDPs (DL/DE/DT/EDGE > LB > DB/CB/S)
 */
export const POSITION_RANK: Record<string, number> = {
  // Offense
  QB: 0,
  RB: 1,
  HB: 1,
  FB: 1,
  WR: 2,
  TE: 3,
  FLEX: 3,
  K: 4,
  PK: 4,
  // Team defense
  DEF: 5,
  DST: 5,
  // IDP front
  DL: 6,
  DE: 6,
  DT: 6,
  EDGE: 6,
  // IDP linebackers
  LB: 7,
  // IDP secondary
  DB: 8,
  CB: 8,
  S: 8,
  FS: 8,
  SS: 8,
};

/**
 * Normalize a team name for map lookups: collapses smart/curly quotes to ASCII equivalents
 * and trims whitespace. Sleeper can return names with Unicode apostrophes while our constants
 * use ASCII, causing silent lookup misses.
 */
const normalizeTeamKeyForLookup = (name: string): string =>
  name
    .replace(/[''‚‛′‵`]/g, "'") // smart/back single quotes → ASCII apostrophe
    .replace(/[""„‟″‶]/g, '"')        // smart double quotes → ASCII
    .trim();

/**
 * Converts a team name to a URL-friendly format for logo paths
 * @param teamName The team name to format
 * @returns Formatted team name for logo path
 */
export const formatTeamNameForLogo = (teamName: string): string => {
  return teamName
    .toLowerCase()
    .replace(/[''\.]/g, '')
    .replace(/\s+/g, '-');
};

/**
 * Gets the path to a team's logo
 * @param teamName The team name
 * @returns Path to the team's logo
 */
export const getTeamLogoPath = (teamName: string): string => {
  // Map team names to their actual logo filenames in the East v West Logos folder.
  // Keys use ASCII apostrophes — Sleeper may send Unicode apostrophes, so we also
  // try a normalized lookup if the direct lookup fails.
  const logoMap: Record<string, string> = {
    'Belleview Badgers': 'Belleview Badgers Primary Logo-transparent.png',
    'Belltown Raptors': 'Belltown Raptors logo.png',
    'Cascade Marauders': 'Cascade Marauders Logo.png',
    "Gardner's Ghost": 'Cascade Marauders Logo.png',
    "Minshew's Maniacs": 'Cascade Marauders Logo.png',
    'Double Trouble': 'Double Trouble logo22.png',
    'Mt. Lebanon Cake Eaters': 'Cake Eaters Logo Final Version (1)-transparent.png',
    'The Lone Ginger': 'Lone Ginger Logo-transparent.png',
    'bop pop': 'bop pop logo.png',
    'Red Pandas': 'Red Pandas Primary Logo (2).png',
    'BeerNeverBrokeMyHeart': 'Beer Never Broke My Heart Logo.png',
    'Elemental Heroes': 'Elemental Heroes Logo.png',
    'Detroit Dawgs': 'Detroit Dawgs Logo.png',
    'Bimg Bamg Boomg': 'Bimg Bamg Boomg Logo .png',
  };

  const normalized = normalizeTeamKeyForLookup(teamName);
  const logoFile = logoMap[teamName]
    ?? logoMap[normalized]
    ?? `${formatTeamNameForLogo(teamName)}.png`;
  return `/assets/teams/East%20v%20West%20Logos/${encodeURIComponent(logoFile)}`;
};

/**
 * Gets a team's colors
 * @param teamName The team name
 * @returns The team's colors object
 */
export const getTeamColors = (teamName: string): TeamColors => {
  const norm = normalizeTeamKeyForLookup(teamName);
  return (
    TEAM_COLORS[teamName]
    ?? TEAM_COLORS[norm]
    ?? TEAM_COLORS[norm.toLowerCase()]
    // Case-insensitive scan as final fallback (handles capitalisation diffs like 'Bop Pop' vs 'bop pop')
    ?? Object.entries(TEAM_COLORS).find(([k]) => k.toLowerCase() === norm.toLowerCase())?.[1]
    ?? { primary: '#3b5b8b', secondary: '#ba1010' }
  );
};

/**
 * Generates a CSS style object for team-colored elements
 * @param teamName The team name
 * @param variant 'primary' | 'secondary' | 'tertiary' - which color to use as background
 * @returns CSS style object with background and text colors
 */
export const getTeamColorStyle = (
  teamName: string, 
  variant: 'primary' | 'secondary' | 'tertiary' = 'primary'
): React.CSSProperties => {
  const colors = getTeamColors(teamName);
  const bgColor = colors[variant] || colors.primary;
  
  // Calculate if text should be light or dark based on background color
  const isLight = (color: string): boolean => {
    // Convert hex to RGB
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Calculate luminance (perceived brightness)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  };
  
  return {
    backgroundColor: bgColor,
    color: isLight(bgColor) ? '#000000' : '#ffffff',
  };
};

/**
 * Picks a readable text color (black or white) for a background spanning one or
 * more colors (e.g. a two-color gradient). Uses the average perceived luminance
 * of all provided colors so gradients between two light colors (e.g. 'bop pop'
 * or 'Elemental Heroes') don't force unreadable white text.
 * @param colors Hex color strings (e.g. ['#fedb35', '#f88618'])
 * @returns '#000000' or '#ffffff'
 */
export const getReadableTextForColors = (colors: string[]): string => {
  const luminanceOf = (color: string): number => {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  const valid = colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  if (valid.length === 0) return '#ffffff';
  const avgLuminance = valid.reduce((sum, c) => sum + luminanceOf(c), 0) / valid.length;
  return avgLuminance > 0.55 ? '#000000' : '#ffffff';
};

/**
 * Canonical name resolution helpers
 */

// Precompute normalized canonical names for quick matching
const CANONICAL_BY_NORMALIZED = new Map<string, string>(
  TEAM_NAMES.map((n) => [normalizeName(n), n])
);

// Precompute normalized alias map
const ALIAS_BY_NORMALIZED = new Map<string, string>(
  Object.entries(TEAM_ALIASES).map(([alias, canon]) => [normalizeName(alias), canon])
);

/**
 * Resolve a canonical team name using owner_id first, then aliases, then best-effort matches.
 */
export function resolveCanonicalTeamName(params: {
  ownerId?: string | null;
  rosterTeamName?: string | null;
  userDisplayName?: string | null;
  username?: string | null;
}): string {
  const { ownerId, rosterTeamName, userDisplayName, username } = params;

  // 1) Direct mapping by user_id (source of truth across seasons)
  if (ownerId && CANONICAL_TEAM_BY_USER_ID[ownerId]) {
    return CANONICAL_TEAM_BY_USER_ID[ownerId];
  }

  const tryMap = (name?: string | null): string | undefined => {
    if (!name) return undefined;
    const key = normalizeName(name);
    return ALIAS_BY_NORMALIZED.get(key) || CANONICAL_BY_NORMALIZED.get(key);
  };

  // 2) Roster/team display name on Sleeper
  const fromRosterName = tryMap(rosterTeamName);
  if (fromRosterName) return fromRosterName;

  // 3) User display name or username as alias
  const fromDisplay = tryMap(userDisplayName) || tryMap(username);
  if (fromDisplay) return fromDisplay;

  // 4) Unknown – caller can log and/or fall back to placeholder in UI
  try {
    // Emit a helpful warning so we can populate CANONICAL_TEAM_BY_USER_ID or TEAM_ALIASES
    // This will show up in the browser console and server logs during development
    // It is safe to keep in production; it's a one-line warning.
    console.warn('[team-utils] Unknown team mapping. Please add mapping in team-mapping.ts', {
      ownerId,
      rosterTeamName,
      userDisplayName,
      username,
    });
  } catch {}
  return 'Unknown Team';
}
