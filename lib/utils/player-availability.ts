import { normalizeName } from '@/lib/constants/team-mapping';
import { getEspnDepthForTeam, type EspnDepthEntry } from '@/lib/utils/espn-depth';
import {
  getAllPlayersCached,
  getLeagueMatchups,
  getSleeperInjuriesCached,
  resolveAvailabilityFromSleeper,
  type PlayerAvailabilityInfo,
  type PlayerAvailabilityTier,
  type SleeperInjury,
  type SleeperMatchup,
  type SleeperPlayer,
} from '@/lib/utils/sleeper-api';

export interface PlayerAvailabilityEntry extends PlayerAvailabilityInfo {
  /** Probability that the player is active. Role is modeled separately. */
  weight: number;
}

export interface AvailabilitySnapshotArgs {
  leagueId: string;
  uptoWeek: number;
  playerIds: string[];
}

const tierActiveProbability: Record<PlayerAvailabilityTier, number> = {
  starter: 0.98,
  primary_backup: 0.97,
  rotational: 0.96,
  inactive: 0.02,
  unknown: 0.92,
};

interface TeamDepthMaps {
  byName: Map<string, EspnDepthEntry>;
}

function buildDepthMaps(entries: EspnDepthEntry[]): TeamDepthMaps {
  const byName = new Map<string, EspnDepthEntry>();
  for (const entry of entries) byName.set(entry.normalizedName, entry);
  return { byName };
}

async function loadEspnDepth(teamCodes: string[]): Promise<Map<string, TeamDepthMaps>> {
  const out = new Map<string, TeamDepthMaps>();
  await Promise.all(teamCodes.map(async (code) => {
    try {
      const entries = await getEspnDepthForTeam(code);
      out.set(code, buildDepthMaps(entries));
    } catch {
      out.set(code, buildDepthMaps([]));
    }
  }));
  return out;
}

async function buildLineupStarts(leagueId: string, uptoWeek: number, targetIds: Set<string>): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const weeks = Array.from({ length: Math.max(0, uptoWeek - 1) }, (_, index) => index + 1);
  await Promise.all(weeks.map(async (week) => {
    const matchups = await getLeagueMatchups(leagueId, week).catch(() => [] as SleeperMatchup[]);
    for (const matchup of matchups) {
      for (const playerId of Array.isArray(matchup.starters) ? matchup.starters : []) {
        if (!playerId || playerId === '0' || !targetIds.has(playerId)) continue;
        counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
      }
    }
  }));
  return counts;
}

function normalizeDepthPosition(position: string | null | undefined): string {
  const normalized = String(position || '').trim().toUpperCase();
  if (normalized === 'QUARTERBACK') return 'QB';
  if (normalized === 'RUNNING BACK' || normalized === 'HB' || normalized === 'FB') return 'RB';
  if (normalized === 'WIDE RECEIVER' || normalized === 'LWR' || normalized === 'RWR' || normalized === 'SWR') return 'WR';
  if (normalized === 'TIGHT END') return 'TE';
  if (normalized === 'PLACE KICKER' || normalized === 'KICKER' || normalized === 'PK') return 'K';
  return normalized;
}

export function classifyDepthChartRole(
  position: string | null | undefined,
  order: number | null | undefined,
): PlayerAvailabilityTier | null {
  if (!Number.isInteger(order) || !order || order < 1) return null;
  const normalizedPosition = normalizeDepthPosition(position);

  if (normalizedPosition === 'WR') {
    // NFL offenses commonly start three receivers. WR2 and the slot/WR3 are
    // starting offensive roles, not backups to the first listed receiver.
    return order <= 3 ? 'starter' : 'rotational';
  }

  if (normalizedPosition === 'QB' || normalizedPosition === 'RB' || normalizedPosition === 'TE' || normalizedPosition === 'K') {
    if (order === 1) return 'starter';
    if (order === 2) return 'primary_backup';
    return 'rotational';
  }

  if (order === 1) return 'starter';
  if (order === 2) return 'primary_backup';
  return 'rotational';
}

function applyDepthRole(
  entry: PlayerAvailabilityEntry,
  position: string | null | undefined,
  order: number | null | undefined,
  reason: string,
) {
  if (entry.tier === 'inactive') return;
  const tier = classifyDepthChartRole(position, order);
  if (!tier) return;

  // Sleeper's explicit starter flag is stronger than its numeric ordering.
  // Otherwise, use the position-aware interpretation of the depth chart.
  if (!(entry.reasons.includes('sleeper-starting') && tier !== 'starter')) {
    entry.tier = tier;
    entry.weight = tierActiveProbability[tier];
  }
  if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
}

function adjustBySleeperDepth(entry: PlayerAvailabilityEntry, player: SleeperPlayer | undefined) {
  if (!player) return;
  const order = typeof player.depth_chart_order === 'number' ? player.depth_chart_order : null;
  if (!order) return;
  const position = player.depth_chart_position || player.position;
  const normalizedPosition = normalizeDepthPosition(position) || 'UNKNOWN';
  applyDepthRole(entry, position, order, `sleeper-depth-${normalizedPosition}-${order}`);
}

function adjustByEspnDepth(entry: PlayerAvailabilityEntry, espn: EspnDepthEntry | undefined) {
  if (!espn) return;
  const position = normalizeDepthPosition(espn.position) || 'UNKNOWN';
  applyDepthRole(entry, espn.position, espn.order, `espn-depth-${position}-${espn.order}`);
}

function noteFantasyLineupHistory(entry: PlayerAvailabilityEntry, starts: number, weeksConsidered: number) {
  if (weeksConsidered <= 0 || starts <= 0) return;
  // A fantasy start is not evidence that the player starts for his NFL team.
  // Keep it only as descriptive continuity evidence for downstream explanations.
  entry.reasons.push(`fantasy-lineup-starts-${starts}`);
}

function adjustForInjury(entry: PlayerAvailabilityEntry, injury: SleeperInjury | undefined) {
  const status = injury?.status?.toLowerCase();
  if (status === 'out' || status === 'suspended' || status === 'inactive') {
    entry.weight = Math.min(entry.weight, 0.01);
    entry.tier = 'inactive';
    entry.reasons.push(`injury-${status}`);
  } else if (status === 'doubtful') {
    entry.weight = Math.min(entry.weight, 0.22);
    entry.reasons.push('injury-D');
  } else if (status === 'questionable') {
    entry.weight = Math.min(entry.weight, 0.82);
    entry.reasons.push('injury-Q');
  }
  const practice = injury?.practice_participation?.toLowerCase();
  if (practice?.includes('dnp')) {
    entry.weight *= 0.82;
    entry.reasons.push('practice-DNP');
  } else if (practice?.includes('limited')) {
    entry.weight *= 0.94;
    entry.reasons.push('practice-limited');
  }
}

export async function buildPlayerAvailabilitySnapshot(args: AvailabilitySnapshotArgs): Promise<Record<string, PlayerAvailabilityEntry>> {
  const { leagueId, uptoWeek, playerIds } = args;
  if (playerIds.length === 0) return {};
  const targetIds = new Set(playerIds);
  const [players, injuries, lineupStarts] = await Promise.all([
    getAllPlayersCached().catch(() => ({} as Record<string, SleeperPlayer>)),
    getSleeperInjuriesCached().catch(() => [] as SleeperInjury[]),
    buildLineupStarts(leagueId, uptoWeek, targetIds),
  ]);
  const injuryMap = new Map(injuries.map((injury) => [injury.player_id, injury]));
  const teamCodes = Array.from(new Set(
    playerIds.map((playerId) => players[playerId]?.team?.toUpperCase()).filter(Boolean),
  )) as string[];
  const espnDepth = await loadEspnDepth(teamCodes);
  const result: Record<string, PlayerAvailabilityEntry> = {};
  const weeksConsidered = Math.max(0, uptoWeek - 1);

  for (const playerId of playerIds) {
    const player = players[playerId];
    const injury = injuryMap.get(playerId);
    const base = resolveAvailabilityFromSleeper(player, injury);
    const entry: PlayerAvailabilityEntry = {
      tier: base.tier,
      reasons: [...base.reasons],
      weight: tierActiveProbability[base.tier] ?? 0.92,
    };
    adjustBySleeperDepth(entry, player);
    const teamCode = player?.team?.toUpperCase();
    if (teamCode) {
      const depthMaps = espnDepth.get(teamCode);
      if (depthMaps) {
        const nameKey = normalizeName(`${player?.first_name || ''} ${player?.last_name || ''}`);
        adjustByEspnDepth(entry, depthMaps.byName.get(nameKey));
      }
    }
    entry.weight = Math.min(entry.weight, tierActiveProbability[entry.tier] ?? 0.92);
    noteFantasyLineupHistory(entry, lineupStarts.get(playerId) ?? 0, weeksConsidered);
    adjustForInjury(entry, injury);
    entry.weight = Math.max(0, Math.min(1, Number(entry.weight.toFixed(3))));
    if (entry.reasons.length === 0) entry.reasons.push('no-flags');
    result[playerId] = entry;
  }
  return result;
}
