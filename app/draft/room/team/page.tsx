'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { getTeamLogoPath } from '@/lib/utils/team-utils';
import { getTeamColors } from '@/lib/constants/team-colors';
import { TEAM_NAMES } from '@/lib/constants/league';
import DraftPickAnimation from '@/components/draft-overlay/DraftPickAnimation';
import NowOnClockAnimation from '@/components/draft-overlay/NowOnClockAnimation';
import DraftTradeCenter from '@/components/draft-overlay/DraftTradeCenter';
import DraftTradeAnimation, { type TradeAnimAsset } from '@/components/draft-overlay/DraftTradeAnimation';
import DraftInfoBarTicker from '@/components/draft-overlay/DraftInfoBarTicker';
import RoundRecapOverlay from '@/components/draft-overlay/RoundRecapOverlay';
import TeamProspectDraftboardCompact from '@/components/draft/TeamProspectDraftboardCompact';
import { DEFAULT_PLAYERS } from '@/components/draft/prospect-board-data';
import EndOfRoundAnimation from '@/components/draft-overlay/EndOfRoundAnimation';
import StartOfRoundAnimation from '@/components/draft-overlay/StartOfRoundAnimation';
import {
  DRAFT_ANIMATION_CLOCK_START_ACTION,
  draftPicksPerRound,
  draftPickAnimationDecision,
  draftPickAnimationIdentity,
  draftTradeAnimationKey,
  shouldInstantSubmitTopQueue,
  type DraftPickAnimationIdentity,
  DRAFT_ANIM_CLOCK_PHASE_MAX_MS,
  DRAFT_ANIM_PICK_PHASE_MAX_MS,
} from '@/components/draft-overlay/draft-display-utils';
import { gsap } from 'gsap';
import { QueueListIcon } from '@heroicons/react/24/outline';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF', 'K'];

function getYoutubeEmbedUrl(url: string): string | null {
  try {
    let videoId: string | null = null;
    if (url.includes('youtu.be/')) videoId = url.split('youtu.be/')[1]?.split(/[?&]/)[0] || null;
    else if (url.includes('youtube.com')) { const u = new URL(url); videoId = u.searchParams.get('v') || u.pathname.split('/').pop() || null; }
    if (!videoId) return null;
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1`;
  } catch { return null; }
}

const POS_COLORS: Record<string, string> = {
  QB: '#C00000', RB: '#FFC000', WR: '#0070C0', TE: '#00B050', DEF: '#4F4F4F', K: '#FF8C42',
};

type DraftPick = { overall: number; round: number; team: string; playerId: string; playerName?: string | null; playerPos?: string | null; playerNfl?: string | null; madeAt: string };
type DraftSlot = { overall: number; round: number; team: string };

type DraftOverview = {
  id: string;
  year: number;
  rounds: number;
  clockSeconds: number;
  status: 'NOT_STARTED' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  curOverall: number;
  onClockTeam?: string | null;
  deadlineTs?: string | null;
  eventName?: string | null;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  eventColor2?: string | null;
  recentPicks: DraftPick[];
  allPicks?: DraftPick[];
  upcoming: DraftSlot[];
  allSlots?: DraftSlot[];
  roundEndPause?: boolean | null;
  pendingTradeAnimation?: {
    tradeId?: string | null;
    teams: string[];
    assets: TradeAnimAsset[];
    resumeAfterAnimation?: boolean;
    triggerPickAnimation?: boolean;
    newClockTeam?: string | null;
  } | null;
};

type PendingPick = {
  id: string; overall: number; team: string; playerId: string;
  playerName: string | null; playerPos: string | null; playerNfl: string | null;
} | null;

type MeResp = { authenticated: boolean; isAdmin?: boolean; claims?: { team?: string } };
type Avail = { id: string; name: string; pos: string; nfl: string; college?: string | null };
type QueueItem = { id: string; name: string; pos: string; nfl: string };
type RosterPlayer = { id: string; name: string; pos: string; nfl: string };

export default function DraftRoomPage() {
  const [me, setMe] = useState<MeResp>({ authenticated: false });
  const [draft, setDraft] = useState<DraftOverview | null>(null);
  const [pendingPick, setPendingPick] = useState<PendingPick>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('');
  const [avail, setAvail] = useState<Avail[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [localRemaining, setLocalRemaining] = useState<number | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [pickStatus, setPickStatus] = useState<null | 'pending' | 'rejected'>(null);
  const [submittedPlayer, setSubmittedPlayer] = useState<Avail | null>(null);
  const [autoPickEnabled, setAutoPickEnabled] = useState(false);
  const [adminTeamOverride, setAdminTeamOverride] = useState<string>('');
  const [rosterPosFilter, setRosterPosFilter] = useState<string>('ALL');
  const [tradeAnimData, setTradeAnimData] = useState<{
    tradeId?: string | null;
    teams: string[];
    assets: TradeAnimAsset[];
    resumeAfterAnimation?: boolean;
    triggerPickAnimation?: boolean;
    newClockTeam?: string | null;
  } | null>(null);
  const tradeAnimSeenIdRef = useRef<string | null>(null);
  const preTradeClockTeamRef = useRef<string | null>(null);
  const [teamRoster, setTeamRoster] = useState<RosterPlayer[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [confirmPlayer, setConfirmPlayer] = useState<Avail | null>(null);
  const [teamPanelTab, setTeamPanelTab] = useState<'pick' | 'queue' | 'roster' | 'trade' | 'board'>('pick');
  const [pickAnimCollege, setPickAnimCollege] = useState<string | undefined>(undefined);
  const usingCustomPoolRef = useRef(false);
  const [usingCustomPool, setUsingCustomPool] = useState(false);
  const [tradeInboxCount, setTradeInboxCount] = useState(0);
  const [tradeNotif, setTradeNotif] = useState(false);
  const prevTradeInboxCountRef = useRef(0);
  const tradeTabVisibleRef = useRef(false);
  tradeTabVisibleRef.current = teamPanelTab === 'trade';
  const [activeViewers, setActiveViewers] = useState<string[]>([]);
  const [queueEditIdx, setQueueEditIdx] = useState<number | null>(null);
  const [queueEditVal, setQueueEditVal] = useState('');
  const [boardRankByName, setBoardRankByName] = useState<Record<string, { overall: number; posRank: number }>>({});
  const [boardRankById, setBoardRankById] = useState<Record<string, { overall: number; posRank: number }>>({});
  const [approvedTradeCount, setApprovedTradeCount] = useState(0);
  const prevApprovedTradeCountRef = useRef(0);
  const [rosterFromSnapshot, setRosterFromSnapshot] = useState(false);

  // End-of-round / start-of-round animation state
  type EndRoundAnimState = 'idle' | 'waiting' | 'playing' | 'done';
  const [endRoundAnimState, setEndRoundAnimState] = useState<EndRoundAnimState>('idle');
  const [startRoundAnimPlaying, setStartRoundAnimPlaying] = useState(false);
  const startRoundAnimNumberRef = useRef(1);
  // Ref-based guard: avoids stale-closure issues with state checks inside effects
  const endRoundAnimFiredRef = useRef(false);
  const startAnimFiredThisRoundRef = useRef(false);
  const prevRoundEndPauseRef = useRef<boolean | null | undefined>(undefined);

  // Animation phase state — mirrors DraftOverlayLive (display only, no admin controls)
  const [animPhase, setAnimPhase] = useState<'pick' | 'clock' | 'video' | null>(null);
  const [videoExiting, setVideoExiting] = useState(false);
  const animDataRef = useRef<{
    pick: DraftPick; nextTeamName: string | null; overall: number;
    round: number; pickInRound: number; videoUrl: string | null; imageUrl: string | null;
  } | null>(null);
  const animPlayerVideosRef = useRef<Record<string, { videoUrl: string | null; hasImage: boolean }>>({});
  const animLastPickRef = useRef<DraftPickAnimationIdentity | null>(null);
  const animInitRef = useRef(false);
  const animDismissingRef = useRef(false);
  const animPhaseRef = useRef(animPhase);
  const animVideoContainerRef = useRef<HTMLDivElement>(null);
  const animStartTimeRef = useRef<number>(0);
  const clockPhaseFinishedRef = useRef(false);
  const pendingGridAnimRef = useRef<{ idx: number; team: string } | null>(null);
  const finishClockIntroAfterAnimRef = useRef<() => Promise<void>>(async () => {});
  const roomClockRef = useRef<HTMLDivElement>(null);
  const prevAnimPhaseForClockHudRoomRef = useRef<'pick' | 'clock' | 'video' | null>(null);
  const [postIntroClockRoomSeq, setPostIntroClockRoomSeq] = useState(0);
  const [clockHudRoomTeamPrimary, setClockHudRoomTeamPrimary] = useState(false);

  const prevPendingRef = useRef<PendingPick>(null);
  const beepPlayedRef = useRef(false);
  const instantSubmitOverallRef = useRef<number | null>(null);
  const instantSubmitInFlightRef = useRef(false);
  const [instantSubmitRetry, setInstantSubmitRetry] = useState(0);
  const queueRef = useRef<QueueItem[]>([]);
  const submitPickRef = useRef<(player: Avail) => Promise<void>>(async () => {});
  const myTeamRef = useRef<string | null>(null);
  const isFirstSearch = useRef(true);
  const prevCurOverallRef = useRef<number | null>(null);
  const searchRef = useRef(search);
  const posFilterRef = useRef(posFilter);
  searchRef.current = search;
  posFilterRef.current = posFilter;

  const isAdmin = !!me?.isAdmin;
  const onClock = draft?.onClockTeam || null;
  const myTeam = me?.claims?.team || (isAdmin ? (adminTeamOverride || onClock || null) : null);
  const isMyTurn = !!myTeam && !!onClock && myTeam === onClock;
  myTeamRef.current = myTeam;

  function dismissVideo() {
    if (animDismissingRef.current) return;
    animDismissingRef.current = true;
    if (animVideoContainerRef.current) gsap.killTweensOf(animVideoContainerRef.current);
    setVideoExiting(true);
    setTimeout(() => { setAnimPhase(null); setVideoExiting(false); animDismissingRef.current = false; }, 350);
  }

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const playBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    } catch { /* not supported */ }
  }, []);

  function getDraftPollMs(status: DraftOverview['status'] | null | undefined): number {
    if (status === 'LIVE') return 3000;
    if (status === 'PAUSED' || status === 'NOT_STARTED') return 8000;
    if (status === 'COMPLETED') return 12000;
    return 5000;
  }

  const submitPick = useCallback(async (player: Avail) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pick', playerId: player.id, playerName: player.name, playerPos: player.pos, playerNfl: player.nfl }),
      });
      const j = await res.json();
      if (!res.ok || j?.error) {
        const msg = j?.error === 'pick_submit_failed'
          ? 'Could not submit pick (server error). Please try again or contact the commissioner.'
          : (j?.error || 'Pick failed');
        alert(msg);
        return;
      }
      setPickStatus('pending');
      setSubmittedPlayer(player);
      setSearch('');
      setAvail(prev => prev.filter(p => p.id !== player.id));
    } finally {
      setSubmitting(false);
    }
  }, []);
  submitPickRef.current = submitPick;

  async function load(includeAvail = false, silent = false) {
    try {
      if (!silent) setLoading(true);
      const url = includeAvail ? '/api/draft?include=available' : '/api/draft';
      const res = await fetch(url, { cache: 'no-store' });
      const j = await res.json();
      const newDraft = j?.draft || null;
      const newPending: PendingPick = j?.pendingPick ?? null;
      const newRemaining = j?.remainingSec ?? null;
      setDraft(newDraft);
      setRemainingSec(newRemaining);
      setLocalRemaining(newRemaining);
      setLastFetchTime(Date.now());
      // If a new pick was approved (curOverall advanced), silently refresh available players
      // Detect pending trade animation
      if (newDraft?.pendingTradeAnimation) {
        const animKey = draftTradeAnimationKey(newDraft.pendingTradeAnimation);
        if (tradeAnimSeenIdRef.current !== animKey) {
          tradeAnimSeenIdRef.current = animKey;
          preTradeClockTeamRef.current = newDraft.onClockTeam ?? null;
          setTradeAnimData(newDraft.pendingTradeAnimation);
        }
      }
      const newCurOverall = newDraft?.curOverall ?? null;
      if (newCurOverall !== null && prevCurOverallRef.current !== null && newCurOverall !== prevCurOverallRef.current) {
        fetch('/api/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'available', q: searchRef.current, pos: posFilterRef.current, limit: 50 }),
        }).then(r => r.json()).then(j2 => setAvail((j2?.available as Avail[]) || [])).catch(() => {});
      }
      prevCurOverallRef.current = newCurOverall;
      const prevPending = prevPendingRef.current;
      if (prevPending && prevPending.team === myTeamRef.current && !newPending) {
        const picks: DraftPick[] = newDraft?.allPicks || newDraft?.recentPicks || [];
        if (picks.some(p => p.playerId === prevPending.playerId)) {
          setPickStatus(null); setSubmittedPlayer(null);
        } else {
          setPickStatus('rejected');
          // Rejected player was never committed — refresh available list so they reappear
          fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'available', q: searchRef.current, pos: posFilterRef.current, limit: 50 }) })
            .then(r => r.json()).then(j2 => setAvail((j2?.available as Avail[]) || [])).catch(() => {});
        }
      }
      prevPendingRef.current = newPending;
      setPendingPick(newPending);
      // Auto-remove the approved player from queue so it doesn't linger or re-trigger autopick
      if (prevPending && prevPending.team === myTeamRef.current && !newPending) {
        const wasApproved = (newDraft?.allPicks || newDraft?.recentPicks || []).some((p: DraftPick) => p.playerId === prevPending.playerId);
        if (wasApproved && queueRef.current.some(q => q.id === prevPending.playerId)) {
          const cleaned = queueRef.current.filter(q => q.id !== prevPending.playerId);
          setQueue(cleaned);
          queueRef.current = cleaned;
          const qBody: Record<string, unknown> = { action: 'queue_set', players: cleaned };
          if (myTeamRef.current) qBody.team = myTeamRef.current;
          fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(qBody) }).catch(() => {});
        }
      }
      // Auto-remove any players from queue who have already been drafted
      if (queueRef.current.length > 0) {
        const pickedIds = new Set((newDraft?.allPicks || newDraft?.recentPicks || []).map((p: DraftPick) => p.playerId));
        const filtered = queueRef.current.filter(q => !pickedIds.has(q.id));
        if (filtered.length !== queueRef.current.length) {
          setQueue(filtered);
          queueRef.current = filtered;
          const qBody: Record<string, unknown> = { action: 'queue_set', players: filtered };
          if (myTeamRef.current) qBody.team = myTeamRef.current;
          fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(qBody) }).catch(() => {});
        }
      }
      if (newRemaining !== null && newRemaining > 10) beepPlayedRef.current = false;
      if (includeAvail) {
        setAvail((j?.available as Avail[]) || []);
        const uc = Boolean(j?.usingCustom);
        usingCustomPoolRef.current = uc;
        setUsingCustomPool(uc);
      }
      // Update active viewers
      if (Array.isArray(j?.activeViewers)) {
        setActiveViewers(j.activeViewers as string[]);
      }
    } finally {
      setLoading(false);
    }
  }

  finishClockIntroAfterAnimRef.current = async () => {
    if (clockPhaseFinishedRef.current) return;
    clockPhaseFinishedRef.current = true;
    // Animations are done — signal the server to start the next team's clock now.
    // resumeAfterAnimation is idempotent so multiple clients calling this is safe.
    try {
      await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: DRAFT_ANIMATION_CLOCK_START_ACTION }),
      });
    } catch { /* ignore */ }
    try {
      await load(false, true);
    } catch { /* ignore */ }
    setAnimPhase(!!(animDataRef.current?.videoUrl) ? 'video' : null);
  };

  const syncQueue = async (newQueue: QueueItem[]) => {
    setQueue(newQueue);
    queueRef.current = newQueue;
    const body: Record<string, unknown> = { action: 'queue_set', players: newQueue };
    if (isAdmin && myTeam) body.team = myTeam;
    await fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  };
  const addToQueue = async (player: Avail) => {
    if (queue.some(q => q.id === player.id)) return;
    await syncQueue([...queue, player]);
  };
  const removeFromQueue = async (id: string) => syncQueue(queue.filter(q => q.id !== id));
  const moveInQueue = async (id: string, dir: 'up' | 'down') => {
    const idx = queue.findIndex(q => q.id === id);
    if (idx < 0) return;
    const nIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (nIdx < 0 || nIdx >= queue.length) return;
    const nq = [...queue];
    [nq[idx], nq[nIdx]] = [nq[nIdx], nq[idx]];
    await syncQueue(nq);
  };
  const moveToQueuePosition = async (id: string, targetPos: number) => {
    const fromIdx = queue.findIndex(q => q.id === id);
    if (fromIdx < 0) return;
    const toIdx = targetPos - 1;
    if (toIdx < 0 || toIdx >= queue.length || toIdx === fromIdx) return;
    const nq = [...queue];
    const [item] = nq.splice(fromIdx, 1);
    nq.splice(toIdx, 0, item);
    await syncQueue(nq);
  };

  // Load instant-submit preference from localStorage, scoped to the authenticated team.
  useEffect(() => {
    const authenticatedTeam = me?.claims?.team;
    if (!authenticatedTeam) { setAutoPickEnabled(false); return; }
    try {
      const stored = localStorage.getItem(`evw_draft_autopick_${authenticatedTeam}`);
      setAutoPickEnabled(stored === 'true');
    } catch {}
  }, [me?.claims?.team]);

  // Fetch prospect board ranks once on mount — used in Pick tab to sort and annotate players.
  // Builds two lookup maps (by prospect board ID and by lowercase name) for robust matching.
  useEffect(() => {
    fetch('/api/team-prospect-draftboard', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const orderIds: string[] = Array.isArray(data?.data?.orderIds) ? data.data.orderIds : [];
        const playerById = Object.fromEntries(DEFAULT_PLAYERS.map(p => [p.id, p]));
        const ranked: typeof DEFAULT_PLAYERS = [];
        const usedIds = new Set<string>();
        for (const id of orderIds) {
          const p = playerById[id];
          if (p && !usedIds.has(id)) { ranked.push(p); usedIds.add(id); }
        }
        // Append any board players not in saved order (new additions or first use)
        for (const p of DEFAULT_PLAYERS) { if (!usedIds.has(p.id)) ranked.push(p); }
        const posCount: Record<string, number> = {};
        const byName: Record<string, { overall: number; posRank: number }> = {};
        const byId:   Record<string, { overall: number; posRank: number }> = {};
        ranked.forEach((p, idx) => {
          posCount[p.pos] = (posCount[p.pos] || 0) + 1;
          const entry = { overall: idx + 1, posRank: posCount[p.pos] };
          byName[p.name.toLowerCase()] = entry;
          byId[p.id] = entry;
        });
        setBoardRankByName(byName);
        setBoardRankById(byId);
      })
      .catch(() => {});
  }, []);

  // Fetch team roster — uses snapshot data (trade-accurate) when draftId + snapshot available,
  // falls back to Sleeper. Re-fetches when curOverall advances OR approved trade count changes.
  const rosterRefreshKey = `${myTeam}_${draft?.curOverall ?? 0}_${approvedTradeCount}`;
  useEffect(() => {
    if (!myTeam) { setTeamRoster([]); return; }
    setRosterLoading(true);
    const draftIdParam = draft?.id ? `&draftId=${encodeURIComponent(draft.id)}` : '';
    fetch(`/api/draft/team-roster?team=${encodeURIComponent(myTeam)}${draftIdParam}`)
      .then(r => r.json())
      .then(j => {
        setTeamRoster((j?.players as RosterPlayer[]) || []);
        setRosterFromSnapshot(!!j?.fromSnapshot);
      })
      .catch(() => { setTeamRoster([]); setRosterFromSnapshot(false); })
      .finally(() => setRosterLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterRefreshKey]);

  // Bootstrap
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then((j: MeResp) => setMe(j)).catch(() => {});
    load(true);
  }, []);

  useEffect(() => {
    let t: ReturnType<typeof setInterval>;
    const jitter = () => Math.floor(Math.random() * 400);
    const start = () => {
      const ms = (document.hidden ? 10000 : getDraftPollMs(draft?.status)) + jitter();
      t = setInterval(() => load(false, true), ms);
    };
    const onVis = () => {
      clearInterval(t);
      load(false, true);
      start();
    };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [draft?.status]);

  // Load queue when myTeam or admin status changes — scoped per team (admin passes team explicitly)
  useEffect(() => {
    if (!myTeam) { setQueue([]); queueRef.current = []; return; }
    const body: Record<string, unknown> = { action: 'queue_get' };
    if (isAdmin) body.team = myTeam;
    fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json()).then(j => { const q = (j?.queue as QueueItem[]) || []; setQueue(q); queueRef.current = q; })
      .catch(() => {});
  }, [myTeam, isAdmin]);

  // Presence heartbeat — send every 10s to indicate this team is viewing the draft room
  useEffect(() => {
    if (!myTeam && !isAdmin) return;
    const sendHeartbeat = () => {
      const body: Record<string, unknown> = { action: 'presence' };
      if (isAdmin) body.team = myTeam || 'Admin';
      fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => r.json())
        .then(j => { if (Array.isArray(j?.activeViewers)) setActiveViewers(j.activeViewers as string[]); })
        .catch(() => {});
    };
    sendHeartbeat(); // Send immediately on mount
    const interval = setInterval(sendHeartbeat, 10000);
    return () => clearInterval(interval);
  }, [myTeam, isAdmin]);

  // Debounced player search — skip first render (initial avail comes from load(true))
  useEffect(() => {
    if (isFirstSearch.current) { isFirstSearch.current = false; return; }
    const t = setTimeout(async () => {
      const res = await fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'available', q: search, pos: posFilter, limit: 50 }) });
      const j = await res.json();
      setAvail((j?.available as Avail[]) || []);
    }, 300);
    return () => clearTimeout(t);
  }, [search, posFilter]);

  // Countdown — only tick when LIVE; freeze display when PAUSED (e.g. pending pick approval)
  useEffect(() => {
    if (remainingSec === null) return;
    if (draft?.status !== 'LIVE') {
      setLocalRemaining(remainingSec);
      return;
    }
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastFetchTime) / 1000);
      const newLocal = Math.max(0, remainingSec - elapsed);
      setLocalRemaining(newLocal);
      if (
        animPhase !== 'clock' &&
        animPhase !== 'pick' &&
        newLocal <= 10 &&
        newLocal > 0 &&
        !beepPlayedRef.current &&
        isMyTurn
      ) {
        beepPlayedRef.current = true; playBeep();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingSec, lastFetchTime, isMyTurn, playBeep, draft?.status, animPhase]);

  // Native instant submit. Expiration autopick remains server-owned and still
  // falls back to the best available player when the queue is empty.
  useEffect(() => {
    const authenticatedTeam = me?.claims?.team || null;
    const overall = draft?.curOverall ?? null;
    const isMyPickPendingNow = pickStatus === 'pending' || pendingPick?.team === authenticatedTeam;

    if (authenticatedTeam !== onClock) {
      instantSubmitOverallRef.current = null;
      instantSubmitInFlightRef.current = false;
    }

    if (!shouldInstantSubmitTopQueue({
      enabled: autoPickEnabled,
      authenticatedTeam,
      onClockTeam: onClock,
      draftStatus: draft?.status,
      overall,
      queueLength: queue.length,
      hasPendingPick: isMyPickPendingNow,
      submitting: submitting || instantSubmitInFlightRef.current,
      attemptedOverall: instantSubmitOverallRef.current,
    })) {
      return;
    }

    instantSubmitOverallRef.current = overall;
    instantSubmitInFlightRef.current = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    void (async () => {
      let submitted = false;
      for (const qp of queueRef.current) {
        try {
          const res = await fetch('/api/draft', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'pick', playerId: qp.id, playerName: qp.name, playerPos: qp.pos, playerNfl: qp.nfl }),
          });
          const j = await res.json();
          if (res.ok && !j?.error) {
            setPickStatus('pending');
            setSubmittedPlayer(qp);
            submitted = true;
            break;
          }
          if (j?.error === 'player_already_picked') continue;
          break;
        } catch {
          break;
        }
      }

      instantSubmitInFlightRef.current = false;
      if (!submitted && !cancelled && instantSubmitOverallRef.current === overall) {
        instantSubmitOverallRef.current = null;
        retryTimer = setTimeout(() => setInstantSubmitRetry((value) => value + 1), 1500);
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [autoPickEnabled, draft?.curOverall, draft?.status, instantSubmitRetry, me?.claims?.team, onClock, pendingPick, pickStatus, queue, submitting]);

  // Load player media for animations
  useEffect(() => {
    async function loadVideos() {
      try {
        const res = await fetch('/api/draft/player-videos', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json();
        const map: Record<string, { videoUrl: string | null; hasImage: boolean }> = {};
        for (const v of (j.videos || [])) { map[v.playerId] = { videoUrl: v.videoUrl || null, hasImage: !!v.hasImage }; }
        animPlayerVideosRef.current = map;
      } catch {}
    }
    loadVideos();
    const t = setInterval(loadVideos, 60000);
    return () => clearInterval(t);
  }, []);

  // Animation trigger — mirrors DraftOverlayLive
  // recentPicks is ordered ASC (oldest first); .at(-1) gives the newest pick
  const latestPickForAnimation = draft?.recentPicks?.length
    ? draft.recentPicks[draft.recentPicks.length - 1]
    : null;
  const latestPickAnimationKey = latestPickForAnimation
    ? draftPickAnimationIdentity(latestPickForAnimation).key
    : null;
  // Synchronous pre-paint ref for the async effect below.
  const pendingAnimateRef = useRef<NonNullable<typeof latestPickForAnimation>>(null);

  // Mask the incoming pick's grid cell BEFORE the browser paints the player's name.
  // Runs synchronously with the same render that reveals lastPick and updates the grid.
  useLayoutEffect(() => {
    const lastPick = latestPickForAnimation;
    if (!lastPick) {
      // Only set initialized once draft data has actually loaded — same guard as DraftOverlayLive
      if (!animInitRef.current && draft !== null) animInitRef.current = true;
      animLastPickRef.current = null;
      return;
    }
    if (!animInitRef.current) {
      animInitRef.current = true;
      animLastPickRef.current = draftPickAnimationIdentity(lastPick);
      return;
    }
    const nextIdentity = draftPickAnimationIdentity(lastPick);
    const decision = draftPickAnimationDecision(animLastPickRef.current, nextIdentity);
    animLastPickRef.current = nextIdentity;
    if (decision !== 'animate') return;
    // If this tab was hidden when the event happened, don't replay it on return.
    if (document.hidden) return;

    pendingGridAnimRef.current = { idx: lastPick.overall - 1, team: lastPick.team };
    // Inject pre-mask synchronously, before paint, so the cell stays blank for the full
    // animation duration. React re-renders will replace managed children but can't remove
    // this appended node.
    const pmIdx = lastPick.overall - 1;
    const pmCell = document.querySelector(`[data-grid-idx="${pmIdx}"]`) as HTMLElement | null;
    if (pmCell && !pmCell.querySelector('.gsap-pick-premask')) {
      const pm = document.createElement('div');
      pm.className = 'gsap-pick-premask';
      pm.style.cssText = 'position:absolute;inset:0;background:#0d0d12;z-index:9;pointer-events:none;';
      pmCell.appendChild(pm);
    }

    pendingAnimateRef.current = lastPick;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestPickAnimationKey]);

  // Load pick-reveal data (video/image/audio) and kick off the animation sequence. Runs after
  // the layout effect above has already masked the grid cell, so this async work (which can
  // take one or more network round-trips) never risks exposing the player's name early.
  useEffect(() => {
    const lastPick = pendingAnimateRef.current;
    if (!lastPick) return;
    pendingAnimateRef.current = null;

    void (async () => {
      try {
        const res = await fetch('/api/draft/player-videos', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const map: Record<string, { videoUrl: string | null; hasImage: boolean }> = {};
          for (const v of (j.videos || [])) {
            map[v.playerId] = { videoUrl: v.videoUrl || null, hasImage: !!v.hasImage };
          }
          animPlayerVideosRef.current = map;
        }
      } catch { /* use cached ref */ }

      animDataRef.current = {
        pick: lastPick,
        nextTeamName: draft?.onClockTeam || draft?.upcoming?.[0]?.team || null,
        overall: lastPick.overall,
        round: lastPick.round,
        pickInRound: ((lastPick.overall - 1) % picksPerRound) + 1,
        videoUrl: animPlayerVideosRef.current[lastPick.playerId]?.videoUrl || null,
        imageUrl: animPlayerVideosRef.current[lastPick.playerId]?.hasImage
          ? `/api/draft/player-image?playerId=${encodeURIComponent(lastPick.playerId)}`
          : null,
      };
      const w = window as Window & { __pickAudioAt?: number };
      if (!w.__pickAudioAt || Date.now() - w.__pickAudioAt > 3000) {
        try { w.__pickAudioAt = Date.now(); new Audio('/assets/teams/audio/pickIsIn.mp3').play().catch(() => {}); } catch { /* ignored */ }
      }
      animStartTimeRef.current = Date.now();
      setPickAnimCollege(undefined);
      setAnimPhase('pick');

      const pid = lastPick.playerId;
      if (usingCustomPoolRef.current) {
        const fromList = avail.find(a => a.id === pid);
        if (fromList?.college) setPickAnimCollege(fromList.college);
      } else {
        fetch(`/api/draft?action=player_info&playerId=${encodeURIComponent(pid)}`, { cache: 'no-store' })
          .then(r => r.json())
          .then(data => { if (data?.college) setPickAnimCollege(data.college); })
          .catch(() => {});
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestPickAnimationKey]);

  // Tab visibility — skip stale animation phases and repoll when tab becomes visible
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) return;
      // Repoll immediately to get fresh data
      load(false);
      // Skip animation if it has been running longer than ~35s total
      setAnimPhase(prev => {
        if (!prev) return prev;
        const elapsed = Date.now() - animStartTimeRef.current;
        if (elapsed > 35000) return null;
        return prev;
      });
      // GSAP: disable lag-smoothing so resuming the tab doesn't rush animations
      gsap.ticker.lagSmoothing(0);
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    animPhaseRef.current = animPhase;
    if (animPhase === 'clock') clockPhaseFinishedRef.current = false;
  }, [animPhase]);

  // Safety net: if the draft is paused for pick animation but no animation is playing
  // (tab was hidden, animations were skipped, etc.), resume the clock after 15 seconds.
  useEffect(() => {
    if (draft?.status !== 'PAUSED') return;
    if (draft?.roundEndPause) return;
    if (pendingPick) return; // still waiting for admin approval — not an animation pause
    const t = setTimeout(() => {
      if (animPhaseRef.current === null) {
        fetch('/api/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: DRAFT_ANIMATION_CLOCK_START_ACTION }),
        }).catch(() => {});
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [draft?.status, draft?.roundEndPause, pendingPick]);

  // Grid cell wipe animation — executes after pick + clock phases complete
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

  // Phase safety timeouts
  useEffect(() => {
    if (animPhase === 'pick') {
      const t = setTimeout(() => setAnimPhase('clock'), DRAFT_ANIM_PICK_PHASE_MAX_MS);
      return () => clearTimeout(t);
    }
    if (animPhase === 'clock') {
      const t = setTimeout(() => { void finishClockIntroAfterAnimRef.current(); }, DRAFT_ANIM_CLOCK_PHASE_MAX_MS);
      return () => clearTimeout(t);
    }
  }, [animPhase]);

  // No nextTeamName — skip intro overlay; still reset clock + advance
  useEffect(() => {
    if (animPhase !== 'clock') return;
    if (!animDataRef.current?.nextTeamName) {
      void finishClockIntroAfterAnimRef.current();
    }
  }, [animPhase]);

  // YouTube postMessage handler
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

  // Poll for incoming trade offers — 8s during LIVE draft, 15s otherwise
  useEffect(() => {
    if (!myTeam || !draft?.id) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/draft/trade?action=get_team&team=${encodeURIComponent(myTeam)}&draftId=${draft.id}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const trades = (data.trades || []) as Array<{ status: string; teams: string[]; acceptedBy: string[] }>;
        const count = trades.filter(t => t.status === 'pending' && t.teams.includes(myTeam) && !t.acceptedBy.includes(myTeam)).length;
        setTradeInboxCount(count);
        if (count > prevTradeInboxCountRef.current && !tradeTabVisibleRef.current) {
          setTradeNotif(true);
        }
        prevTradeInboxCountRef.current = count;
        // Track approved trade count to trigger roster re-fetch
        const approved = trades.filter(t => t.status === 'approved').length;
        if (approved !== prevApprovedTradeCountRef.current) {
          prevApprovedTradeCountRef.current = approved;
          setApprovedTradeCount(approved);
        }
      } catch {}
    };
    poll();
    const pollMs = draft?.status === 'LIVE' ? 8000 : 15000;
    const id = setInterval(poll, pollMs);
    return () => clearInterval(id);
  }, [myTeam, draft?.id, draft?.status]);

  // GSAP entrance + safety timeout for video
  useEffect(() => {
    if (animPhase !== 'video') return;
    animDismissingRef.current = false;
    if (animVideoContainerRef.current) {
      gsap.fromTo(animVideoContainerRef.current,
        { opacity: 0, scale: 0.96 },
        { opacity: 1, scale: 1, duration: 0.45, ease: 'power2.out' });
    }
    const safetyTimer = setTimeout(dismissVideo, 10 * 60 * 1000);
    return () => clearTimeout(safetyTimer);
  }, [animPhase]);

  // Derived display values
  const onClockColors = onClock ? getTeamColors(onClock) : null;
  const tc = onClockColors ? [onClockColors.primary, onClockColors.secondary] : ['#1a1a2e', '#16213e'];
  const onClockLogo = onClock ? getTeamLogoPath(onClock) : null;
  const allSlots = draft?.allSlots || [];
  // Deduplicate picks by overall to prevent duplicate display in infobars/roster
  const allPicksRaw = draft?.allPicks || draft?.recentPicks || [];
  const allPicks = [...new Map(allPicksRaw.map(p => [p.overall, p])).values()];
  const pickedByOverall = new Map(allPicks.map(p => [p.overall, p]));
  const rounds = draft?.rounds || 4;
  const picksPerRound = draftPicksPerRound(draft);
  const myTeamColors = myTeam ? getTeamColors(myTeam) : null;
  const isMyPickPending = pickStatus === 'pending' || (pendingPick?.team === myTeam);
  const eventColor1 = draft?.eventColor1 || '#a4c810';
  const eventLogoUrl = draft?.eventLogoUrl || null;
  const eventGlow = `0 0 10px ${eventColor1}66`;
  // Recap only shows once the end-of-round animation has played. Start-of-round hides it.
  const showRoundRecap = draft?.roundEndPause === true && animPhase === null && !tradeAnimData && endRoundAnimState === 'done' && !startRoundAnimPlaying;
  const completedRound = draft?.allPicks && draft.allPicks.length > 0 ? draft.allPicks[draft.allPicks.length - 1].round : 0;
  const nextRoundNumber = completedRound + 1;
  const roundRecapPicks = draft?.allPicks?.filter(p => p.round === completedRound) || [];
  const fullClockSecRoom = draft?.clockSeconds ?? 600;
  // During pick or clock-intro animations the real clock is frozen server-side;
  // show full clock time so the HUD never counts down while animations play.
  const displayRemainingSecRoom =
    (animPhase === 'pick' || animPhase === 'clock') ? fullClockSecRoom : localRemaining;

  useEffect(() => {
    const prev = prevAnimPhaseForClockHudRoomRef.current;
    prevAnimPhaseForClockHudRoomRef.current = animPhase;
    if (prev === 'clock' && animPhase === null) {
      setClockHudRoomTeamPrimary(false);
      setPostIntroClockRoomSeq((n) => n + 1);
    }
  }, [animPhase]);

  // Reset end-of-round state when round resumes (roundEndPause goes false).
  useEffect(() => {
    if (!draft?.roundEndPause) {
      endRoundAnimFiredRef.current = false;
      setEndRoundAnimState('idle');
    }
  }, [draft?.roundEndPause]);

  // End-of-round trigger: when pick animations finish AND roundEndPause is active,
  // start the 10-second wait. Uses a ref guard so it only fires once per round-end,
  // even if deps re-evaluate multiple times.
  useEffect(() => {
    if (animPhase !== null) return;
    if (!draft?.roundEndPause) return;
    if (tradeAnimData) return;
    if (endRoundAnimFiredRef.current) return; // already triggered this round-end
    endRoundAnimFiredRef.current = true;
    setEndRoundAnimState('waiting');
  }, [animPhase, draft?.roundEndPause, tradeAnimData]);

  // 10-second delay then play
  useEffect(() => {
    if (endRoundAnimState !== 'waiting') return;
    const t = setTimeout(() => setEndRoundAnimState('playing'), 10000);
    return () => clearTimeout(t);
  }, [endRoundAnimState]);

  // Start-of-round animation: fires when roundEndPause transitions true → false.
  // Uses a ref guard to avoid double-play when the same client both triggered the
  // resume (admin click) and then detects roundEndPause → false via polling.
  useEffect(() => {
    const prev = prevRoundEndPauseRef.current;
    prevRoundEndPauseRef.current = draft?.roundEndPause;
    if (draft?.roundEndPause === true) {
      startAnimFiredThisRoundRef.current = false;
    }
    if (prev === true && draft?.roundEndPause === false && !startAnimFiredThisRoundRef.current) {
      startAnimFiredThisRoundRef.current = true;
      startRoundAnimNumberRef.current = nextRoundNumber;
      setStartRoundAnimPlaying(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.roundEndPause]);

  useEffect(() => {
    if (postIntroClockRoomSeq === 0) return;
    const el = roomClockRef.current;
    let tween: gsap.core.Tween | null = null;
    const t1 = setTimeout(() => {
      setClockHudRoomTeamPrimary(true);
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
              if (el) gsap.set(el, { clearProps: 'scale' });
            },
          },
        );
      }
    }, 1000);
    return () => {
      clearTimeout(t1);
      tween?.kill();
      if (el) gsap.killTweensOf(el);
    };
  }, [postIntroClockRoomSeq]);

  useEffect(() => {
    if (displayRemainingSecRoom === null) return;
    if (displayRemainingSecRoom < fullClockSecRoom) setClockHudRoomTeamPrimary(false);
  }, [displayRemainingSecRoom, fullClockSecRoom]);

  useEffect(() => {
    if (animPhase === 'clock') return;
    if (roomClockRef.current && displayRemainingSecRoom !== null && displayRemainingSecRoom <= 10 && displayRemainingSecRoom > 0) {
      gsap.to(roomClockRef.current, {
        scale: 1.05,
        duration: 0.3,
        yoyo: true,
        repeat: 1,
        ease: 'power1.inOut',
      });
    }
  }, [displayRemainingSecRoom, animPhase]);

  const roomClockDigitColor =
    displayRemainingSecRoom === null ? eventColor1
    : displayRemainingSecRoom <= 10 ? '#ef4444'
    : clockHudRoomTeamPrimary && displayRemainingSecRoom >= fullClockSecRoom ? tc[0]
    : eventColor1;

  return (
    <div className="flex flex-col" style={{ background: 'var(--background)' }}>

      {/* ── DRAFT BOARD (full height, no internal scroll — whole page scrolls) ── */}
      <div className="relative border-b-2 border-zinc-700" style={{ background: '#0a0a0e' }}>
        {/* Event logo watermark — centered on board at low opacity */}
        {eventLogoUrl && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1]">
            <img src={eventLogoUrl} alt="" className="w-48 h-48 object-contain" style={{ opacity: 0.10 }} />
          </div>
        )}
        <div className="grid shrink-0 border-b border-zinc-800" style={{ gridTemplateColumns: `40px repeat(${rounds}, 1fr)`, background: '#111116' }}>
          <div className="text-center text-[10px] font-bold text-zinc-500 py-1.5" style={{ borderBottom: `2px solid ${eventColor1}` }}>#</div>
          {Array.from({ length: rounds }, (_, i) => (
            <div key={i} className="text-center text-[10px] font-bold text-zinc-400 py-1.5 border-l border-zinc-800" style={{ borderBottom: `2px solid ${eventColor1}` }}>Round {i + 1}</div>
          ))}
        </div>
        <div>
          {Array.from({ length: picksPerRound }, (_, pickIdx) => (
            <div key={pickIdx} className="grid border-b border-zinc-800/50 hover:bg-zinc-900/30" style={{ gridTemplateColumns: `40px repeat(${rounds}, 1fr)`, minHeight: '36px' }}>
              <div className={`flex items-center justify-center text-xs font-bold border-r border-zinc-800 ${draft && (draft.curOverall - 1) % picksPerRound === pickIdx && draft.status === 'LIVE' ? 'text-yellow-400 bg-yellow-400/10 animate-pulse' : 'text-zinc-600'}`}>
                {pickIdx + 1}
              </div>
              {Array.from({ length: rounds }, (_, roundIdx) => {
                const overall = roundIdx * picksPerRound + pickIdx + 1;
                const slot = allSlots.find(s => s.overall === overall);
                const picked = pickedByOverall.get(overall);
                const isCurrent = draft?.curOverall === overall;
                const isMySlot = slot?.team === myTeam;
                const slotLogo = slot ? getTeamLogoPath(slot.team) : null;
                const posColor = picked?.playerPos ? (POS_COLORS[picked.playerPos] || '#888') : null;
                const isViewerOnline = slot?.team && activeViewers.includes(slot.team);
                const viewerGlowColor = isViewerOnline && slot?.team ? getTeamColors(slot.team).primary : null;
                return (
                  <div
                    key={roundIdx}
                    data-grid-idx={overall - 1}
                    className={`relative flex items-center gap-1 px-1.5 overflow-hidden ${isCurrent ? 'bg-yellow-400/15 ring-1 ring-inset ring-yellow-400' : picked ? 'bg-zinc-800/60' : isMySlot ? 'bg-blue-900/25' : ''}`}
                    style={{ borderLeft: picked && posColor ? `3px solid ${posColor}` : '1px solid rgba(63,63,70,0.4)' }}
                  >
                    {slotLogo && (
                      <div
                        className={`shrink-0 w-5 h-5 rounded-sm ${isViewerOnline ? 'animate-pulse' : ''}`}
                        style={isViewerOnline && viewerGlowColor ? {
                          boxShadow: `0 0 8px 2px ${viewerGlowColor}, 0 0 12px 4px ${viewerGlowColor}66`,
                          background: `${viewerGlowColor}22`,
                        } : undefined}
                      >
                        <img src={slotLogo} alt="" className="w-full h-full object-contain" />
                      </div>
                    )}
                    {picked ? (
                      <div className="min-w-0 flex-1">
                        <div className="text-white text-[10px] font-semibold leading-tight truncate">{picked.playerName || picked.playerId}</div>
                        <div className="text-zinc-400 text-[9px] leading-tight">{picked.playerPos}</div>
                      </div>
                    ) : isCurrent ? (
                      <div className="text-yellow-400 text-[9px] font-bold uppercase tracking-wide animate-pulse">On Clock</div>
                    ) : isMySlot ? (
                      <div className="text-blue-400 text-[9px]">My pick</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Video overlay — absolute inside draftboard only (mirrors admin view) ── */}
        {(animPhase === 'video' || videoExiting) && animDataRef.current?.videoUrl && (() => {
          const videoUrl = animDataRef.current!.videoUrl!;
          const isYt = videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be');
          const embedUrl = isYt ? getYoutubeEmbedUrl(videoUrl) : null;
          return (
            <div
              ref={animVideoContainerRef}
              className="absolute inset-0 z-20 bg-black flex flex-col items-center justify-center overflow-hidden transition-opacity duration-[350ms]"
              style={{ opacity: videoExiting ? 0 : 1 }}
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
                      try { (e.currentTarget as HTMLIFrameElement).contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*'); } catch {}
                    }}
                  />
                ) : (
                  <video src={videoUrl} autoPlay controls className="w-full flex-1 rounded-lg" style={{ minHeight: 0, objectFit: 'contain' }} onEnded={dismissVideo} />
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Round Recap (inline card — teams keep full page access) ── */}
      {showRoundRecap && draft && (
        <div className="px-4 pt-4">
          <RoundRecapOverlay
            key={`room-recap-${completedRound}`}
            roundNumber={completedRound}
            nextRound={nextRoundNumber}
            picks={roundRecapPicks}
            draftId={draft.id}
            isAdmin={isAdmin}
            eventLogoUrl={eventLogoUrl}
            eventColor1={eventColor1}
            variant="inline"
            onStartNextRound={() => {
              // Play the start-of-round animation; the resume fetch fires when it completes.
              startAnimFiredThisRoundRef.current = true;
              startRoundAnimNumberRef.current = nextRoundNumber;
              setStartRoundAnimPlaying(true);
            }}
          />
        </div>
      )}

      {/* ── TEAM SECTION (below board, normal flow — whole page scrolls) ── */}
      <div>
        {/* ── Clock Box + Info Bar (always shown when draft is live) ── */}
        {draft && (() => {
          const overall = pendingPick?.overall ?? draft.curOverall;
          const roundNum = Math.ceil(overall / picksPerRound);
          const pickNum = ((overall - 1) % picksPerRound) + 1;
          const nextUp = (allSlots || [])
            .filter((u: DraftSlot) => u.overall > overall)
            .slice(0, 2);
          return (
            <div className="relative flex gap-0 items-stretch" style={{ minHeight: '184px', borderBottom: `2px solid ${eventColor1}33` }}>
              {/* ClockBox */}
              <div className="flex items-stretch shrink-0" style={{ width: '380px', background: 'linear-gradient(to bottom,#202020,#282828)', borderRadius: '4px', border: '1px solid #333' }}>
                <div className="flex flex-col justify-center items-center p-2 w-28">
                  {eventLogoUrl && <img src={eventLogoUrl} alt="" className="object-contain" style={{ width: '88px', height: '88px', opacity: 0.94 }} />}
                </div>
                <div className="flex-1 flex flex-col items-center justify-center gap-0.5">
                  <div
                    ref={roomClockRef}
                    className={`text-3xl font-bold font-mono ${displayRemainingSecRoom !== null && displayRemainingSecRoom <= 10 ? 'text-red-500' : ''}`}
                    style={{ color: roomClockDigitColor, textShadow: displayRemainingSecRoom !== null && displayRemainingSecRoom <= 10 ? undefined : eventGlow }}
                  >
                    {displayRemainingSecRoom !== null ? formatTime(displayRemainingSecRoom) : '--:--'}
                  </div>
                  <div className="text-xs text-center font-bold" style={{ color: eventColor1 }}>RD {roundNum} · PK {pickNum}</div>
                </div>
                <div className="flex flex-col items-center justify-center gap-2 p-2">
                  <div className="w-24 h-24 bg-zinc-700 rounded overflow-hidden border-2 shrink-0" style={{ borderColor: eventColor1, boxShadow: `0 0 10px ${eventColor1}66` }}>
                    {onClockLogo && <img src={onClockLogo} alt={onClock || ''} className="w-full h-full object-contain" />}
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] text-zinc-400 uppercase tracking-wide">Next</span>
                    <div className="flex gap-1.5">
                    {nextUp.map((t: DraftSlot, i: number) => (
                      <div key={i} className="w-9 h-9 bg-zinc-600 rounded overflow-hidden">
                        <img src={getTeamLogoPath(t.team)} alt={t.team} className="w-full h-full object-contain" />
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
                  background: `linear-gradient(180deg, ${tc[1]} 0%, ${tc[1]}dd 55%, #0b0b0b 100%)`,
                  boxShadow: `0 0 10px ${tc[1]}66`,
                }}
              />
              {/* InfoBar — ticker; on-the-clock overlay is sibling (covers clock + bar) */}
              <div className="flex-1 p-2 overflow-hidden relative" style={{ background: `linear-gradient(135deg, ${tc[0]}dd, ${tc[1]}cc)` }}>
                <DraftInfoBarTicker
                  draftId={draft?.id ?? null}
                  picksPerRound={picksPerRound}
                  onClockTeam={onClock}
                  available={avail}
                  recentPicks={draft?.recentPicks}
                  curOverall={draft?.curOverall}
                  pendingPick={!!pendingPick}
                  usingCustom={usingCustomPool}
                />
              </div>
              {animPhase === 'clock' && animDataRef.current?.nextTeamName && (() => {
                const teamName = animDataRef.current!.nextTeamName!;
                const colors = getTeamColors(teamName);
                const curOverall = animDataRef.current!.overall + 1;
                const ppr = picksPerRound;
                return (
                  <NowOnClockAnimation
                    key={`room-clock-${animDataRef.current!.overall}`}
                    layout="infoBar"
                    team={{ name: teamName, colors: [colors.primary, colors.secondary, null] }}
                    pickNumber={curOverall}
                    round={Math.floor((curOverall - 1) / ppr) + 1}
                    pickInRound={((curOverall - 1) % ppr) + 1}
                    eventName={draft?.eventName}
                    eventYear={draft?.year}
                    eventLogoUrl={draft?.eventLogoUrl}
                    eventColor1={draft?.eventColor1}
                    onComplete={() => { void finishClockIntroAfterAnimRef.current(); }}
                  />
                );
              })()}
            </div>
          );
        })()}

        <div className="p-3 space-y-3">

          {/* Status notices */}
          {isMyPickPending && (
            <div className="p-3 rounded-lg border-2 border-yellow-400 bg-yellow-400/10">
              <div className="font-bold text-sm text-yellow-600 dark:text-yellow-300">⏳ Pick Submitted — Awaiting Admin Approval</div>
              {submittedPlayer && <div className="text-xs mt-1 text-yellow-700 dark:text-yellow-200/80">{submittedPlayer.name} · {submittedPlayer.pos} · {submittedPlayer.nfl}</div>}
              <div className="text-xs mt-1 text-yellow-600/70 dark:text-yellow-400/60">Your pick will appear on the board once approved.</div>
            </div>
          )}
          {pickStatus === 'rejected' && (
            <div className="p-3 rounded-lg border-2 border-red-500 bg-red-500/10">
              <div className="font-bold text-sm text-red-600 dark:text-red-400">❌ Pick Rejected — Please try again.</div>
              <button type="button" className="mt-1 text-xs underline text-red-500 hover:text-red-400" onClick={() => { setPickStatus(null); setSubmittedPlayer(null); }}>Dismiss</button>
            </div>
          )}
          {!me.authenticated && !isAdmin && !loading && (
            <div className="p-3 rounded-lg border border-[var(--border)] text-[var(--muted)] text-sm">
              Log in with your team credentials to make picks.
            </div>
          )}

          {/* Admin team selector */}
          {isAdmin && !me.authenticated && (
            <div className="p-3 rounded-lg bg-yellow-400/10 border border-yellow-400/30 space-y-2">
              <div className="font-bold text-yellow-700 dark:text-yellow-300 text-xs uppercase tracking-wide">Admin mode — view as team</div>
              <select
                value={adminTeamOverride}
                onChange={e => setAdminTeamOverride(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-yellow-400/40 text-sm"
                style={{ background: 'var(--background)', color: 'var(--foreground)' }}
              >
                <option value="">{onClock ? `Auto (on clock: ${onClock})` : 'Auto (on clock)'}</option>
                {TEAM_NAMES.map(t => <option key={t} value={t}>{t}{t === onClock ? ' ⏰' : ''}</option>)}
              </select>
              {myTeam && (
                <div className="text-xs text-yellow-700 dark:text-yellow-300/70">
                  {myTeam === onClock ? '✅ On the clock — pick panel is open' : `Viewing as ${myTeam} — picks unlock when it's their turn`}
                </div>
              )}
            </div>
          )}

          {/* ── Team panel: pick / queue / roster (board grid unchanged above) ── */}
          {(me.authenticated || isAdmin) && (
            <div
              className="rounded-xl overflow-hidden border-2 shadow-md flex flex-col min-h-0"
              style={{
                borderColor: myTeamColors?.secondary ?? 'var(--border)',
                background: myTeamColors
                  ? `linear-gradient(180deg, ${myTeamColors.primary}18, var(--background))`
                  : 'var(--background)',
              }}
            >
              {myTeam && (
                <div className="flex items-center gap-3 px-3 py-2.5 border-b border-[var(--border)]/80">
                  <div
                    className="w-11 h-11 shrink-0 rounded-lg overflow-hidden border-2 bg-black/40 flex items-center justify-center"
                    style={{ borderColor: myTeamColors?.secondary ?? 'var(--border)' }}
                  >
                    <img src={getTeamLogoPath(myTeam)} alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-black text-sm text-[var(--foreground)] break-words leading-tight">{myTeam}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Pick · Queue · Roster · Trade · Board</div>
                  </div>
                </div>
              )}
              <div className="flex gap-1 px-2 py-2 border-b border-[var(--border)] bg-black/5 dark:bg-white/5 flex-wrap">
                {(['pick', 'queue', 'roster', 'trade', 'board'] as const).map(tab => {
                  const isTradeAlert = tab === 'trade' && tradeNotif && teamPanelTab !== 'trade';
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => { setTeamPanelTab(tab); if (tab === 'trade') setTradeNotif(false); }}
                      className={`flex-1 min-w-[4.5rem] py-2 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${isTradeAlert ? 'animate-pulse' : ''}`}
                      style={
                        isTradeAlert
                          ? { background: '#ef4444', color: '#fff', boxShadow: '0 0 12px #ef444488' }
                          : teamPanelTab === tab
                            ? { background: myTeamColors?.primary ?? '#be161e', color: '#fff', boxShadow: `0 0 0 1px ${myTeamColors?.secondary ?? 'transparent'}` }
                            : { background: 'transparent', color: 'var(--muted)' }
                      }
                    >
                      {tab === 'pick'
                        ? 'Pick'
                        : tab === 'queue'
                          ? `Queue${queue.length ? ` (${queue.length})` : ''}`
                          : tab === 'trade'
                            ? `Trade${tradeInboxCount > 0 ? ` (${tradeInboxCount})` : ''}`
                            : tab === 'board'
                              ? 'My Board'
                              : 'Roster'}
                    </button>
                  );
                })}
              </div>
              <div className={`p-3 space-y-3 flex-1 flex flex-col min-h-0 ${teamPanelTab === 'trade' ? 'min-h-[340px]' : ''}`}>
                {teamPanelTab === 'pick' && (
                  <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--background)]">
                    <div className="px-3 pt-3 pb-2 border-b border-[var(--border)]">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-bold text-[var(--muted)] uppercase tracking-wide">
                          {isMyTurn && !isMyPickPending ? 'Make your pick' : 'Browse players'}
                        </div>
                        {Object.keys(boardRankById).length > 0 && (
                          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: myTeamColors?.primary || '#be161e', background: `${myTeamColors?.primary || '#be161e'}15` }}>
                            Your Board Order
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-wrap mb-2">
                        {(['', ...POSITIONS] as string[]).map(pos => {
                          const active = posFilter === pos;
                          return (
                            <button
                              key={pos || 'all'}
                              type="button"
                              onClick={() => setPosFilter(pos)}
                              className="px-2.5 py-0.5 rounded-full text-xs font-bold border transition-colors"
                              style={active ? { background: pos ? POS_COLORS[pos] : '#555', color: '#fff', borderColor: 'transparent' } : { background: 'transparent', color: 'var(--muted)', borderColor: 'var(--border)' }}
                            >
                              {pos || 'All'}
                            </button>
                          );
                        })}
                      </div>
                      <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search player name…"
                        className="w-full"
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-[var(--border)]">
                      {avail.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-[var(--muted)]">{loading ? 'Loading…' : 'No results — try a search or change position filter.'}</div>
                      ) : (() => {
                        const hasBoardData = Object.keys(boardRankById).length > 0;
                        // Sort by this team's board rank when board data is loaded
                        const availSorted = hasBoardData
                          ? [...avail].sort((a, b) => {
                              const ra = boardRankById[a.id] || boardRankByName[a.name.toLowerCase()];
                              const rb = boardRankById[b.id] || boardRankByName[b.name.toLowerCase()];
                              if (ra && rb) return ra.overall - rb.overall;
                              if (ra) return -1;
                              if (rb) return 1;
                              return 0;
                            })
                          : avail;
                        return availSorted.map(p => {
                        const inQueue = queue.some(q => q.id === p.id);
                        const canPick = isMyTurn && !isMyPickPending;
                        const boardRank = boardRankById[p.id] || boardRankByName[p.name.toLowerCase()];
                        return (
                          <div key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/50">
                            {boardRank ? (
                              <div className="flex flex-col items-center shrink-0" style={{ minWidth: '32px' }}>
                                <span className="text-xs font-black leading-tight" style={{ color: myTeamColors?.primary || '#be161e' }}>
                                  #{boardRank.overall}
                                </span>
                                <span className="text-[9px] font-bold leading-tight" style={{ color: myTeamColors?.secondary || '#bf9944' }}>
                                  {p.pos}{boardRank.posRank}
                                </span>
                              </div>
                            ) : (
                              <div className="shrink-0" style={{ minWidth: '32px' }} />
                            )}
                            <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded text-white" style={{ background: POS_COLORS[p.pos] || '#555', minWidth: '30px', textAlign: 'center' }}>
                              {p.pos}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-[var(--foreground)] break-words leading-snug">{p.name}</div>
                              <div className="text-xs text-[var(--muted)]">{p.nfl}</div>
                            </div>
                            <div className="flex gap-1.5 shrink-0 self-center items-center">
                              {canPick && myTeamColors && (
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => setConfirmPlayer(p)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wide text-white shadow-sm disabled:opacity-50 transition-transform active:scale-[0.98]"
                                  style={{
                                    background: `linear-gradient(135deg, ${myTeamColors.primary} 0%, ${myTeamColors.secondary} 100%)`,
                                    boxShadow: `0 0 0 1px ${myTeamColors.secondary}66`,
                                  }}
                                >
                                  Pick
                                </button>
                              )}
                              {canPick && !myTeamColors && (
                                <Button size="sm" variant="primary" disabled={submitting} onClick={() => setConfirmPlayer(p)}>Pick</Button>
                              )}
                              <button
                                type="button"
                                onClick={() => (inQueue ? removeFromQueue(p.id) : addToQueue(p))}
                                title={inQueue ? 'Remove from queue' : 'Add to draft queue'}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors"
                                style={
                                  inQueue
                                    ? {
                                        borderColor: 'var(--border)',
                                        color: 'var(--muted)',
                                        background: 'transparent',
                                      }
                                    : myTeamColors
                                      ? {
                                          borderColor: `${myTeamColors.secondary}aa`,
                                          color: myTeamColors.primary,
                                          background: `${myTeamColors.primary}12`,
                                        }
                                      : {
                                          borderColor: 'var(--border)',
                                          color: 'var(--foreground)',
                                          background: 'transparent',
                                        }
                                }
                              >
                                <QueueListIcon className="w-3.5 h-3.5 shrink-0 opacity-90" aria-hidden />
                                {inQueue ? 'Queued' : 'Queue'}
                              </button>
                            </div>
                          </div>
                        );
                      });
                      })()}
                    </div>
                  </div>
                )}

                {teamPanelTab === 'queue' && (
                  <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--background)]">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
                      <div className="text-xs font-bold text-[var(--muted)] uppercase tracking-wide">
                        My queue {queue.length > 0 && <span className="text-[var(--foreground)]">({queue.length})</span>}
                      </div>
                      <div className="flex items-center gap-2 select-none">
                        <span className="text-xs text-[var(--muted)]">Instant submit</span>
                        <button
                          type="button"
                          aria-pressed={autoPickEnabled}
                          aria-label="Toggle instant submit"
                          disabled={!me?.claims?.team}
                          className={`relative w-9 h-5 rounded-full transition-colors ${autoPickEnabled ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'}`}
                          onClick={() => {
                            const next = !autoPickEnabled;
                            setAutoPickEnabled(next);
                            const authenticatedTeam = me?.claims?.team;
                            if (authenticatedTeam) {
                              try { localStorage.setItem(`evw_draft_autopick_${authenticatedTeam}`, String(next)); } catch {}
                            }
                          }}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoPickEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    </div>
                    <div className="px-3 py-1.5 text-xs text-[var(--muted)] border-b border-[var(--border)]">
                      {autoPickEnabled
                        ? <span className="font-medium text-emerald-700 dark:text-emerald-400">Top queued player submits immediately when you are on the clock.</span>
                        : <span>Standard autopick: your top queued player submits when the clock expires. If your queue is empty, the best available player is used.</span>}
                    </div>
                    {queue.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-[var(--muted)]">Queue is empty — use <span className="font-semibold text-[var(--foreground)]">Queue</span> on the Pick tab.</div>
                    ) : (
                      <ul className="divide-y divide-[var(--border)]">
                        {queue.map((q, idx) => (
                          <li key={q.id} className={`flex items-start gap-2 px-3 py-2 ${idx === 0 && autoPickEnabled ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
                            {queueEditIdx === idx ? (
                              <input
                                type="number"
                                min={1}
                                max={queue.length}
                                value={queueEditVal}
                                autoFocus
                                className="w-7 font-bold tabular-nums text-center border border-[var(--border)] rounded bg-[var(--background)] text-[var(--foreground)] shrink-0 pt-0.5"
                                style={{ fontSize: '16px', touchAction: 'manipulation' }}
                                onChange={(e) => setQueueEditVal(e.target.value)}
                                onBlur={() => { const n = parseInt(queueEditVal, 10); if (!isNaN(n) && n >= 1 && n <= queue.length) moveToQueuePosition(q.id, n); setQueueEditIdx(null); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(queueEditVal, 10); if (!isNaN(n) && n >= 1 && n <= queue.length) moveToQueuePosition(q.id, n); setQueueEditIdx(null); } else if (e.key === 'Escape') setQueueEditIdx(null); }}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span
                                className="text-xs font-bold text-[var(--muted)] w-4 shrink-0 tabular-nums pt-0.5 cursor-text"
                                title="Click to jump to position"
                                onClick={() => { setQueueEditIdx(idx); setQueueEditVal(String(idx + 1)); }}
                              >
                                {idx + 1}
                              </span>
                            )}
                            <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded text-white mt-0.5" style={{ background: POS_COLORS[q.pos] || '#555', minWidth: '30px', textAlign: 'center' }}>
                              {q.pos}
                            </span>
                            <span className="flex-1 min-w-0 text-sm font-semibold text-[var(--foreground)] break-words leading-snug">{q.name}</span>
                            {idx === 0 && autoPickEnabled && <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 shrink-0 uppercase pt-0.5">AUTO</span>}
                            <div className="flex shrink-0 self-center items-center gap-1">
                              {isMyTurn && !isMyPickPending && (
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => setConfirmPlayer({ id: q.id, name: q.name, pos: q.pos, nfl: q.nfl })}
                                  className="px-2 py-1 rounded-md text-[10px] font-black uppercase text-white disabled:opacity-50"
                                  style={{
                                    background: myTeamColors
                                      ? `linear-gradient(135deg, ${myTeamColors.primary}, ${myTeamColors.secondary})`
                                      : 'linear-gradient(135deg, #be161e, #bf9944)',
                                    boxShadow: `0 0 6px ${myTeamColors?.primary || '#be161e'}44`,
                                  }}
                                >
                                  Draft
                                </button>
                              )}
                              <button type="button" disabled={idx === 0} onClick={() => moveInQueue(q.id, 'up')} className="w-6 h-6 flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-20 text-xs rounded hover:bg-zinc-200 dark:hover:bg-zinc-700">↑</button>
                              <button type="button" disabled={idx === queue.length - 1} onClick={() => moveInQueue(q.id, 'down')} className="w-6 h-6 flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-20 text-xs rounded hover:bg-zinc-200 dark:hover:bg-zinc-700">↓</button>
                              <button type="button" onClick={() => removeFromQueue(q.id)} className="w-6 h-6 flex items-center justify-center text-[var(--muted)] hover:text-red-500 text-xs rounded hover:bg-zinc-200 dark:hover:bg-zinc-700">×</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {teamPanelTab === 'roster' && (
                  <>
                    {myTeam && draft && (() => {
                      const myPicks = allPicks.filter(p => p.team === myTeam);
                      return (
                        <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--background)]">
                          <div className="px-3 py-2 text-xs font-bold text-[var(--muted)] uppercase tracking-wide border-b border-[var(--border)]">
                            My draft picks — {myTeam}
                          </div>
                          {myPicks.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-[var(--muted)]">No picks yet this draft.</div>
                          ) : (
                            <ul className="divide-y divide-[var(--border)]">
                              {myPicks.map(p => (
                                <li key={p.overall} className="flex items-start gap-2 px-3 py-2">
                                  <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded text-white mt-0.5" style={{ background: POS_COLORS[p.playerPos || ''] || '#555', minWidth: '30px', textAlign: 'center' }}>
                                    {p.playerPos || '?'}
                                  </span>
                                  <span className="flex-1 min-w-0 text-sm font-semibold text-[var(--foreground)] break-words leading-snug">{p.playerName || p.playerId}</span>
                                  <span className="text-xs text-[var(--muted)] shrink-0 pt-0.5">R{p.round}.{((p.overall - 1) % picksPerRound) + 1}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })()}
                    {myTeam && draft && (() => {
                      const myUp = allSlots.filter(s => s.team === myTeam && s.overall >= draft.curOverall);
                      return (
                        <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--background)]">
                          <div className="px-3 py-2 text-xs font-bold text-[var(--muted)] uppercase tracking-wide border-b border-[var(--border)]">
                            My upcoming picks
                          </div>
                          {myUp.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-[var(--muted)]">No more picks.</div>
                          ) : (
                            <div className="flex flex-wrap gap-2 p-3">
                              {myUp.map(u => (
                                <span key={u.overall} className="text-xs px-2.5 py-1 rounded-lg font-semibold border" style={{ color: 'var(--foreground)', borderColor: 'var(--border)', background: 'var(--background)' }}>
                                  Pick #{u.overall} · R{u.round}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {myTeam && (
                      <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--background)]">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
                          <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-wide min-w-0 break-words">Current roster — {myTeam}</span>
                          <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                            {(['ALL', 'QB', 'RB', 'WR', 'TE', 'K'] as const).map(p => (
                              <button key={p} type="button" onClick={() => setRosterPosFilter(p)}
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors"
                                style={rosterPosFilter === p
                                  ? { background: p === 'ALL' ? (myTeamColors?.primary || '#555') : (POS_COLORS[p] || '#555'), color: '#fff', borderColor: 'transparent' }
                                  : { background: 'transparent', color: 'var(--muted)', borderColor: 'var(--border)' }}
                              >{p}</button>
                            ))}
                          </div>
                        </div>
                        {rosterLoading ? (
                          <div className="px-3 py-3 text-xs text-[var(--muted)]">Loading roster…</div>
                        ) : (() => {
                          // When the API returned snapshot-based data it already includes all current
                          // players (pre-draft, drafted-this-draft, traded-in) and excludes traded-away
                          // players. Only fall back to the client-side merge for Sleeper data (no snapshot).
                          const rosterIds = new Set(teamRoster.map(p => p.id));
                          const myDraftedPlayers: RosterPlayer[] = rosterFromSnapshot ? [] : allPicks
                            .filter(p => p.team === myTeam && !rosterIds.has(p.playerId))
                            .map(p => ({ id: p.playerId, name: p.playerName || p.playerId, pos: p.playerPos || '?', nfl: p.playerNfl || '' }));
                          const fullRoster = [...teamRoster, ...myDraftedPlayers];
                          return fullRoster.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-[var(--muted)]">No roster data found.</div>
                          ) : (
                            <ul className="divide-y divide-[var(--border)]">
                              {fullRoster
                                .filter(p => rosterPosFilter === 'ALL' || p.pos === rosterPosFilter)
                                .sort((a, b) => {
                                  const order: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4 };
                                  return (order[a.pos] ?? 9) - (order[b.pos] ?? 9) || a.name.localeCompare(b.name);
                                })
                                .map(p => (
                                  <li key={p.id} className="flex items-start gap-2 px-3 py-2">
                                    <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded text-white mt-0.5" style={{ background: POS_COLORS[p.pos] || '#555', minWidth: '30px', textAlign: 'center' }}>
                                      {p.pos || '?'}
                                    </span>
                                    <span className="flex-1 min-w-0 text-sm font-semibold text-[var(--foreground)] break-words leading-snug">{p.name}</span>
                                    <span className="text-xs text-[var(--muted)] shrink-0 pt-0.5">{p.nfl}</span>
                                  </li>
                                ))}
                            </ul>
                          );
                        })()}
                      </div>
                    )}
                    {!myTeam && (
                      <div className="text-xs text-[var(--muted)] px-1 py-2">Select a team (log in or use admin view-as) to see roster and your picks.</div>
                    )}
                  </>
                )}

                {teamPanelTab === 'trade' && myTeam && draft && (
                  <div className="flex-1 flex flex-col min-h-0 -mx-1">
                    <DraftTradeCenter
                      embedded
                      myTeam={myTeam}
                      allTeams={TEAM_NAMES}
                      draftId={draft.id}
                      eventColor1={eventColor1}
                      onClose={() => setTeamPanelTab('pick')}
                    />
                  </div>
                )}

                {teamPanelTab === 'board' && (
                  <div className="flex-1 flex flex-col min-h-0">
                    <TeamProspectDraftboardCompact
                      availablePlayers={avail}
                      draftedPlayerIds={new Set(allPicks.map(p => p.playerId))}
                      onAddToQueue={(player) => {
                        if (!queue.some(q => q.id === player.id)) {
                          syncQueue([...queue, { id: player.id, name: player.name, pos: player.pos, nfl: player.nfl }]);
                        }
                      }}
                      onDraft={(player) => setConfirmPlayer({ id: player.id, name: player.name, pos: player.pos, nfl: player.nfl })}
                      canDraft={isMyTurn && !isMyPickPending}
                      queuedIds={new Set(queue.map(q => q.id))}
                      teamColors={myTeamColors}
                      teamRoster={teamRoster}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="h-4" />
        </div>
      </div>

      {/* ── Pick Confirmation Modal ── */}
      {confirmPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={() => setConfirmPlayer(null)}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#18181b' }} onClick={e => e.stopPropagation()}>
            <div
              className="px-5 py-4"
              style={{
                background: myTeamColors
                  ? `linear-gradient(90deg, ${myTeamColors.primary}, ${myTeamColors.secondary})`
                  : 'linear-gradient(90deg,#be161e,#bf9944)',
              }}
            >
              <div className="text-base font-black text-white uppercase tracking-wide">Confirm Selection</div>
            </div>
            <div className="px-5 py-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-sm font-black px-2.5 py-1 rounded text-white" style={{ background: POS_COLORS[confirmPlayer.pos] || '#555' }}>
                  {confirmPlayer.pos}
                </span>
                <div>
                  <div className="text-lg font-black text-white">{confirmPlayer.name}</div>
                  <div className="text-sm text-zinc-400">{confirmPlayer.nfl}</div>
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-5">Are you sure you want to select this player? This will be sent to the admin for approval.</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-lg text-sm font-bold border border-zinc-600 text-zinc-300 hover:bg-zinc-700 transition-colors"
                  onClick={() => setConfirmPlayer(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-lg text-sm font-black text-white transition-colors disabled:opacity-50"
                  style={{
                    background: myTeamColors
                      ? `linear-gradient(90deg, ${myTeamColors.primary}, ${myTeamColors.secondary})`
                      : 'linear-gradient(90deg,#be161e,#bf9944)',
                  }}
                  onClick={() => { submitPick(confirmPlayer); setConfirmPlayer(null); }}
                >
                  {submitting ? 'Submitting…' : 'Yes, Draft Him'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Animation overlays (pick + clock) — full-screen, mirrors admin/presentation view ── */}
      {animPhase === 'pick' && animDataRef.current && (animDataRef.current.pick.playerName || animDataRef.current.pick.playerId) && (
        <DraftPickAnimation
          key={`room-pick-${animDataRef.current.overall}`}
          player={{
            name: animDataRef.current.pick.playerName || animDataRef.current.pick.playerId || 'Unknown',
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
          eventLogoUrl={draft?.eventLogoUrl}
          eventColor1={eventColor1}
          onComplete={() => setAnimPhase('clock')}
        />
      )}
      {/* Trade animation — mirrors broadcast overlay */}
      {tradeAnimData && (
        <DraftTradeAnimation
          key={`room-trade-${tradeAnimSeenIdRef.current}`}
          teams={tradeAnimData.teams}
          assets={tradeAnimData.assets}
          eventLogoUrl={draft?.eventLogoUrl}
          eventColor1={draft?.eventColor1}
          picksPerRound={picksPerRound}
          onComplete={() => {
            const captured = tradeAnimData;
            setTradeAnimData(null);
            // Resume draft clock if it was paused for this animation
            if (captured?.resumeAfterAnimation && draft?.id) {
              fetch('/api/draft', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'trade_anim_complete', id: draft.id }),
              }).catch(() => {});
            }
            // Trigger "Now on the Clock" animation if the on-clock team changed due to a traded pick
            const currentClockTeam = draft?.onClockTeam ?? null;
            if (currentClockTeam && currentClockTeam !== preTradeClockTeamRef.current) {
              const curOv = draft?.curOverall ?? 1;
              const ppr = draftPicksPerRound(draft);
              animDataRef.current = {
                pick: { overall: curOv, team: currentClockTeam, playerId: '', playerName: null, playerPos: null, round: Math.ceil(curOv / ppr), pickInRound: ((curOv - 1) % ppr) + 1, madeAt: '' } as unknown as DraftPick,
                nextTeamName: currentClockTeam,
                overall: curOv - 1,
                round: Math.ceil(curOv / ppr),
                pickInRound: ((curOv - 1) % ppr) + 1,
                videoUrl: null,
                imageUrl: null,
              };
              setAnimPhase('clock');
            }
            // Clear animation flag from DB
            if (draft?.id) {
              fetch('/api/draft/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'clear_trade_animation', draftId: draft.id }),
              }).catch(() => {});
            }
          }}
        />
      )}

      {/* ── End-of-round animation (plays 10s after last pick anim, before recap) ── */}
      {endRoundAnimState === 'playing' && draft && (
        <EndOfRoundAnimation
          key={`eor-${completedRound}`}
          roundNumber={completedRound}
          eventLogoUrl={eventLogoUrl}
          eventColor1={eventColor1}
          onComplete={() => setEndRoundAnimState('done')}
        />
      )}

      {/* ── Start-of-round animation (plays when round resumes) ── */}
      {startRoundAnimPlaying && draft && (
        <StartOfRoundAnimation
          key={`sor-${startRoundAnimNumberRef.current}`}
          roundNumber={startRoundAnimNumberRef.current}
          eventLogoUrl={eventLogoUrl}
          eventColor1={eventColor1}
          onComplete={() => {
            setStartRoundAnimPlaying(false);
            // If this was triggered by the admin clicking "Start Round", fire the resume now
            if (startAnimFiredThisRoundRef.current) {
              fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) }).catch(() => {});
            }
          }}
        />
      )}

      {/* Trade offer notification popup — stays visible until explicitly dismissed or Trade tab opened */}
      {tradeNotif && teamPanelTab !== 'trade' && (
        <div
          className="fixed bottom-6 right-6 z-[9999] w-80 rounded-xl border-2 bg-zinc-900 shadow-2xl p-4 cursor-pointer animate-pulse"
          style={{
            borderColor: '#ef4444',
            boxShadow: '0 0 32px #ef444488, 0 0 0 4px #ef444422',
            animation: 'pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
          }}
          onClick={() => { setTradeNotif(false); setTeamPanelTab('trade'); }}
        >
          <div className="font-black text-base uppercase tracking-widest mb-1.5" style={{ color: '#ef4444' }}>🚨 Incoming Trade Offer!</div>
          <div className="text-white text-sm font-semibold mb-1">
            You have {tradeInboxCount} pending trade offer{tradeInboxCount !== 1 ? 's' : ''}.
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-zinc-400">Tap here to open Trade Center →</span>
            <button
              onClick={e => { e.stopPropagation(); setTradeNotif(false); }}
              className="text-zinc-500 hover:text-white text-lg w-6 h-6 flex items-center justify-center rounded-full hover:bg-zinc-700 ml-2"
            >×</button>
          </div>
        </div>
      )}

    </div>
  );
}
