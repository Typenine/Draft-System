'use client';

/* eslint-disable @next/next/no-img-element -- Using <img> for GSAP animations and dynamic team logos that need direct DOM access */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useDraftData } from './useDraftData';
import { getTeamLogoPath } from '@/lib/utils/team-utils';
import { getTeamColors } from '@/lib/constants/team-colors';
import DraftPickAnimation from './DraftPickAnimation';
import NowOnClockAnimation from './NowOnClockAnimation';
import DraftTradeAnimation, { type TradeAnimAsset } from './DraftTradeAnimation';
import DraftInfoBarTicker, {
  type DraftInfoBarTickerControlState,
  type DraftInfoBarTickerHandle,
} from './DraftInfoBarTicker';
import RoundRecapOverlay from './RoundRecapOverlay';
import EndOfRoundAnimation from './EndOfRoundAnimation';
import StartOfRoundAnimation from './StartOfRoundAnimation';
import {
  DRAFT_ANIMATION_CLOCK_START_ACTION,
  draftPicksPerRound,
  draftPickAnimationDecision,
  draftPickAnimationIdentity,
  draftTradeAnimationKey,
  type DraftPickAnimationIdentity,
  DRAFT_ANIM_CLOCK_PHASE_MAX_MS,
  DRAFT_ANIM_PICK_PHASE_MAX_MS,
} from './draft-display-utils';

// Position colors for player cards
const positionColors: Record<string, string> = {
  'QB': '#C00000',
  'RB': '#FFC000',
  'WR': '#0070C0',
  'TE': '#00B050',
  'DEF': '#7030A0',
  'K': '#FF8C42',
};


function getYoutubeEmbedUrl(url: string): string | null {
  try {
    let videoId: string | null = null;
    if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split(/[?&]/)[0] || null;
    } else if (url.includes('youtube.com')) {
      const u = new URL(url);
      videoId = u.searchParams.get('v') || u.pathname.split('/').pop() || null;
    }
    if (!videoId) return null;
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1`;
  } catch {
    return null;
  }
}

export type { DraftInfoBarTickerControlState, DraftInfoBarTickerHandle as DraftOverlayLiveHandle };

type DraftOverlayLiveProps = {
  onTickerControlStateChange?: (state: DraftInfoBarTickerControlState) => void;
};

const DraftOverlayLive = forwardRef<DraftInfoBarTickerHandle, DraftOverlayLiveProps>(function DraftOverlayLive({
  onTickerControlStateChange,
}, ref) {
  const tickerRef = useRef<DraftInfoBarTickerHandle>(null);

  useImperativeHandle(ref, () => ({
    stepTicker: (direction) => tickerRef.current?.stepTicker(direction),
    toggleTickerPause: () => tickerRef.current?.toggleTickerPause(),
    getControlState: () => tickerRef.current?.getControlState() ?? { paused: false, slideLabel: 'Best Available' },
  }), []);
  const {
    draft,
    currentTeam,
    currentPickIndex,
    draftGrid,
    nextTeams,
    lastPick,
    available,
    usingCustom,
    localRemainingSec,
    pendingPick,
    pendingTradeAnimation,
    activeViewers,
    refetch,
  } = useDraftData(1000);

  const picksPerRound = draftPicksPerRound(draft);

  // Event branding — fall back to lime-green defaults when not configured
  const eventColor1 = draft?.eventColor1 || '#a4c810';
  const eventLogoUrl = draft?.eventLogoUrl || null;
  // Build a CSS rgba glow from the event primary color
  const eventGlow = `0 0 10px ${eventColor1}66`;

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then((j) => setIsAdmin(Boolean(j?.isAdmin))).catch(() => {});
  }, []);

  // 1s during LIVE, auto-adjusts to 5s/10s for PAUSED/COMPLETED

  // Animation state machine: pick → clock → video → idle
  type AnimPhase = 'pick' | 'video' | 'clock' | null;
  const [animPhase, setAnimPhase] = useState<AnimPhase>(null);
  // Trade animation state (independent of pick animation pipeline)
  const [tradeAnimData, setTradeAnimData] = useState<{ tradeId?: string | null; teams: string[]; assets: TradeAnimAsset[]; resumeAfterAnimation?: boolean } | null>(null);
  const tradeAnimSeenIdRef = useRef<string | null>(null);
  const [videoExiting, setVideoExiting] = useState(false);
  const animDataRef = useRef<{
    pick: NonNullable<typeof lastPick>;
    nextTeamName: string | null;
    overall: number;
    round: number;
    pickInRound: number;
    videoUrl: string | null;
    imageUrl: string | null;
  } | null>(null);

  // Player media: playerId → { videoUrl, hasImage } (ref only; no re-render needed)
  const playerVideosRef = useRef<Record<string, { videoUrl: string | null; hasImage: boolean }>>({});
  const clockRef = useRef<HTMLDivElement>(null);
  const lastAnimatedPickRef = useRef<DraftPickAnimationIdentity | null>(null);
  const animInitializedRef = useRef(false);
  const clockPhaseFinishedRef = useRef(false);
  /** After on-the-clock intro ends (→ idle), drive 1s hold + pulse + team-primary digits until first tick below full. */
  const prevAnimPhaseForClockHudRef = useRef<AnimPhase | null>(null);
  const [postIntroClockSeq, setPostIntroClockSeq] = useState(0);
  const [clockHudTeamPrimary, setClockHudTeamPrimary] = useState(false);
  // Ref for GSAP video container animation
  const videoContainerRef = useRef<HTMLDivElement>(null);
  // Stable ref to nextTeams so animation closure always sees latest value
  const nextTeamsRef = useRef(nextTeams);
  nextTeamsRef.current = nextTeams;
  // Guard: prevent dismissVideo from firing more than once per video phase
  const dismissingRef = useRef(false);
  // Track when animation sequence started (for stale-skip on tab re-focus)
  const animStartTimeRef = useRef<number>(0);
  // College for current pick animation (fetched from Sleeper player cache)
  const [pickAnimCollege, setPickAnimCollege] = useState<string | undefined>(undefined);
  // Pending grid cell wipe: recorded when pick fires, executed when animPhase → null
  const pendingGridAnimRef = useRef<{ idx: number; team: string } | null>(null);

  // Round transition animations
  const [endOfRoundAnimRound, setEndOfRoundAnimRound] = useState<number | null>(null);
  const [startOfRoundAnimRound, setStartOfRoundAnimRound] = useState<number | null>(null);
  // Transition detection: fire EndOfRoundAnimation exactly when roundEndPause flips false→true
  const prevRoundEndPauseRef = useRef<boolean | undefined>(undefined);
  const pendingEndOfRoundRef = useRef(false);

  // Detect pending trade animation from DB trigger
  useEffect(() => {
    if (!pendingTradeAnimation) return;
    const animKey = draftTradeAnimationKey(pendingTradeAnimation);
    if (tradeAnimSeenIdRef.current === animKey) return;
    tradeAnimSeenIdRef.current = animKey;
    setTradeAnimData(pendingTradeAnimation as { tradeId?: string | null; teams: string[]; assets: TradeAnimAsset[] });
  }, [pendingTradeAnimation]);

  // Load player media (videos + images) on mount
  useEffect(() => {
    async function loadVideos() {
      try {
        const res = await fetch('/api/draft/player-videos', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json();
        const map: Record<string, { videoUrl: string | null; hasImage: boolean }> = {};
        for (const v of (j.videos || [])) { map[v.playerId] = { videoUrl: v.videoUrl || null, hasImage: !!v.hasImage }; }
        playerVideosRef.current = map;
      } catch {}
    }
    loadVideos();
    const t = setInterval(loadVideos, 60000);
    return () => clearInterval(t);
  }, []);

  // Dismiss video — CSS fade via videoExiting, setTimeout guarantees state reset
  function dismissVideo() {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    if (videoContainerRef.current) gsap.killTweensOf(videoContainerRef.current);
    setVideoExiting(true);
    setTimeout(() => { setAnimPhase(null); setVideoExiting(false); dismissingRef.current = false; }, 350);
  }

  // YouTube postMessage listener to detect video end
  // Handles both old format {event:'onStateChange',info:0} and new {event:'infoDelivery',info:{playerState:0}}
  useEffect(() => {
    if (animPhase !== 'video') return;
    const handler = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const ytState =
          data?.event === 'onStateChange' ? data?.info :
          data?.event === 'infoDelivery' && typeof data?.info?.playerState === 'number' ? data.info.playerState :
          undefined;
        if (ytState === 0) dismissVideo();
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [animPhase]);

  // Tab visibility — skip stale animations and apply GSAP lag smoothing on re-focus
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) return;
      // GSAP: don't rush-replay missed frames
      gsap.ticker.lagSmoothing(0);
      // Skip animation if it has been running > 35s (should have long since finished)
      setAnimPhase(prev => {
        if (!prev || prev === 'video') return prev;
        const elapsed = Date.now() - animStartTimeRef.current;
        if (elapsed > 35000) return null;
        return prev;
      });
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const finishClockIntroPhase = useCallback(async () => {
    if (clockPhaseFinishedRef.current) return;
    clockPhaseFinishedRef.current = true;
    try {
      await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: DRAFT_ANIMATION_CLOCK_START_ACTION }),
      });
      await refetch();
    } catch {
      /* still advance phase */
    }
    const hasVideo = !!(animDataRef.current?.videoUrl);
    setAnimPhase(hasVideo ? 'video' : null);
  }, [refetch]);

  useEffect(() => {
    if (animPhase === 'clock') clockPhaseFinishedRef.current = false;
  }, [animPhase]);

  // Phase safety-net timeouts — prevents any phase from sticking if GSAP/onComplete fails
  useEffect(() => {
    if (animPhase === 'pick') {
      const t = setTimeout(() => setAnimPhase('clock'), DRAFT_ANIM_PICK_PHASE_MAX_MS);
      return () => clearTimeout(t);
    }
    if (animPhase === 'clock') {
      const t = setTimeout(() => {
        void finishClockIntroPhase();
      }, DRAFT_ANIM_CLOCK_PHASE_MAX_MS);
      return () => clearTimeout(t);
    }
  }, [animPhase, finishClockIntroPhase]);

  // No nextTeamName — skip animation; still reset clock + advance when entering clock phase
  useEffect(() => {
    if (animPhase !== 'clock') return;
    if (!animDataRef.current?.nextTeamName) {
      void finishClockIntroPhase();
    }
  }, [animPhase, finishClockIntroPhase]);

  // GSAP entrance for video container + safety-net max-duration timeout
  useEffect(() => {
    if (animPhase !== 'video') return;
    dismissingRef.current = false; // reset guard for each new video phase
    if (videoContainerRef.current) {
      gsap.fromTo(
        videoContainerRef.current,
        { opacity: 0, scale: 0.96 },
        { opacity: 1, scale: 1, duration: 0.45, ease: 'power2.out' },
      );
    }
    // Safety net: auto-dismiss after 10 min if onEnded/postMessage never fires
    const safetyTimer = setTimeout(dismissVideo, 10 * 60 * 1000);
    return () => clearTimeout(safetyTimer);
  }, [animPhase]); // videoContainerRef is stable

  // Format time as MM:SS
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Ref: set synchronously (pre-paint) by the layout effect below, consumed by the async
  // effect that follows. Holds the pick that should be animated, or null.
  const pendingAnimateRef = useRef<NonNullable<typeof lastPick> | null>(null);

  // Mask the incoming pick's grid cell BEFORE the browser paints the player's name.
  // useLayoutEffect runs synchronously right after the DOM is updated but before the
  // browser paints — unlike useEffect, which fires after paint. Since `draftGrid` and
  // `lastPick` update together in the same render, doing the masking here (instead of
  // in the async pick-loading effect below, which used to inject it after an awaited
  // network fetch) guarantees the real name is never visible even for a single frame.
  useLayoutEffect(() => {
    if (!lastPick) {
      // No picks yet (or draft was reset). Only mark initialized once real data has loaded
      // (draft !== null). Without this guard, the flag fires before the first fetch completes
      // and the next render — which has existing picks — skips the initialization-skip block,
      // causing the last pick animation to replay for every new tab/PC that joins mid-draft.
      if (!animInitializedRef.current && draft !== null) animInitializedRef.current = true;
      lastAnimatedPickRef.current = null;
      return;
    }
    if (!animInitializedRef.current) {
      // First time we see picks after load — picks already existed, skip them
      animInitializedRef.current = true;
      lastAnimatedPickRef.current = draftPickAnimationIdentity(lastPick);
      return;
    }
    const nextIdentity = draftPickAnimationIdentity(lastPick);
    const decision = draftPickAnimationDecision(lastAnimatedPickRef.current, nextIdentity);
    lastAnimatedPickRef.current = nextIdentity;
    if (decision !== 'animate') return;
    // If this tab was hidden when the event happened, don't replay it on return.
    if (document.hidden) return;

    const gridIdx = lastPick.overall - 1;
    if (gridIdx >= 0 && gridIdx < draftGrid.length) pendingGridAnimRef.current = { idx: gridIdx, team: lastPick.team };
    // Inject pre-mask synchronously, before paint, so the cell stays blank for the full
    // animation duration. React re-renders will replace managed children but can't remove
    // this appended node.
    const pmCell = document.querySelector(`[data-grid-idx="${gridIdx}"]`) as HTMLElement | null;
    if (pmCell && !pmCell.querySelector('.gsap-pick-premask')) {
      const pm = document.createElement('div');
      pm.className = 'gsap-pick-premask';
      pm.style.cssText = 'position:absolute;inset:0;background:#18181b;z-index:9;pointer-events:none;';
      pmCell.appendChild(pm);
    }

    pendingAnimateRef.current = lastPick;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPick?.overall, lastPick?.madeAt, lastPick?.playerId, draft?.allSlots, draft?.rounds]);

  // Load pick-reveal data (video/image/audio) and kick off the animation sequence. Runs after
  // the layout effect above has already masked the grid cell, so this async work (which can
  // take one or more network round-trips) never risks exposing the player's name early.
  useEffect(() => {
    const pick = pendingAnimateRef.current;
    if (!pick) return;
    pendingAnimateRef.current = null;

    void (async () => {
      try {
        const res = await fetch('/api/draft/player-videos', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const freshMap: Record<string, { videoUrl: string | null; hasImage: boolean }> = {};
          for (const v of (j.videos || [])) {
            freshMap[v.playerId] = { videoUrl: v.videoUrl || null, hasImage: !!v.hasImage };
          }
          playerVideosRef.current = freshMap;
        }
      } catch { /* use cached ref */ }

      const ppr = draftPicksPerRound(draft);
      animDataRef.current = {
        pick,
        nextTeamName: nextTeamsRef.current[0]?.name || draft?.onClockTeam || null,
        overall: pick.overall,
        round: pick.round,
        pickInRound: ((pick.overall - 1) % ppr) + 1,
        videoUrl: playerVideosRef.current[pick.playerId]?.videoUrl || null,
        imageUrl: playerVideosRef.current[pick.playerId]?.hasImage
          ? `/api/draft/player-image?playerId=${encodeURIComponent(pick.playerId)}`
          : null,
      };
      setPickAnimCollege(undefined);
      const w = window as Window & { __pickAudioAt?: number };
      if (!w.__pickAudioAt || Date.now() - w.__pickAudioAt > 3000) {
        try { w.__pickAudioAt = Date.now(); new Audio('/assets/teams/audio/pickIsIn.mp3').play().catch(() => {}); } catch { /* ignored */ }
      }
      animStartTimeRef.current = Date.now();
      setAnimPhase('pick');

      if (!usingCustom) {
        const playerId = pick.playerId;
        fetch(`/api/draft?action=player_info&playerId=${encodeURIComponent(playerId)}`, { cache: 'no-store' })
          .then(r => r.json())
          .then(data => { if (data.college) setPickAnimCollege(data.college); })
          .catch(() => {});
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPick?.overall, lastPick?.madeAt, lastPick?.playerId, draft?.allSlots, draft?.rounds]);

  const roundNumber = Math.floor(currentPickIndex / picksPerRound) + 1;
  const pickInRound = (currentPickIndex % picksPerRound) + 1;
  const fullClockSec = draft?.clockSeconds ?? 600;
  /** During on-the-clock intro, hold HUD at full allotment; countdown starts after the shared animation transition. */
  const displayRemainingSec =
    animPhase === 'clock' && draft?.status === 'LIVE' ? fullClockSec : localRemainingSec;

  useEffect(() => {
    const prev = prevAnimPhaseForClockHudRef.current;
    prevAnimPhaseForClockHudRef.current = animPhase;
    if (prev === 'clock' && animPhase === null) {
      setClockHudTeamPrimary(false);
      setPostIntroClockSeq((n) => n + 1);
    }
  }, [animPhase]);

  const resetClockTransform = useCallback(() => {
    const el = clockRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    gsap.set(el, { clearProps: 'scale,transform' });
  }, []);

  useEffect(() => {
    if (postIntroClockSeq === 0) return;
    const el = clockRef.current;
    let tween: gsap.core.Tween | null = null;
    const t1 = setTimeout(() => {
      setClockHudTeamPrimary(true);
      if (el) {
        tween = gsap.fromTo(
          el,
          { scale: 1 },
          {
            scale: 1.08,
            duration: 0.28,
            yoyo: true,
            repeat: 3,
            ease: 'power2.inOut',
            onComplete: () => {
              if (el) gsap.set(el, { clearProps: 'scale,transform' });
            },
          },
        );
      }
    }, 1000);
    return () => {
      clearTimeout(t1);
      tween?.kill();
      resetClockTransform();
    };
  }, [postIntroClockSeq, resetClockTransform]);

  useEffect(() => {
    if (displayRemainingSec < fullClockSec) setClockHudTeamPrimary(false);
  }, [displayRemainingSec, fullClockSec]);

  // Freeze clock visuals when paused — leftover GSAP scale on the digit layer causes ghosting
  useEffect(() => {
    if (draft?.status === 'PAUSED') resetClockTransform();
  }, [draft?.status, resetClockTransform]);

  // Pulse clock when low time (not while intro holds the clock at full)
  useEffect(() => {
    if (animPhase === 'clock' || draft?.status !== 'LIVE') return;
    const el = clockRef.current;
    if (el && displayRemainingSec <= 10 && displayRemainingSec > 0) {
      gsap.to(el, {
        scale: 1.05,
        duration: 0.3,
        yoyo: true,
        repeat: 1,
        ease: 'power1.inOut',
        onComplete: () => {
          gsap.set(el, { clearProps: 'scale,transform' });
        },
      });
    }
  }, [displayRemainingSec, animPhase, draft?.status]);
  const teamColors = currentTeam?.colors || ['#333', '#555', null];
  const teamLogo = currentTeam ? getTeamLogoPath(currentTeam.name) : null;
  const nextTeamsForClock = (draft?.upcoming || [])
    .filter((u) => u.team && u.overall > (draft?.curOverall ?? 0))
    .slice(0, 2)
    .map((u) => ({ name: u.team, logoPath: getTeamLogoPath(u.team) }));

  const clockDigitColor =
    displayRemainingSec <= 10 ? '#ef4444'
    : clockHudTeamPrimary && displayRemainingSec >= fullClockSec ? teamColors[0]
    : eventColor1;

  const completedRound = draft && draft.allPicks && draft.allPicks.length > 0
    ? draft.allPicks[draft.allPicks.length - 1].round
    : 0;
  const nextRoundNumber = completedRound + 1;

  // Effect 1: Detect when roundEndPause transitions false→true (a round just ended this session).
  // Skip on initial load (prev === undefined) so joining mid-recap doesn't replay the animation.
  useEffect(() => {
    if (!draft?.id) return;
    const curr = Boolean(draft?.roundEndPause);
    const prev = prevRoundEndPauseRef.current;
    prevRoundEndPauseRef.current = curr;
    if (prev === undefined) return; // first load — skip
    if (curr && prev === false) pendingEndOfRoundRef.current = true;
    if (!curr) pendingEndOfRoundRef.current = false; // round started again, cancel any pending
  }, [draft?.roundEndPause, draft?.id]);

  // Effect 2: Show EndOfRoundAnimation once animations finish and a round-end is pending.
  useEffect(() => {
    if (!pendingEndOfRoundRef.current) return;
    if (animPhase !== null) return;
    if (tradeAnimData) return;
    if (!completedRound) return;
    pendingEndOfRoundRef.current = false;
    setEndOfRoundAnimRound(completedRound);
  }, [animPhase, tradeAnimData, completedRound]);

  // Round recap: show after all animations (including end-of-round and start-of-round) complete
  const showRoundRecap = draft?.roundEndPause === true && animPhase === null && !tradeAnimData && endOfRoundAnimRound === null && startOfRoundAnimRound === null;
  const roundRecapPicks = draft?.allPicks?.filter(p => p.round === completedRound) || [];

  function handleStartNextRound() {
    // Resume the draft immediately — don't gate it on the animation completing.
    fetch('/api/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    }).catch(() => {});
    setStartOfRoundAnimRound(nextRoundNumber);
  }


  
  // Execute grid cell wipe animation when animPhase returns to null (after pick + clock anims complete)
  useEffect(() => {
    if (animPhase !== null) return;
    const pending = pendingGridAnimRef.current;
    if (!pending) return;
    pendingGridAnimRef.current = null;
    const cell = document.querySelector(`[data-grid-idx="${pending.idx}"]`) as HTMLElement | null;
    if (!cell) return;
    const teamColor = getTeamColors(pending.team).primary || '#888';
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:absolute;inset:0;background:${teamColor};transform:scaleX(0);transform-origin:left center;z-index:10;pointer-events:none;`;
    cell.appendChild(overlay);
    const tl = gsap.timeline({ delay: 0.8, onComplete: () => overlay.remove() });
    tl.to(overlay, { scaleX: 1, duration: 0.55, ease: 'power2.inOut', force3D: true });
    // At full coverage: remove pre-mask — content is now visible but hidden under the overlay
    tl.call(() => { cell.querySelector('.gsap-pick-premask')?.remove(); });
    tl.to({}, { duration: 0.3 });
    tl.to(overlay, { scaleX: 0, transformOrigin: 'right center', duration: 0.45, ease: 'power2.in', force3D: true });
  }, [animPhase]);

  return (
    <div className="w-full h-full bg-gradient-to-b from-zinc-950 to-zinc-900 p-3 flex flex-col">
      {/* Draft Board Grid */}
      <div className="flex-1 min-h-0 relative">
        <div
          className="grid gap-[2px] h-full bg-zinc-900/80 rounded-lg overflow-hidden"
          style={{ gridTemplateColumns: '2.5rem repeat(4, 1fr)' }}
        >
          {/* Header Row */}
          <div
            className="text-center text-[10px] font-bold text-zinc-500 py-1 bg-zinc-900"
            style={{ borderBottom: `2px solid ${eventColor1}` }}
          >#</div>
          {[1, 2, 3, 4].map(r => (
            <div
              key={r}
              className="text-center text-sm font-bold text-zinc-400 py-1 bg-zinc-900"
              style={{ borderBottom: `2px solid ${eventColor1}` }}
            >Round {r}</div>
          ))}
          
          {/* Pick Rows */}
          {Array.from({ length: 12 }, (_, pickIdx) => (
            <React.Fragment key={pickIdx}>
              {/* Pick number — tinted with the on-clock team's primary color */}
              <div
                className={`text-center text-sm font-bold flex items-center justify-center transition-all duration-300 ${
                  currentPickIndex % 12 === pickIdx
                    ? 'animate-pulse'
                    : 'text-zinc-500 bg-zinc-900/80'
                }`}
                style={currentPickIndex % 12 === pickIdx ? { color: teamColors[0], background: `${teamColors[0]}26` } : undefined}
              >
                {pickIdx + 1}
              </div>
              {/* Round cells */}
              {[0, 1, 2, 3].map(roundIdx => {
                const gridIdx = roundIdx * 12 + pickIdx;
                const gridItem = draftGrid[gridIdx];
                const isCurrentPick = currentPickIndex === gridIdx;
                const isPicked = gridItem?.player !== null;
                const teamLogo = gridItem?.team ? getTeamLogoPath(gridItem.team) : null;
                const isViewerOnline = gridItem?.team && activeViewers.includes(gridItem.team);
                const viewerGlowColor = isViewerOnline ? getTeamColors(gridItem.team).primary : null;
                
                return (
                  <div
                    key={gridIdx}
                    data-grid-idx={gridIdx}
                    className={`relative px-1 py-1 flex flex-row items-center overflow-hidden ${
                      isCurrentPick
                        ? ''
                        : isPicked
                        ? 'bg-zinc-700'
                        : 'bg-zinc-800'
                    }`}
                    style={{
                      borderLeft: isPicked && gridItem?.position ? `3px solid ${positionColors[gridItem.position] || '#666'}` : undefined,
                      ...(isCurrentPick ? { boxShadow: `inset 0 0 0 2px ${teamColors[0]}`, background: `${teamColors[0]}22` } : {}),
                    }}
                  >
                    {/* Team logo on LEFT side - ALWAYS visible */}
                    <div
                      className={`flex-shrink-0 w-12 h-12 mr-1 flex items-center justify-center rounded ${isViewerOnline ? 'animate-pulse' : ''}`}
                      style={isViewerOnline && viewerGlowColor ? {
                        boxShadow: `0 0 12px 3px ${viewerGlowColor}, 0 0 20px 6px ${viewerGlowColor}66`,
                        background: `${viewerGlowColor}22`,
                      } : undefined}
                    >
                      {teamLogo ? (
                        <img src={teamLogo} alt="" className="w-full h-full object-contain" />
                      ) : gridItem?.team ? (
                        <div className="text-[8px] font-bold text-zinc-500">
                          {gridItem.team.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase()}
                        </div>
                      ) : null}
                    </div>
                    
                    {/* Player info - only when picked */}
                    {isPicked && gridItem && (
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-white text-lg truncate leading-tight">{gridItem.player}</div>
                        <div className="text-zinc-400 text-xs leading-tight">{gridItem.position}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>

        {/* Event logo watermark — centered on the draft board at low opacity */}
        {eventLogoUrl && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1]">
            <img
              src={eventLogoUrl}
              alt=""
              className="w-48 h-48 object-contain"
              style={{ opacity: 0.10 }}
            />
          </div>
        )}

        {/* PHASE: Player highlight video — only covers draft board, info bar stays visible */}
        {(animPhase === 'video' || videoExiting) && animDataRef.current?.videoUrl && (() => {
          const videoUrl = animDataRef.current!.videoUrl!;
          const isYt = videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be');
          const embedUrl = isYt ? getYoutubeEmbedUrl(videoUrl) : null;
          return (
            <div
              ref={videoContainerRef}
              className="absolute inset-0 z-20 bg-black flex flex-col items-center justify-center pointer-events-auto rounded-lg overflow-hidden transition-opacity duration-[350ms]"
              style={{ opacity: videoExiting ? 0 : 1, willChange: 'opacity' }}
            >
              <div className="w-full h-full flex flex-col items-center justify-center p-4">
                {embedUrl ? (
                  <iframe
                    src={embedUrl}
                    className="w-full flex-1 rounded-lg"
                    allow="autoplay; fullscreen"
                    allowFullScreen
                    style={{ minHeight: 0 }}
                    onLoad={(e) => {
                      try {
                        (e.currentTarget as HTMLIFrameElement).contentWindow?.postMessage(
                          JSON.stringify({ event: 'listening' }), '*'
                        );
                      } catch { /* cross-origin — ignored */ }
                    }}
                  />
                ) : (
                  <video
                    src={videoUrl}
                    autoPlay
                    controls
                    className="w-full flex-1 rounded-lg"
                    style={{ minHeight: 0, objectFit: 'contain' }}
                    onEnded={dismissVideo}
                  />
                )}
              </div>
              {isAdmin && (
                <button
                  className="absolute bottom-3 right-3 px-4 py-1.5 bg-zinc-800/90 text-white text-sm font-bold rounded-lg hover:bg-zinc-700 transition-colors"
                  onClick={dismissVideo}
                >
                  Skip →
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* Draft event accent bar — between grid and bottom HUD */}
      <div
        className="shrink-0 w-full rounded-[2px]"
        style={{
          height: '6px',
          background: eventColor1,
        }}
        aria-hidden
      />

      {/* Bottom Bar: ClockBox + InfoBar — on-the-clock animation overlays both */}
      <div className="relative flex gap-0 items-stretch h-[184px] rounded-[4px]">
        {/* ClockBox */}
        <div
          className="flex items-stretch shrink-0"
          style={{
            width: '380px',
            background: 'linear-gradient(to bottom, #202020, #282828)',
            borderRadius: '4px',
            border: '1px solid #333',
          }}
        >
          {/* Left: Event logo */}
          <div className="flex flex-col justify-center items-center p-2 w-28">
            {eventLogoUrl && (
              <img
                src={eventLogoUrl}
                alt=""
                className="object-contain"
                style={{ width: '108px', height: '108px', opacity: 0.94 }}
              />
            )}
          </div>

          {/* Center: Timer + RD/PK as a tight centered pair */}
          <div className="flex-1 flex flex-col items-center justify-center gap-1">
            <div ref={clockRef} className="inline-flex items-center justify-center">
              <span
                className={`text-4xl font-bold font-mono tabular-nums leading-none ${displayRemainingSec <= 10 ? 'text-red-500' : ''}`}
                style={{ color: clockDigitColor, textShadow: displayRemainingSec <= 10 ? undefined : eventGlow }}
              >
                {formatTime(displayRemainingSec)}
              </span>
            </div>
            <div className="text-base text-center font-bold" style={{ color: eventColor1 }}>
              RD {roundNumber} &nbsp; PK {pickInRound}
            </div>
          </div>

          {/* Right: On-clock logo (top) + NEXT with small logos (bottom) */}
          <div className="flex flex-col items-center justify-center gap-2 p-2">
            <div
              className="w-24 h-24 bg-zinc-700 rounded overflow-hidden border-2 shrink-0"
              style={{ borderColor: teamColors[0], boxShadow: `0 0 10px ${teamColors[0]}66` }}
            >
              {teamLogo && <img src={teamLogo} alt={currentTeam?.name || ''} className="w-full h-full object-contain" />}
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[9px] text-zinc-400 uppercase tracking-wide">Next</span>
              <div className="flex gap-2">
                {nextTeamsForClock.map((t, i) => (
                  <div key={i} className="w-12 h-12 bg-zinc-600 rounded overflow-hidden">
                    {t.logoPath && <img src={t.logoPath} alt={t.name} className="w-full h-full object-contain" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Team secondary-color divider strip between clock + info bar */}
        <div
          className="shrink-0 self-stretch"
          style={{
            width: '8px',
            background: `linear-gradient(180deg, ${teamColors[1]} 0%, ${teamColors[1]}dd 55%, #0b0b0b 100%)`,
            boxShadow: `0 0 10px ${teamColors[1]}66`,
          }}
        />

        {/* InfoBar: rotating ticker (on-the-clock overlay is sibling, covers full bottom bar) */}
        <div
          className="flex-1 p-2 overflow-hidden relative"
          style={{
            background: teamColors[0],
            borderRadius: '4px',
            height: '184px',
          }}
        >
          <DraftInfoBarTicker
            ref={tickerRef}
            draftId={draft?.id ?? null}
            picksPerRound={picksPerRound}
            onClockTeam={currentTeam?.name ?? null}
            available={available}
            recentPicks={draft?.recentPicks}
            curOverall={draft?.curOverall}
            usingCustom={usingCustom}
            pendingPick={!!pendingPick}
            onControlStateChange={onTickerControlStateChange}
          />
        </div>
        {animPhase === 'clock' && animDataRef.current?.nextTeamName && (() => {
          const teamName = animDataRef.current!.nextTeamName!;
          const colors = getTeamColors(teamName);
          const curOverall = animDataRef.current!.overall + 1;
          return (
            <NowOnClockAnimation
              key={`clock-animation-${animDataRef.current!.overall}`}
              layout="infoBar"
              team={{
                name: teamName,
                colors: [colors.primary, colors.secondary, null],
              }}
              pickNumber={curOverall}
              round={Math.floor((curOverall - 1) / picksPerRound) + 1}
              pickInRound={((curOverall - 1) % picksPerRound) + 1}
              eventName={draft?.eventName}
              eventYear={draft?.year}
              eventLogoUrl={eventLogoUrl}
              eventColor1={eventColor1}
              onComplete={() => {
                void finishClockIntroPhase();
              }}
            />
          );
        })()}
      </div>

      {/* PHASE: Pick animation */}
      {animPhase === 'pick' && animDataRef.current && (animDataRef.current.pick.playerName || animDataRef.current.pick.playerId) && (
        <DraftPickAnimation
          key={`pick-animation-${animDataRef.current.overall}`}
          player={{
            name: animDataRef.current.pick.playerName || animDataRef.current.pick.playerId || 'Unknown Player',
            position: animDataRef.current.pick.playerPos || 'N/A',
            team: animDataRef.current.pick.playerNfl || undefined,
            college: pickAnimCollege,
            imageUrl: animDataRef.current.imageUrl || undefined,
          }}
          fantasyTeam={{
            name: animDataRef.current.pick.team,
            colors: [getTeamColors(animDataRef.current.pick.team).primary, getTeamColors(animDataRef.current.pick.team).secondary, null],
            logoPath: getTeamLogoPath(animDataRef.current.pick.team),
          }}
          pickNumber={animDataRef.current.overall}
          round={animDataRef.current.round}
          pickInRound={animDataRef.current.pickInRound}
          eventLogoUrl={eventLogoUrl}
          eventColor1={eventColor1}
          onComplete={() => {
            // pick → clock (always), then clock → video (if player has one)
            setAnimPhase('clock');
          }}
        />
      )}

      {/* PHASE: Round recap overlay — shown between rounds while admin starts next */}
      {showRoundRecap && draft && (
        <RoundRecapOverlay
          key={`round-recap-${completedRound}`}
          roundNumber={completedRound}
          nextRound={nextRoundNumber}
          picks={roundRecapPicks}
          draftId={draft.id}
          isAdmin={isAdmin}
          eventLogoUrl={eventLogoUrl}
          eventColor1={eventColor1}
          onStartNextRound={handleStartNextRound}
        />
      )}

      {/* PHASE: End-of-round animation — plays after last pick of a round, before recap */}
      {endOfRoundAnimRound !== null && (
        <EndOfRoundAnimation
          key={`eor-${endOfRoundAnimRound}`}
          roundNumber={endOfRoundAnimRound}
          eventLogoUrl={eventLogoUrl}
          eventColor1={eventColor1}
          onComplete={() => setEndOfRoundAnimRound(null)}
        />
      )}

      {/* PHASE: Start-of-round animation — plays when admin starts the next round */}
      {startOfRoundAnimRound !== null && (
        <StartOfRoundAnimation
          key={`sor-${startOfRoundAnimRound}`}
          roundNumber={startOfRoundAnimRound}
          eventLogoUrl={eventLogoUrl}
          eventColor1={eventColor1}
          onComplete={() => setStartOfRoundAnimRound(null)}
        />
      )}

      {/* PHASE: Trade animation (full-screen, independent of pick pipeline) */}
      {tradeAnimData && (
        <DraftTradeAnimation
          key={`trade-${tradeAnimSeenIdRef.current}`}
          teams={tradeAnimData.teams}
          assets={tradeAnimData.assets}
          eventLogoUrl={eventLogoUrl}
          eventColor1={eventColor1}
          picksPerRound={picksPerRound}
          onComplete={() => {
            const captured = tradeAnimData;
            setTradeAnimData(null);
            // Only resume the clock if it was live when the trade was approved.
            // Calling resume unconditionally resets the clock to full time when
            // paused_remaining_secs is 0 (e.g. clock had already expired).
            if (captured?.resumeAfterAnimation) {
              fetch('/api/draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'trade_anim_complete', id: draft?.id }),
              }).catch(() => {});
            }
            // Clear animation trigger in DB
            fetch('/api/draft/trade', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'clear_trade_animation', draftId: draft?.id }),
            }).catch(() => {});
          }}
        />
      )}

    </div>
  );
});

export default DraftOverlayLive;
