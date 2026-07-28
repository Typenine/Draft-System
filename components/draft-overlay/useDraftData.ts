'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TEAM_NAMES } from '@/lib/constants/league';
import { getTeamColors } from '@/lib/constants/team-colors';
import { getTeamLogoPath } from '@/lib/utils/team-utils';

// Team interface for overlay
interface Team {
  name: string;
  abbrev: string;
  colors: [string, string, string | null];
}

// Types matching the website's API response
interface DraftPick {
  overall: number;
  round: number;
  team: string;
  playerId: string;
  playerName?: string | null;
  playerPos?: string | null;
  playerNfl?: string | null;
  madeAt: string;
}

interface UpcomingPick {
  overall: number;
  round: number;
  team: string;
}

interface DraftOverview {
  id: string;
  year: number;
  rounds: number;
  clockSeconds: number;
  status: 'NOT_STARTED' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  curOverall: number;
  onClockTeam?: string | null;
  clockStartedAt?: string | null;
  deadlineTs?: string | null;
  pausedRemainingSecs?: number | null;
  eventName?: string | null;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  eventColor2?: string | null;
  pendingTradeAnimation?: { tradeId?: string | null; startedAt?: string | null; teams: string[]; assets: Array<{ fromTeam: string; toTeam: string; assetType: string; playerName?: string | null; playerPos?: string | null; pickOverall?: number | null; pickYear?: number | null; pickRound?: number | null; pickOriginalTeam?: string | null }>; resumeAfterAnimation?: boolean; triggerPickAnimation?: boolean; newClockTeam?: string | null } | null;
  roundEndPause?: boolean | null;
  recentPicks: DraftPick[];
  allPicks?: DraftPick[];
  upcoming: UpcomingPick[];
  allSlots?: Array<{ overall: number; round: number; team: string }>;
}

interface DraftLiveState {
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
  pausedRemainingSecs?: number | null;
  pendingTradeAnimation?: DraftOverview['pendingTradeAnimation'];
  roundEndPause?: boolean | null;
}

interface AvailablePlayer {
  id: string;
  name: string;
  pos: string;
  nfl: string;
}

// Adapted state for overlay components
export interface OverlayState {
  draft: DraftOverview | null;
  remainingSec: number | null;
  available: AvailablePlayer[];
  usingCustom: boolean;
  // Computed values for overlay
  currentTeam: Team | null;
  currentPickIndex: number;
  timerSeconds: number;
  draftOrder: string[]; // Team names in pick order
  draftGrid: Array<{ player: string | null; position: string | null; team: string }>;
  nextTeams: Array<Team & { logoPath: string | null }>;
  lastPick: DraftPick | null;
  isNewPick: boolean;
  pendingPick: { id: string; overall: number; team: string; playerId: string; playerName: string | null; playerPos: string | null; playerNfl: string | null; } | null;
  pendingTradeAnimation: DraftOverview['pendingTradeAnimation'];
  activeViewers: string[]; // Teams currently viewing the draft room
}

export function useDraftData(basePollIntervalMs = 1000) {
  const [state, setState] = useState<OverlayState>({
    draft: null,
    remainingSec: null,
    available: [],
    usingCustom: false,
    currentTeam: null,
    currentPickIndex: 0,
    timerSeconds: 0,
    draftOrder: [],
    draftGrid: Array(48).fill({ player: null, position: null, team: '' }),
    nextTeams: [],
    lastPick: null,
    isNewPick: false,
    pendingPick: null,
    pendingTradeAnimation: null,
    activeViewers: [],
  });

  const lastOverallRef = useRef<number | null>(null);
  const lastUpdateMsRef = useRef<number>(Date.now());
  const [pollInterval, setPollInterval] = useState(basePollIntervalMs);
  const revisionRef = useRef<string | null>(null);
  const liveFetchSeqRef = useRef(0);
  const fullFetchSeqRef = useRef(0);

  const syncPollInterval = useCallback((status: DraftOverview['status'] | undefined) => {
    const next =
      status === 'LIVE' ? 1000 :
      status === 'PAUSED' || status === 'NOT_STARTED' ? 5000 :
      status === 'COMPLETED' ? 10000 :
      3000;
    setPollInterval(next);
  }, []);

  const hydrateFromFull = useCallback((json: {
    draft: DraftOverview | null;
    remainingSec: number | null;
    pendingPick?: OverlayState['pendingPick'];
    available?: AvailablePlayer[];
    usingCustom?: boolean;
    revision?: string;
    activeViewers?: string[];
  }) => {
    const draft = json.draft as DraftOverview | null;
    const remainingSec = json.remainingSec as number | null;
    const pendingPick = (json.pendingPick ?? null) as OverlayState['pendingPick'];

    if (json.revision) revisionRef.current = json.revision;

    // Compute derived values for overlay
    const onClockTeamName = draft?.onClockTeam || null;
    const currentTeam = onClockTeamName ? getTeamFromName(onClockTeamName) : null;
    const currentPickIndex = draft ? draft.curOverall - 1 : 0;
    const timerSeconds = remainingSec ?? 0;

    const draftOrder: string[] = [];
    if (draft?.upcoming) {
      for (const u of draft.upcoming) draftOrder.push(u.team);
    }

    const slotTeamMap: Record<number, string> = {};
    if (draft?.allSlots) {
      for (const s of draft.allSlots) slotTeamMap[s.overall - 1] = s.team;
    } else if (draft?.upcoming) {
      for (const u of draft.upcoming) slotTeamMap[u.overall - 1] = u.team;
    }

    const draftGrid: Array<{ player: string | null; position: string | null; team: string }> = [];
    const picksToUse = draft?.allPicks ?? draft?.recentPicks ?? [];
    for (let i = 0; i < 48; i++) {
      const pick = picksToUse.find(p => p.overall - 1 === i);
      const teamName = pick?.team || slotTeamMap[i] || '';
      draftGrid[i] = {
        player: pick ? (pick.playerName || pick.playerId) : null,
        position: pick ? (pick.playerPos || 'N/A') : null,
        team: teamName,
      };
    }

    const lastPick = draft?.recentPicks?.length ? draft.recentPicks[draft.recentPicks.length - 1] : null;
    const nextTeams: Array<Team & { logoPath: string | null }> = [];
    if (draft?.upcoming) {
      const upcomingFiltered = lastPick ? draft.upcoming.filter(u => u.overall > lastPick.overall) : draft.upcoming;
      for (const u of upcomingFiltered.slice(0, 2)) {
        const team = getTeamFromName(u.team);
        if (team) nextTeams.push({ ...team, logoPath: getTeamLogoPath(u.team) });
      }
    }

    let isNewPick = false;
    if (lastPick) {
      if (lastOverallRef.current === null) {
        lastOverallRef.current = lastPick.overall;
        isNewPick = false;
      } else if (lastPick.overall !== lastOverallRef.current) {
        lastOverallRef.current = lastPick.overall;
        isNewPick = true;
      }
    }

    if (draft?.status === 'LIVE') {
      lastUpdateMsRef.current = Date.now();
    }
    syncPollInterval(draft?.status);

    setState((prev) => ({
      ...prev,
      draft,
      remainingSec,
      ...(Array.isArray(json.available) ? { available: json.available } : {}),
      ...(typeof json.usingCustom === 'boolean' ? { usingCustom: json.usingCustom } : {}),
      ...(Array.isArray(json.activeViewers) ? { activeViewers: json.activeViewers } : {}),
      currentTeam,
      currentPickIndex,
      timerSeconds,
      draftOrder,
      draftGrid,
      nextTeams,
      lastPick,
      isNewPick,
      pendingPick,
      pendingTradeAnimation: draft?.pendingTradeAnimation ?? null,
    }));
  }, [syncPollInterval]);

  const fetchFullDraft = useCallback(async (includeAvailable = false) => {
    const seq = ++fullFetchSeqRef.current;
    try {
      const res = await fetch(includeAvailable ? '/api/draft?include=available' : '/api/draft', { cache: 'no-store' });
      if (!res.ok || seq !== fullFetchSeqRef.current) return;
      const json = await res.json();
      hydrateFromFull({
        draft: (json.draft ?? null) as DraftOverview | null,
        remainingSec: (json.remainingSec ?? null) as number | null,
        pendingPick: (json.pendingPick ?? null) as OverlayState['pendingPick'],
        available: includeAvailable ? ((json.available || []) as AvailablePlayer[]) : undefined,
        usingCustom: includeAvailable ? Boolean(json.usingCustom) : undefined,
        revision: typeof json.revision === 'string' ? json.revision : undefined,
        activeViewers: Array.isArray(json.activeViewers) ? json.activeViewers : undefined,
      });
    } catch (err) {
      console.error('[useDraftData] fetch error:', err);
    }
  }, [hydrateFromFull]);

  const fetchAvailable = useCallback(async () => {
    try {
      const res = await fetch('/api/draft?include=available', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setState((prev) => ({
        ...prev,
        available: (json.available || []) as AvailablePlayer[],
        usingCustom: Boolean(json.usingCustom),
      }));
    } catch (err) {
      console.error('[useDraftData] available fetch error:', err);
    }
  }, []);

  // Use ref for poll interval to avoid effect restarts when interval changes
  const pollIntervalRef = useRef(pollInterval);
  pollIntervalRef.current = pollInterval;

  const fetchLive = useCallback(async () => {
    const seq = ++liveFetchSeqRef.current;
    try {
      const res = await fetch('/api/draft?mode=live', { cache: 'no-store' });
      if (!res.ok || seq !== liveFetchSeqRef.current) return;
      const json = await res.json();
      const live = (json.live ?? null) as DraftLiveState | null;
      const remainingSec = (json.remainingSec ?? null) as number | null;
      const pendingPick = (json.pendingPick ?? null) as OverlayState['pendingPick'];
      const revision = typeof json.revision === 'string' ? json.revision : null;

      if (!live) {
        if (seq !== liveFetchSeqRef.current) return;
        setState((prev) => ({ ...prev, draft: null, remainingSec: null, pendingPick: null }));
        return;
      }

      // Drop stale in-flight responses (e.g. LIVE payload arriving after a newer PAUSED poll).
      if (seq !== liveFetchSeqRef.current) return;
      setState((prev) => ({
        ...prev,
        draft: prev.draft ? { ...prev.draft, ...live } : ({ ...live, recentPicks: [], upcoming: [], allPicks: [], allSlots: [] } as DraftOverview),
        remainingSec,
        pendingPick,
        pendingTradeAnimation: live.pendingTradeAnimation ?? null,
      }));

      if (live.status === 'LIVE') {
        lastUpdateMsRef.current = Date.now();
      }
      syncPollInterval(live.status);

      if (revision && revision !== revisionRef.current) {
        revisionRef.current = revision;
        await fetchFullDraft(false);
        await fetchAvailable();
      }
    } catch (err) {
      console.error('[useDraftData] live fetch error:', err);
    }
  }, [fetchAvailable, fetchFullDraft, syncPollInterval]);

  // Initial load: hydrate full state once.
  useEffect(() => {
    void fetchFullDraft(true);
  }, [fetchFullDraft]);

  // Presence heartbeat — send every 10s to indicate viewer is active
  useEffect(() => {
    const sendHeartbeat = () => {
      fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'presence', team: 'Overlay' }),
      })
        .then(r => r.json())
        .then(j => {
          if (Array.isArray(j?.activeViewers)) {
            setState(prev => ({ ...prev, activeViewers: j.activeViewers as string[] }));
          }
        })
        .catch(() => {});
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 10000);
    return () => clearInterval(interval);
  }, []);

  // Polling loop, visibility-aware.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;
    const jitter = () => Math.floor(Math.random() * 450);

    const startPolling = () => {
      const intervalMs = (document.hidden ? 10000 : pollIntervalRef.current) + jitter();
      intervalId = setInterval(() => {
        void fetchLive();
        clearInterval(intervalId);
        startPolling();
      }, intervalMs);
    };

    startPolling();
    const onVis = () => {
      clearInterval(intervalId);
      void fetchLive();
      if (!document.hidden) void fetchAvailable();
      startPolling();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchLive, fetchAvailable]);

  // Refresh available list when a new pick is detected (the only time it materially changes).
  useEffect(() => {
    if (!state.lastPick?.overall) return;
    void fetchAvailable();
  }, [state.lastPick?.overall, fetchAvailable]);

  // Local countdown timer — only tick while LIVE (paused clocks must stay frozen)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (state.draft?.status !== 'LIVE') return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [state.draft?.status]);

  const isLive = state.draft?.status === 'LIVE';
  const pausedFrozenSec = state.draft?.pausedRemainingSecs ?? state.remainingSec;
  const elapsedSinceUpdate = isLive
    ? Math.floor((Date.now() - lastUpdateMsRef.current) / 1000)
    : 0;
  const localRemainingSec = isLive
    ? Math.max(0, (state.remainingSec ?? 0) - elapsedSinceUpdate)
    : Math.max(0, pausedFrozenSec ?? 0);

  return {
    ...state,
    localRemainingSec,
    refetch: fetchFullDraft,
  };
}

// Helper to convert team name to Team object with colors
function getTeamFromName(name: string): Team | null {
  if (!TEAM_NAMES.includes(name)) return null;
  const colors = getTeamColors(name);
  // Generate simple abbreviation from team name
  const abbrev = name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return {
    name,
    abbrev,
    colors: [colors.primary, colors.secondary, colors.tertiary || null],
  };
}
