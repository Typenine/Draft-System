import { TEAM_NAMES } from '@/lib/constants/league';
import { CANONICAL_TEAM_BY_USER_ID, TEAM_ALIASES, normalizeName } from '@/lib/constants/team-mapping';

export function teamSlug(team: string): string {
  return team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function canonicalizeTeamName(name: string): string {
  const want = normalizeName(name);
  const found = TEAM_NAMES.find((t) => normalizeName(t) === want);
  if (found) return found;
  const alias = Object.entries(TEAM_ALIASES).find(([aliasName]) => normalizeName(aliasName) === want)?.[1];
  return alias || name;
}

export function getUserIdForTeam(team: string): string {
  const canon = canonicalizeTeamName(team);
  for (const [userId, teamName] of Object.entries(CANONICAL_TEAM_BY_USER_ID)) {
    if (teamName === canon) return userId;
  }
  return `team:${teamSlug(canon)}`;
}
