import { TEAM_NAMES } from '@/lib/constants/league';

const STORAGE_KEY = 'evw_last_team';

function isValidTeam(team: string): boolean {
  return TEAM_NAMES.includes(team);
}

export function getLastTeam(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || !isValidTeam(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function setLastTeam(team: string): void {
  if (typeof window === 'undefined' || !isValidTeam(team)) return;
  try {
    localStorage.setItem(STORAGE_KEY, team);
  } catch {
    // ignore quota / private mode
  }
}

export function clearLastTeam(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
