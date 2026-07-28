/**
 * Tests for getRecapYear() — the year of the most recently completed fantasy season.
 *
 * With CURRENT_SEASON = '2026' and NEW_LEAGUE_YEAR = 2027-02-07:
 *   - Before Feb 2027 → 2025 (2026 not yet complete)
 *   - On/after Feb 2027 → 2026 (season complete)
 */

import { describe, it, expect } from 'vitest';
import { getRecapYear } from '../phase-resolver';
import { IMPORTANT_DATES, CURRENT_SEASON } from '@/lib/constants/league';

const NEW_YEAR = IMPORTANT_DATES.NEW_LEAGUE_YEAR;
const offset = (base: Date, ms: number) => new Date(base.getTime() + ms);
const currentSeason = parseInt(CURRENT_SEASON, 10);

describe('getRecapYear – before new league year', () => {
  it('returns previous season in early offseason (March 2026)', () => {
    expect(getRecapYear(new Date('2026-03-01'))).toBe(currentSeason - 1);
  });

  it('returns previous season right before draft (July 2026)', () => {
    expect(getRecapYear(IMPORTANT_DATES.NEXT_DRAFT)).toBe(currentSeason - 1);
  });

  it('returns previous season during regular season (October 2026)', () => {
    expect(getRecapYear(new Date('2026-10-15'))).toBe(currentSeason - 1);
  });

  it('returns previous season during postseason (January 2027)', () => {
    expect(getRecapYear(new Date('2027-01-15'))).toBe(currentSeason - 1);
  });

  it('returns previous season 1 second before new league year', () => {
    expect(getRecapYear(offset(NEW_YEAR, -1000))).toBe(currentSeason - 1);
  });
});

describe('getRecapYear – after new league year', () => {
  it('returns current season at exactly new league year', () => {
    expect(getRecapYear(NEW_YEAR)).toBe(currentSeason);
  });

  it('returns current season 1 second after new league year', () => {
    expect(getRecapYear(offset(NEW_YEAR, 1000))).toBe(currentSeason);
  });

  it('returns current season in March 2027', () => {
    expect(getRecapYear(new Date('2027-03-15'))).toBe(currentSeason);
  });

  it('returns current season before the 2027 draft', () => {
    expect(getRecapYear(offset(IMPORTANT_DATES.NEXT_LEAGUE_YEAR_DRAFT, -1000))).toBe(currentSeason);
  });

  it('returns current season after the 2027 draft', () => {
    expect(getRecapYear(offset(IMPORTANT_DATES.NEXT_LEAGUE_YEAR_DRAFT, 1000))).toBe(currentSeason);
  });
});

describe('getRecapYear – defaults to current time', () => {
  it('returns a valid season year when called with no argument', () => {
    const year = getRecapYear();
    expect(typeof year).toBe('number');
    expect(year).toBeGreaterThanOrEqual(2023);
    expect(year).toBeLessThanOrEqual(currentSeason);
  });
});
