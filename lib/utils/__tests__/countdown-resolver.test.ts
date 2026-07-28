/**
 * Boundary tests for the six-stage countdown resolver.
 *
 * Run: npx vitest run src/lib/utils/__tests__/countdown-resolver.test.ts
 *
 * Key invariants enforced in every test:
 *   - Exactly two cards are always returned.
 *   - Every returned targetDate is strictly later than `now`.
 *   - Expired events from prior cycles are never shown.
 *
 * Calendar data is imported from the same LEAGUE_CALENDARS constant used by
 * the production resolver — tests and resolver share the same source of truth.
 */

import { describe, it, expect } from 'vitest';
import { getCountdownCards, getHomepagePhase } from '../countdown-resolver';
import { LEAGUE_CALENDARS } from '@/lib/constants/league-calendar';

// ── Calendar references ───────────────────────────────────────────────────────

const CAL_2026 = LEAGUE_CALENDARS.find((c) => c.season === 2026)!;
const CAL_2027 = LEAGUE_CALENDARS.find((c) => c.season === 2027)!;
const CAL_2028 = LEAGUE_CALENDARS.find((c) => c.season === 2028)!;

// 2026 dates
const DRAFT_26     = CAL_2026.rookieDraft;
const FA_26        = CAL_2026.faBiddingStart;
const WEEK1_26     = CAL_2026.regularSeasonStart;
const DEADLINE_26  = CAL_2026.tradeDeadline;
const PLAYOFFS_26  = CAL_2026.postseasonStart;
const NEW_YEAR_27  = CAL_2026.nextLeagueYearStart; // = CAL_2027.leagueYearStart

// 2027 dates
const DRAFT_27     = CAL_2027.rookieDraft;
const FA_27        = CAL_2027.faBiddingStart;
const WEEK1_27     = CAL_2027.regularSeasonStart;
const DEADLINE_27  = CAL_2027.tradeDeadline;
const PLAYOFFS_27  = CAL_2027.postseasonStart;
const NEW_YEAR_28  = CAL_2027.nextLeagueYearStart; // = CAL_2028.leagueYearStart

// 2028 draft (used as second card after PLAYOFFS_27)
const DRAFT_28     = CAL_2028.rookieDraft;

// Convenience: offset a date by N milliseconds
const offset = (base: Date, ms: number) => new Date(base.getTime() + ms);

// ── Core invariant helper ─────────────────────────────────────────────────────

function assertNoExpiredTargets(now: Date) {
  const [c1, c2] = getCountdownCards(now);
  expect(c1.targetDate.getTime(), `c1 expired at ${now.toISOString()}`).toBeGreaterThan(now.getTime());
  expect(c2.targetDate.getTime(), `c2 expired at ${now.toISOString()}`).toBeGreaterThan(now.getTime());
}

// ── Always returns exactly two cards ─────────────────────────────────────────

describe('getCountdownCards – always returns exactly two cards', () => {
  it('returns exactly two cards for any arbitrary 2026 date', () => {
    const cards = getCountdownCards(new Date('2026-01-01'));
    expect(cards).toHaveLength(2);
    expect(cards[0].title).toBeTruthy();
    expect(cards[0].targetDate).toBeInstanceOf(Date);
    expect(cards[1].title).toBeTruthy();
    expect(cards[1].targetDate).toBeInstanceOf(Date);
  });

  it('returns exactly two cards for a 2027 date', () => {
    const cards = getCountdownCards(new Date('2027-05-01'));
    expect(cards).toHaveLength(2);
  });

  it('returns exactly two cards for a 2028 date', () => {
    const cards = getCountdownCards(new Date('2028-04-01'));
    expect(cards).toHaveLength(2);
  });
});

// ── 2026 Stage 1: post-championship, pre-draft ────────────────────────────────

describe('2026 Stage 1 – post-championship pre-draft', () => {
  it('shows 2026 draft + season before the draft', () => {
    const now = offset(DRAFT_26, -1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(DRAFT_26);
    expect(c2.targetDate).toEqual(WEEK1_26);
  });

  it('shows 2026 draft + season well into the offseason', () => {
    const now = new Date('2026-03-01T12:00:00Z');
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(DRAFT_26);
    expect(c2.targetDate).toEqual(WEEK1_26);
  });

  it('targets are in the future during Stage 1', () => {
    assertNoExpiredTargets(offset(DRAFT_26, -1000));
    assertNoExpiredTargets(new Date('2026-03-01T12:00:00Z'));
  });
});

// ── 2026 Stage 2: post-draft, pre-FA bidding ─────────────────────────────────

describe('2026 Stage 2 – post-draft, pre-FA bidding', () => {
  it('shows FA bidding + season immediately after draft', () => {
    const now = offset(DRAFT_26, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(FA_26);
    expect(c2.targetDate).toEqual(WEEK1_26);
  });

  it('shows FA bidding + season 1 second before FA bidding starts', () => {
    const now = offset(FA_26, -1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(FA_26);
    expect(c2.targetDate).toEqual(WEEK1_26);
  });

  it('first card title mentions FA', () => {
    const [c1] = getCountdownCards(offset(DRAFT_26, 1000));
    expect(c1.title.toLowerCase()).toContain('fa');
  });

  it('targets are in the future during Stage 2', () => {
    assertNoExpiredTargets(offset(DRAFT_26, 1000));
    assertNoExpiredTargets(offset(FA_26, -1000));
  });
});

// ── 2026 Stage 3: FA bidding open, pre-season ────────────────────────────────

describe('2026 Stage 3 – FA bidding open, pre-season', () => {
  it('shows season + trade deadline immediately after FA bidding opens', () => {
    const now = offset(FA_26, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(WEEK1_26);
    expect(c2.targetDate).toEqual(DEADLINE_26);
  });

  it('shows season + trade deadline 1 second before season starts', () => {
    const now = offset(WEEK1_26, -1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(WEEK1_26);
    expect(c2.targetDate).toEqual(DEADLINE_26);
  });

  it('targets are in the future during Stage 3', () => {
    assertNoExpiredTargets(offset(FA_26, 1000));
  });
});

// ── 2026 Stage 4: regular season active ──────────────────────────────────────

describe('2026 Stage 4 – regular season through trade deadline', () => {
  it('shows trade deadline + postseason immediately after Week 1', () => {
    const now = offset(WEEK1_26, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(DEADLINE_26);
    expect(c2.targetDate).toEqual(PLAYOFFS_26);
  });

  it('shows trade deadline + postseason 1 second before trade deadline', () => {
    const now = offset(DEADLINE_26, -1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(DEADLINE_26);
    expect(c2.targetDate).toEqual(PLAYOFFS_26);
  });

  it('targets are in the future during Stage 4', () => {
    assertNoExpiredTargets(offset(WEEK1_26, 1000));
    assertNoExpiredTargets(offset(DEADLINE_26, -1000));
  });
});

// ── 2026 Stage 5: post-deadline, pre-postseason ───────────────────────────────

describe('2026 Stage 5 – trade deadline through postseason start', () => {
  it('shows postseason + new league year immediately after trade deadline', () => {
    const now = offset(DEADLINE_26, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(PLAYOFFS_26);
    expect(c2.targetDate).toEqual(NEW_YEAR_27);
  });

  it('shows postseason + new league year 1 second before postseason starts', () => {
    const now = offset(PLAYOFFS_26, -1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(PLAYOFFS_26);
    expect(c2.targetDate).toEqual(NEW_YEAR_27);
  });

  it('targets are in the future during Stage 5', () => {
    assertNoExpiredTargets(offset(DEADLINE_26, 1000));
  });
});

// ── 2026 Stage 6: postseason through new league year ─────────────────────────

describe('2026 Stage 6 – postseason through new league year', () => {
  it('shows new league year + next draft immediately after postseason starts', () => {
    const now = offset(PLAYOFFS_26, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(NEW_YEAR_27);
    expect(c2.targetDate).toEqual(DRAFT_27);
  });

  it('shows new league year + next draft during championship week', () => {
    const now = offset(PLAYOFFS_26, 7 * 24 * 60 * 60 * 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(NEW_YEAR_27);
    expect(c2.targetDate).toEqual(DRAFT_27);
  });

  it('shows new league year + next draft 1 second before new league year', () => {
    const now = offset(NEW_YEAR_27, -1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(NEW_YEAR_27);
    expect(c2.targetDate).toEqual(DRAFT_27);
  });

  it('targets are in the future during Stage 6', () => {
    assertNoExpiredTargets(offset(PLAYOFFS_26, 1000));
    assertNoExpiredTargets(offset(NEW_YEAR_27, -1000));
  });
});

// ── February 2027 rollover: switches to 2027 calendar Stage 1 ────────────────

describe('February 2027 rollover – new league year starts', () => {
  it('shows 2027 draft + 2027 season 1 second after new league year', () => {
    const now = offset(NEW_YEAR_27, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(DRAFT_27);
    expect(c2.targetDate).toEqual(WEEK1_27);
  });

  it('shows 2027 draft + 2027 season in March 2027', () => {
    const now = new Date('2027-03-15T12:00:00Z');
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(DRAFT_27);
    expect(c2.targetDate).toEqual(WEEK1_27);
  });

  it('2026 dates are never shown after the new league year', () => {
    const now = offset(NEW_YEAR_27, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).not.toEqual(DRAFT_26);
    expect(c1.targetDate).not.toEqual(WEEK1_26);
    expect(c2.targetDate).not.toEqual(DRAFT_26);
    expect(c2.targetDate).not.toEqual(WEEK1_26);
  });

  it('no expired targets at rollover boundary', () => {
    assertNoExpiredTargets(offset(NEW_YEAR_27, 1));
    assertNoExpiredTargets(new Date('2027-03-15T12:00:00Z'));
  });
});

// ── 2027 Stage 1: around the July 10 rookie draft ────────────────────────────

describe('2027 Stage 1 – approaching the July 10, 2027 draft', () => {
  it('shows 2027 draft + 2027 season one second before the draft', () => {
    const now = offset(DRAFT_27, -1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(DRAFT_27);
    expect(c2.targetDate).toEqual(WEEK1_27);
  });

  it('returns two future targets one second before the draft', () => {
    assertNoExpiredTargets(offset(DRAFT_27, -1000));
  });
});

describe('2027 Stage 1→2 boundary – exactly at the July 10, 2027 draft', () => {
  it('at exactly the draft time shows FA + season start', () => {
    const [c1] = getCountdownCards(DRAFT_27);
    expect(c1.targetDate).toEqual(FA_27);
  });

  it('returns two future targets at exact draft time', () => {
    assertNoExpiredTargets(DRAFT_27);
  });
});

// ── 2027 Stage 2: post-draft, pre-FA bidding ─────────────────────────────────

describe('2027 Stage 2 – post-draft, pre-FA bidding', () => {
  it('shows FA bidding + season one second after the 2027 draft', () => {
    const now = offset(DRAFT_27, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(FA_27);
    expect(c2.targetDate).toEqual(WEEK1_27);
  });

  it('targets are in the future one second after the 2027 draft', () => {
    assertNoExpiredTargets(offset(DRAFT_27, 1000));
  });
});

// ── 2027 Stage 3: FA bidding open ────────────────────────────────────────────

describe('2027 Stage 3 – FA bidding open', () => {
  it('shows season + trade deadline at 2027 FA bidding start', () => {
    const [c1, c2] = getCountdownCards(FA_27);
    expect(c1.targetDate).toEqual(WEEK1_27);
    expect(c2.targetDate).toEqual(DEADLINE_27);
  });

  it('no expired targets at 2027 FA bidding start', () => {
    assertNoExpiredTargets(FA_27);
  });
});

// ── 2027 Stage 4: regular season ─────────────────────────────────────────────

describe('2027 Stage 4 – 2027 regular season', () => {
  it('shows trade deadline + postseason at 2027 season start', () => {
    const [c1, c2] = getCountdownCards(WEEK1_27);
    expect(c1.targetDate).toEqual(DEADLINE_27);
    expect(c2.targetDate).toEqual(PLAYOFFS_27);
  });

  it('no expired targets at 2027 regular-season start', () => {
    assertNoExpiredTargets(WEEK1_27);
  });
});

// ── 2027 Stage 5: post-deadline ───────────────────────────────────────────────

describe('2027 Stage 5 – 2027 trade deadline through postseason', () => {
  it('shows postseason + new league year at 2027 trade deadline', () => {
    const [c1, c2] = getCountdownCards(DEADLINE_27);
    expect(c1.targetDate).toEqual(PLAYOFFS_27);
    expect(c2.targetDate).toEqual(NEW_YEAR_28);
  });

  it('no expired targets at 2027 trade deadline', () => {
    assertNoExpiredTargets(DEADLINE_27);
  });
});

// ── 2027 Stage 6: postseason ──────────────────────────────────────────────────

describe('2027 Stage 6 – 2027 postseason', () => {
  it('shows new league year + 2028 draft at 2027 postseason start', () => {
    const [c1, c2] = getCountdownCards(PLAYOFFS_27);
    expect(c1.targetDate).toEqual(NEW_YEAR_28);
    expect(c2.targetDate).toEqual(DRAFT_28);
  });

  it('no expired targets at 2027 postseason start', () => {
    assertNoExpiredTargets(PLAYOFFS_27);
  });
});

// ── 2028 league-year rollover ─────────────────────────────────────────────────

describe('2028 league-year rollover', () => {
  it('shows 2028 draft + 2028 season 1 second after new league year 2028', () => {
    const now = offset(NEW_YEAR_28, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate).toEqual(CAL_2028.rookieDraft);
    expect(c2.targetDate).toEqual(CAL_2028.regularSeasonStart);
  });

  it('no expired targets at the 2028 rollover', () => {
    assertNoExpiredTargets(offset(NEW_YEAR_28, 1));
    assertNoExpiredTargets(new Date('2028-04-01T12:00:00Z'));
  });

  it('2027 dates are not shown after the 2028 rollover', () => {
    const now = offset(NEW_YEAR_28, 1000);
    const [c1, c2] = getCountdownCards(now);
    expect(c1.targetDate.getFullYear()).toBeGreaterThanOrEqual(2028);
    expect(c2.targetDate.getFullYear()).toBeGreaterThanOrEqual(2028);
  });
});

// ── Exact 2026 boundary timestamps ────────────────────────────────────────────

describe('exact 2026 event timestamps', () => {
  it('at exactly 2026 DRAFT time → Stage 2 (FA bidding)', () => {
    const [c1] = getCountdownCards(DRAFT_26);
    expect(c1.targetDate).toEqual(FA_26);
  });

  it('at exactly 2026 FA time → Stage 3 (season start)', () => {
    const [c1] = getCountdownCards(FA_26);
    expect(c1.targetDate).toEqual(WEEK1_26);
  });

  it('at exactly 2026 WEEK1 time → Stage 4 (trade deadline)', () => {
    const [c1] = getCountdownCards(WEEK1_26);
    expect(c1.targetDate).toEqual(DEADLINE_26);
  });

  it('at exactly 2026 DEADLINE time → Stage 5 (postseason)', () => {
    const [c1] = getCountdownCards(DEADLINE_26);
    expect(c1.targetDate).toEqual(PLAYOFFS_26);
  });

  it('at exactly 2026 PLAYOFFS time → Stage 6 (new league year)', () => {
    const [c1] = getCountdownCards(PLAYOFFS_26);
    expect(c1.targetDate).toEqual(NEW_YEAR_27);
  });

  it('at exactly NEW_YEAR_27 → 2027 Stage 1 (2027 draft)', () => {
    const [c1] = getCountdownCards(NEW_YEAR_27);
    expect(c1.targetDate).toEqual(DRAFT_27);
  });
});

// ── Expired events are never displayed ───────────────────────────────────────

describe('expired events are never displayed', () => {
  const oneHour = 60 * 60 * 1000;

  it('does not show 2026 rookie draft after it occurred', () => {
    assertNoExpiredTargets(offset(DRAFT_26, oneHour));
  });

  it('does not show 2026 FA bidding start after it opened', () => {
    assertNoExpiredTargets(offset(FA_26, oneHour));
  });

  it('does not show 2026 trade deadline after it passed', () => {
    assertNoExpiredTargets(offset(DEADLINE_26, oneHour));
  });

  it('does not show 2026 postseason start after postseason began', () => {
    assertNoExpiredTargets(offset(PLAYOFFS_26, oneHour));
  });

  it('does not show 2026 new league year date after it passed', () => {
    assertNoExpiredTargets(offset(NEW_YEAR_27, oneHour));
  });

  it('does not show 2027 rookie draft after it occurred', () => {
    assertNoExpiredTargets(offset(DRAFT_27, oneHour));
  });
});

// ── getHomepagePhase boundaries ───────────────────────────────────────────────

describe('getHomepagePhase – 2026 cycle', () => {
  it('pre-draft → post_championship_pre_draft', () => {
    expect(getHomepagePhase(new Date('2026-03-01'))).toBe('post_championship_pre_draft');
  });

  it('after 2026 draft → post_draft_pre_fa', () => {
    expect(getHomepagePhase(offset(DRAFT_26, 1000))).toBe('post_draft_pre_fa');
  });

  it('after 2026 FA → fa_open_pre_season', () => {
    expect(getHomepagePhase(offset(FA_26, 1000))).toBe('fa_open_pre_season');
  });

  it('after 2026 Week 1 → regular_season', () => {
    expect(getHomepagePhase(offset(WEEK1_26, 1000))).toBe('regular_season');
  });

  it('after 2026 deadline → post_deadline_pre_postseason', () => {
    expect(getHomepagePhase(offset(DEADLINE_26, 1000))).toBe('post_deadline_pre_postseason');
  });

  it('after 2026 playoffs → postseason', () => {
    expect(getHomepagePhase(offset(PLAYOFFS_26, 1000))).toBe('postseason');
  });
});

describe('getHomepagePhase – 2027 cycle rollover', () => {
  it('after new league year → post_championship_pre_draft (2027 Stage 1)', () => {
    expect(getHomepagePhase(offset(NEW_YEAR_27, 1000))).toBe('post_championship_pre_draft');
  });

  it('after 2027 draft → post_draft_pre_fa', () => {
    expect(getHomepagePhase(offset(DRAFT_27, 1000))).toBe('post_draft_pre_fa');
  });

  it('after 2027 FA → fa_open_pre_season', () => {
    expect(getHomepagePhase(offset(FA_27, 1000))).toBe('fa_open_pre_season');
  });

  it('after 2027 Week 1 → regular_season', () => {
    expect(getHomepagePhase(offset(WEEK1_27, 1000))).toBe('regular_season');
  });

  it('after 2027 deadline → post_deadline_pre_postseason', () => {
    expect(getHomepagePhase(offset(DEADLINE_27, 1000))).toBe('post_deadline_pre_postseason');
  });

  it('after 2027 playoffs → postseason', () => {
    expect(getHomepagePhase(offset(PLAYOFFS_27, 1000))).toBe('postseason');
  });

  it('after 2028 new league year → post_championship_pre_draft (2028 Stage 1)', () => {
    expect(getHomepagePhase(offset(NEW_YEAR_28, 1000))).toBe('post_championship_pre_draft');
  });
});

// ── Stage precedence ──────────────────────────────────────────────────────────

describe('stage precedence', () => {
  it('postseason check wins over all others (before new-year)', () => {
    const [c1] = getCountdownCards(offset(PLAYOFFS_26, 1));
    expect(c1.targetDate).toEqual(NEW_YEAR_27);
  });

  it('deadline check runs only when postseason has not started', () => {
    const [c1] = getCountdownCards(offset(DEADLINE_26, 1));
    expect(c1.targetDate).toEqual(PLAYOFFS_26);
  });

  it('2027 new-year rollover correctly selects 2027 calendar', () => {
    const [c1] = getCountdownCards(NEW_YEAR_27);
    expect(c1.targetDate).toEqual(DRAFT_27);
    expect(c1.targetDate).not.toEqual(NEW_YEAR_27);
  });
});
