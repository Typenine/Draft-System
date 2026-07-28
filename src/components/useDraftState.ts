'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DraftState } from '@/lib/types';

const emptyState: DraftState = {
  configured: false,
  draft: null,
  teams: [],
  players: [],
  slots: [],
  picks: [],
  currentTeam: null,
  availablePlayers: [],
};

export function useDraftState(intervalMs = 1500) {
  const [state, setState] = useState<DraftState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      const data = await response.json();
      setState(data as DraftState);
      setError(response.ok ? null : String(data.error || 'Unable to load draft state.'));
    } catch {
      setError('Unable to reach the draft server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!intervalMs) return;
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, refresh]);

  return { state, loading, error, refresh };
}
