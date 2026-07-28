import { normalizeName } from "@/lib/constants/team-mapping";

export type EspnDepthEntry = {
  position: string;
  order: number;
  playerId: string | null;
  displayName: string;
  normalizedName: string;
};

const DEPTH_CACHE = new Map<string, { ts: number; data: EspnDepthEntry[] }>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`espn-depth ${resp.status}`);
  return resp.json() as Promise<T>;
}

type EspnDepthResponse = {
  team?: {
    athletes?: Array<{
      position?: { abbreviation?: string; name?: string };
      items?: Array<{
        athlete?: {
          id?: string | number;
          displayName?: string;
          fullName?: string;
        };
      }>;
    }>;
  };
};

export async function getEspnDepthForTeam(teamAbbr: string): Promise<EspnDepthEntry[]> {
  const key = teamAbbr.toUpperCase();
  const now = Date.now();
  const cached = DEPTH_CACHE.get(key);
  if (cached && now - cached.ts < TTL_MS) return cached.data;

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${key.toLowerCase()}?enable=depthchart`;
  let entries: EspnDepthEntry[] = [];
  try {
    const json = await fetchJson<EspnDepthResponse>(url);
    const athletes = json?.team?.athletes;
    if (Array.isArray(athletes)) {
      const next: EspnDepthEntry[] = [];
      for (const group of athletes) {
        const position = group?.position?.abbreviation || group?.position?.name || "";
        const items = group?.items;
        if (!Array.isArray(items)) continue;
        let order = 0;
        for (const item of items) {
          order += 1;
          const athlete = item?.athlete;
          if (!athlete) continue;
          const displayName = athlete.displayName || athlete.fullName || "";
          const normalized = normalizeName(displayName);
          next.push({
            position,
            order,
            playerId: athlete.id ? String(athlete.id) : null,
            displayName,
            normalizedName: normalized,
          });
        }
      }
      entries = next;
    }
  } catch (err) {
    console.warn("[espn-depth] failed", teamAbbr, err);
    entries = [];
  }

  DEPTH_CACHE.set(key, { ts: now, data: entries });
  return entries;
}
