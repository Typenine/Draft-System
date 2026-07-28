/**
 * Team colors for East v. West fantasy football league
 * Each team has up to 4 colors that can be used for branding and UI elements
 */

// Index-based TEAM_NAMES usage has been removed. Colors are keyed by canonical team name.

// Type for team colors
export interface TeamColors {
  primary: string;
  secondary: string;
  tertiary?: string;
  quaternary?: string;
}

// Map of team names to their colors
export const TEAM_COLORS: Record<string, TeamColors> = {
  'Belleview Badgers': {
    primary: '#006747',
    secondary: '#1E3052',
    tertiary: '#F2F7F9'
  },
  'Belltown Raptors': {
    primary: '#753bbd',
    secondary: '#ba0c2f',
    tertiary: '#8a8d8f'
  },
  'Cascade Marauders': {
    primary: '#A60F2D',
    secondary: '#4D4D4D',
  },
  'Double Trouble': {
    primary: '#120a11',
    secondary: '#351b4b',
    tertiary: '#ca5517'
  },
  'Mt. Lebanon Cake Eaters': {
    primary: '#023351',
    secondary: '#DCAC24',
  },
  'The Lone Ginger': {
    primary: '#d56920',
    secondary: '#13110d',
    tertiary: '#4b775b'
  },
  'bop pop': {
    primary: '#fedb35',
    secondary: '#f88618',
  },
  'Red Pandas': {
    primary: '#c90a00',
    secondary: '#000000',
    tertiary: '#797574',
    quaternary: '#38c4f6'
  },
  'BeerNeverBrokeMyHeart': {
    primary: '#0E1A27',
    secondary: '#F4E3C3',
    tertiary: '#B53329'
  },
  'Elemental Heroes': {
    primary: '#83e1e2',
    secondary: '#fd6e6e',
    tertiary: '#7799c9'
  },
  'Detroit Dawgs': {
    primary: '#5a341f',
    secondary: '#da2127',
    tertiary: '#f3bd37'
  },
  'Bimg Bamg Boomg': {
    primary: '#712D7C',
    secondary: '#9BC46D',
    tertiary: '#9E9E9E'
  }
};

// League colors for global UI elements
export const LEAGUE_COLORS = {
  primary: '#0b5f98', // Accent / brand
  secondary: '#be161e', // Danger
  tertiary: '#bf9944', // Gold highlight
  quaternary: '#fcfcfc', // White
  dark: '#050505', // Near-black
};

// Function to get team colors by team name
export const getTeamColors = (teamName: string): TeamColors => {
  return TEAM_COLORS[teamName] || {
    primary: LEAGUE_COLORS.primary,
    secondary: LEAGUE_COLORS.secondary
  };
};

// Removed getTeamColorByIndex; always resolve by canonical team name instead.