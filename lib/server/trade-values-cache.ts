/**
 * Lightweight FantasyCalc value lookup for server-side labels (trade block Discord, etc.).
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { ts: number; bySleeperId: Map<string, number> } | null = null;

type FantasyCalcPlayer = {
  player?: { sleeperId?: string };
  value?: number;
};

export async function getPlayerValuesBySleeperId(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.bySleeperId;
  }

  const bySleeperId = new Map<string, number>();
  try {
    const url = 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'EastVWest/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const arr = (await res.json()) as FantasyCalcPlayer[];
      for (const p of arr) {
        const sid = p.player?.sleeperId;
        const val = p.value;
        if (sid && Number.isFinite(val)) bySleeperId.set(String(sid), Number(val));
      }
    }
  } catch {
    if (cache) return cache.bySleeperId;
  }

  cache = { ts: Date.now(), bySleeperId };
  return bySleeperId;
}

export function formatValueTier(value: number): string | null {
  if (value >= 7500) return '⭐ Elite';
  if (value >= 5500) return '★ Star';
  if (value >= 3500) return 'Solid';
  return null;
}
