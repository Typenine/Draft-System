export const ESPN_TO_SLEEPER: Record<string, string> = {
  // Shared or identical codes
  ARI: 'ARI', ATL: 'ATL', BAL: 'BAL', BUF: 'BUF', CAR: 'CAR', CHI: 'CHI',
  CIN: 'CIN', CLE: 'CLE', DAL: 'DAL', DEN: 'DEN', DET: 'DET', GB: 'GB',
  HOU: 'HOU', IND: 'IND', KC: 'KC', MIA: 'MIA', MIN: 'MIN', NE: 'NE',
  NO: 'NO', NYG: 'NYG', NYJ: 'NYJ', PHI: 'PHI', PIT: 'PIT', SEA: 'SEA',
  SF: 'SF', TB: 'TB', TEN: 'TEN', LV: 'LV', LAC: 'LAC', LAR: 'LAR',
  // Remapped
  JAX: 'JAC',
  WSH: 'WAS',
};

export function espnToSleeperTeam(code?: string): string | undefined {
  if (!code) return undefined;
  const up = code.toUpperCase();
  return ESPN_TO_SLEEPER[up] || up;
}

export function normalizeTeamCode(code?: string): string | undefined {
  if (!code) return undefined;
  const up = code.toUpperCase();
  // Accept either ESPN or Sleeper and return Sleeper-style codes
  return ESPN_TO_SLEEPER[up] || up;
}
