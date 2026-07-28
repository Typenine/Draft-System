/**
 * Tests for unique roster player counting.
 *
 * Imports the production computeRosterSummary helper — no duplicate
 * implementation in this file.
 *
 * Sleeper's roster.players already includes players listed in .taxi and
 * .reserve. Naively concatenating all three arrays double-counts those
 * players. The helper must count each player exactly once.
 */

import { describe, it, expect } from 'vitest';
import { computeRosterSummary } from '../roster-summary';

describe('computeRosterSummary – deduplication', () => {
  it('counts a player in both players[] and taxi[] only once', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2', 'p3'],
      ['p3'],           // p3 is also in players
      [],
      { p1: { position: 'WR' }, p2: { position: 'RB' }, p3: { position: 'QB' } },
    );
    expect(summary.positionCounts['QB']).toBe(1);
    expect(summary.positionCounts['WR']).toBe(1);
    expect(summary.positionCounts['RB']).toBe(1);
    expect(summary.uniqueTotal).toBe(3);
  });

  it('counts a player in both players[] and reserve[] only once', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2', 'p3'],
      [],
      ['p2'],           // p2 is also in players
      { p1: { position: 'WR' }, p2: { position: 'TE' }, p3: { position: 'RB' } },
    );
    expect(summary.positionCounts['TE']).toBe(1);
    expect(summary.uniqueTotal).toBe(3);
  });

  it('counts a player in players[], taxi[], and reserve[] only once', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2'],
      ['p1'],
      ['p1'],
      { p1: { position: 'QB' }, p2: { position: 'WR' } },
    );
    expect(summary.positionCounts['QB']).toBe(1);
    expect(summary.uniqueTotal).toBe(2);
  });

  it('uniqueTotal equals the unique set size', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2', 'p3', 'p4'],
      ['p3', 'p4'],
      ['p4'],
      { p1: { position: 'WR' }, p2: { position: 'RB' }, p3: { position: 'TE' }, p4: { position: 'QB' } },
    );
    const total = Object.values(summary.positionCounts).reduce((s, n) => s + n, 0);
    expect(total).toBe(4);
    expect(summary.uniqueTotal).toBe(4);
  });

  it('handles empty taxi and reserve arrays', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2'],
      [],
      [],
      { p1: { position: 'WR' }, p2: { position: 'RB' } },
    );
    expect(summary.positionCounts['WR']).toBe(1);
    expect(summary.positionCounts['RB']).toBe(1);
    expect(summary.uniqueTotal).toBe(2);
  });

  it('ignores players with no position in the map', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2', 'p99'],
      [],
      [],
      { p1: { position: 'WR' }, p2: { position: 'RB' } }, // p99 not in map
    );
    const total = Object.values(summary.positionCounts).reduce((s, n) => s + n, 0);
    expect(total).toBe(2);
    expect(summary.uniqueTotal).toBe(3); // p99 counted in uniqueTotal but not position counts
  });
});

describe('computeRosterSummary – taxiCount and reserveCount', () => {
  it('reports correct taxi count', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2', 'p3', 'p4'],
      ['p3', 'p4'],
      [],
      { p1: { position: 'WR' }, p2: { position: 'RB' }, p3: { position: 'QB' }, p4: { position: 'TE' } },
    );
    expect(summary.taxiCount).toBe(2);
  });

  it('reports correct reserve count', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2', 'p3'],
      [],
      ['p2', 'p3'],
      { p1: { position: 'WR' }, p2: { position: 'RB' }, p3: { position: 'QB' } },
    );
    expect(summary.reserveCount).toBe(2);
  });

  it('deduplicates duplicate IDs within taxi array', () => {
    const summary = computeRosterSummary(
      ['p1'],
      ['p2', 'p2'],  // duplicate in taxi
      [],
      { p1: { position: 'WR' }, p2: { position: 'RB' } },
    );
    expect(summary.taxiCount).toBe(1);
  });
});

describe('computeRosterSummary – position normalization', () => {
  it('normalizes DST to DEF', () => {
    const summary = computeRosterSummary(
      ['p1'],
      [],
      [],
      { p1: { position: 'DST' } },
    );
    expect(summary.positionCounts['DEF']).toBe(1);
    expect(summary.positionCounts['DST']).toBeUndefined();
  });

  it('normalizes DEF to DEF (no change)', () => {
    const summary = computeRosterSummary(
      ['p1'],
      [],
      [],
      { p1: { position: 'DEF' } },
    );
    expect(summary.positionCounts['DEF']).toBe(1);
  });

  it('normalizes position strings to uppercase', () => {
    const summary = computeRosterSummary(
      ['p1'],
      [],
      [],
      { p1: { position: 'wr' } },
    );
    expect(summary.positionCounts['WR']).toBe(1);
  });
});

describe('computeRosterSummary – uniqueIds set', () => {
  it('uniqueIds contains all player IDs once', () => {
    const summary = computeRosterSummary(
      ['p1', 'p2', 'p3'],
      ['p3'],
      ['p4'],
      {},
    );
    expect(summary.uniqueIds.has('p1')).toBe(true);
    expect(summary.uniqueIds.has('p2')).toBe(true);
    expect(summary.uniqueIds.has('p3')).toBe(true);
    expect(summary.uniqueIds.has('p4')).toBe(true);
    expect(summary.uniqueIds.size).toBe(4);
  });
});
