/**
 * Shared roster-counting helper used by the homepage, My Team card,
 * league-news roster maps, and preseason roster-size calculations.
 *
 * Sleeper's roster.players already includes players listed in .taxi and
 * .reserve. Naively concatenating all three arrays double-counts those
 * players. This helper deduplicates before counting.
 *
 * DST / DEF are normalised to "DEF" so callers don't need to handle both
 * representations.
 */

/** Minimal player record needed for position counting. */
export type RosterSummaryPlayer = {
  position?: string | null;
};

export type RosterSummary = {
  /** Unique total player count (deduplication applied across players/taxi/reserve). */
  uniqueTotal: number;
  /** Position counts using deduplicated unique player set. */
  positionCounts: Record<string, number>;
  /** Number of unique players on the taxi squad. */
  taxiCount: number;
  /** Number of unique players on IR / reserve. */
  reserveCount: number;
  /** The full deduplicated set of player IDs. */
  uniqueIds: Set<string>;
};

/**
 * Compute a roster summary with deduplication.
 *
 * @param players  Array of player IDs from the main roster (includes taxi/reserve on Sleeper).
 * @param taxi     Array of player IDs on the taxi squad.
 * @param reserve  Array of player IDs on IR / reserve.
 * @param playersIndex  Map of player ID → player metadata (only `position` is required).
 */
export function computeRosterSummary(
  players: string[],
  taxi: string[],
  reserve: string[],
  playersIndex: Record<string, RosterSummaryPlayer>,
): RosterSummary {
  // Build the unique set — Sleeper includes taxi and reserve in players[],
  // so we add them all and let Set handle deduplication.
  const uniqueIds = new Set<string>(players);
  for (const pid of taxi)    uniqueIds.add(pid);
  for (const pid of reserve) uniqueIds.add(pid);

  const positionCounts: Record<string, number> = {};
  for (const pid of uniqueIds) {
    const raw = playersIndex[pid]?.position;
    if (!raw) continue;
    const pos = normalizePosition(raw);
    positionCounts[pos] = (positionCounts[pos] ?? 0) + 1;
  }

  return {
    uniqueTotal:    uniqueIds.size,
    positionCounts,
    taxiCount:      new Set(taxi).size,
    reserveCount:   new Set(reserve).size,
    uniqueIds,
  };
}

/** Normalize DST/DEF to a single canonical label. */
export function normalizePosition(pos: string): string {
  const upper = pos.toUpperCase();
  if (upper === 'DST' || upper === 'DEF') return 'DEF';
  return upper;
}
