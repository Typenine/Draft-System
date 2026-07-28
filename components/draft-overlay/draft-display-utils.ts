/**
 * Shared draft UI + animation helpers so draft room and presentation overlay stay aligned.
 */

/** Safety if GSAP onComplete never runs — must exceed full DraftPickAnimation sequence. */
export const DRAFT_ANIM_PICK_PHASE_MAX_MS = 32_000;

/** Safety if GSAP onComplete never runs — must exceed full NowOnClockAnimation sequence (~10s). */
export const DRAFT_ANIM_CLOCK_PHASE_MAX_MS = 20_000;

/** All clients use the same idempotent transition after the on-clock animation. */
export const DRAFT_ANIMATION_CLOCK_START_ACTION = 'anim_clock_start' as const;

/** The existing trade-alert media file shipped alongside pickIsIn.mp3. */
export const DRAFT_TRADE_ALERT_AUDIO_SRC = '/assets/teams/audio/YTDown.com_YouTube_ESPN-Bottom-Line-Ticker-Alert-Sound-Rema_Media_OlzqfbMkVhI_001_1080p.mp4';

type DraftLike = {
  allSlots?: readonly unknown[] | null;
  rounds?: number | null;
} | null | undefined;

type TradeAnimationLike = {
  tradeId?: string | null;
  teams?: readonly string[] | null;
  assets?: readonly unknown[] | null;
};

type PickAnimationLike = {
  overall: number;
  madeAt?: string | null;
  playerId?: string | null;
};

export type DraftPickAnimationIdentity = {
  overall: number;
  key: string;
};

export type DraftPickAnimationDecision = 'animate' | 'ignore' | 'rebase';

/**
 * New events use the immutable trade ID. The legacy fallback lets a trade that
 * was already pending during deployment continue to render safely.
 */
export function draftTradeAnimationKey(animation: TradeAnimationLike): string {
  if (animation.tradeId) return `trade:${animation.tradeId}`;
  return `legacy:${JSON.stringify(animation.teams || [])}:${animation.assets?.length || 0}`;
}

/**
 * A pick slot can be undone and filled again. madeAt + playerId distinguish the
 * replacement event while overall preserves ordering for undo detection.
 */
export function draftPickAnimationIdentity(pick: PickAnimationLike): DraftPickAnimationIdentity {
  return {
    overall: pick.overall,
    key: `pick:${pick.overall}:${pick.madeAt || 'unknown'}:${pick.playerId || 'unknown'}`,
  };
}

/** Rebase silently on undo; animate a new or replacement pick; ignore repeats. */
export function draftPickAnimationDecision(
  previous: DraftPickAnimationIdentity | null,
  next: DraftPickAnimationIdentity,
): DraftPickAnimationDecision {
  if (!previous) return 'animate';
  if (next.overall < previous.overall) return 'rebase';
  if (next.key === previous.key) return 'ignore';
  return 'animate';
}

type InstantSubmitState = {
  enabled: boolean;
  authenticatedTeam?: string | null;
  onClockTeam?: string | null;
  draftStatus?: string | null;
  overall?: number | null;
  queueLength: number;
  hasPendingPick: boolean;
  submitting: boolean;
  attemptedOverall?: number | null;
};

/** Pure guard shared with regression tests for native team-room instant submit. */
export function shouldInstantSubmitTopQueue(state: InstantSubmitState): boolean {
  const overall = Number(state.overall || 0);
  return Boolean(
    state.enabled &&
    state.authenticatedTeam &&
    state.authenticatedTeam === state.onClockTeam &&
    state.draftStatus === 'LIVE' &&
    overall > 0 &&
    state.queueLength > 0 &&
    !state.hasPendingPick &&
    !state.submitting &&
    state.attemptedOverall !== overall
  );
}

/** Matches draft room: slots ÷ configured rounds, default 12-team league shape when unknown. */
export function draftPicksPerRound(draft: DraftLike): number {
  const n = draft?.allSlots?.length ?? 0;
  const r = Math.max(draft?.rounds ?? 4, 1);
  return Math.ceil(n / r) || 12;
}
