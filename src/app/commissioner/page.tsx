'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { Clock } from '@/components/Clock';
import { DraftBoard } from '@/components/DraftBoard';
import { TeamMark } from '@/components/TeamMark';
import { useDraftState } from '@/components/useDraftState';
import DraftOverlayLive from '@/components/draft-overlay/DraftOverlayLive';
import type { SetupPlayerInput } from '@/lib/types';

function parsePlayers(value: string): SetupPlayerInput[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [rank, name, position, proTeam, college, id] = line.split(',').map((part) => part.trim());
    return { id: id || undefined, rank: Number(rank) || index + 1, name, position, proTeam: proTeam || null, college: college || null };
  });
}

export default function CommissionerPage() {
  const { state, loading, error, refresh } = useDraftState(1200);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [forcePlayer, setForcePlayer] = useState('');
  const [clockSeconds, setClockSeconds] = useState(120);
  const [newDraftName, setNewDraftName] = useState('');
  const [playerCsv, setPlayerCsv] = useState('');

  useEffect(() => {
    void fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      const ok = response.ok && data.role === 'admin';
      setAuthorized(ok);
      if (!ok) window.location.href = '/';
    });
  }, []);

  useEffect(() => {
    if (state.draft) setClockSeconds(state.draft.clockSeconds);
  }, [state.draft?.clockSeconds]);

  const upcoming = useMemo(() => state.slots.filter((slot) => slot.overall >= (state.draft?.currentOverall || 1)).slice(0, 24), [state.draft?.currentOverall, state.slots]);

  async function action(actionName: string, extra: Record<string, unknown> = {}) {
    setWorking(true);
    setMessage(null);
    const response = await fetch('/api/admin/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...extra }),
    });
    const data = await response.json();
    setMessage(response.ok ? 'Saved.' : String(data.error || 'Action failed.'));
    await refresh();
    setWorking(false);
  }

  async function replacePlayers(event: FormEvent) {
    event.preventDefault();
    await action('replace_players', { players: parsePlayers(playerCsv) });
  }

  if (loading || authorized === null) return <main className="center-screen"><div className="loader" />Loading commissioner controls…</main>;
  if (!authorized) return null;

  return (
    <main className="app-page commissioner-page">
      <AppHeader state={state} showLogout />

      <section className="commissioner-stage">
        <div className="commissioner-stage-heading">
          <div>
            <span className="eyebrow">Commissioner draft room</span>
            <h1>{state.draft?.name || 'Draft'}</h1>
            <p>The broadcast board and animations are the primary workspace. Controls remain directly below it.</p>
          </div>
          <div className="commissioner-stage-actions">
            <span className={`status-pill status-${state.draft?.status.toLowerCase()}`}>{state.draft?.status.replace('_', ' ')}</span>
            <Clock deadline={state.draft?.deadlineTs || null} status={state.draft?.status} fallback={state.draft?.clockSeconds || 0} />
            <a className="button" href="/draft/overlay" target="_blank" rel="noreferrer">Open full-screen broadcast</a>
          </div>
        </div>
        <div className="commissioner-overlay-frame">
          <DraftOverlayLive />
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <section className="admin-grid">
        <div className="panel control-panel">
          <h2>Draft controls</h2>
          <div className="button-grid">
            <button className="button success" disabled={working || state.draft?.status === 'LIVE'} onClick={() => action(state.draft?.status === 'PAUSED' ? 'resume' : 'start')}>{state.draft?.status === 'PAUSED' ? 'Resume draft' : 'Start draft'}</button>
            <button className="button" disabled={working || state.draft?.status !== 'LIVE'} onClick={() => action('pause')}>Pause</button>
            <button className="button" disabled={working} onClick={() => action('undo')}>Undo last pick</button>
            <button className="button" disabled={working} onClick={() => action('skip')}>Skip current slot</button>
            <button className="button danger" disabled={working} onClick={() => { if (window.confirm('Reset all picks and queues for this draft?')) void action('reset'); }}>Reset draft</button>
          </div>
          <div className="on-clock-card">
            {state.currentTeam ? <><TeamMark team={state.currentTeam} /><div><small>On the clock</small><strong>{state.currentTeam.name}</strong><span>Pick {state.draft?.currentOverall}</span></div></> : <span>No team is on the clock.</span>}
          </div>
        </div>

        <div className="panel control-panel">
          <h2>Clock and force pick</h2>
          <label>Clock length in seconds<div className="input-row"><input type="number" min="10" value={clockSeconds} onChange={(e) => setClockSeconds(Number(e.target.value))} /><button className="button" disabled={working} onClick={() => action('set_clock', { clockSeconds })}>Save</button></div></label>
          <label>Available player<select value={forcePlayer} onChange={(e) => setForcePlayer(e.target.value)}><option value="">Select player</option>{state.availablePlayers.map((player) => <option key={player.id} value={player.id}>{player.rank}. {player.name} · {player.position}</option>)}</select></label>
          <button className="button warning" disabled={working || !forcePlayer} onClick={() => action('force_pick', { playerId: forcePlayer })}>Force pick for current team</button>
        </div>

        <div className="panel control-panel">
          <h2>Create another draft</h2>
          <p className="muted">The current draft remains available in Archives. The 12 teams, 28-round format, and player pool carry forward.</p>
          <label>Draft name<input value={newDraftName} onChange={(e) => setNewDraftName(e.target.value)} placeholder={`Draft ${new Date().getFullYear() + 1}`} /></label>
          <div className="input-row">
            <button className="button primary" disabled={working} onClick={() => action('create', { name: newDraftName || `Draft ${new Date().getFullYear() + 1}` })}>Create draft</button>
            <button className="button" disabled={working} onClick={() => action('create', { name: `Rehearsal ${new Date().toLocaleDateString()}` })}>Create rehearsal</button>
          </div>
        </div>
      </section>

      <section className="panel section-panel">
        <div className="section-title"><div><span className="eyebrow">Pick ownership</span><h2>Upcoming draft order</h2></div><small>Change a slot to record a traded pick.</small></div>
        <div className="slot-grid">
          {upcoming.map((slot) => {
            const team = state.teams.find((item) => item.id === slot.teamId);
            return <label className="slot-editor" key={slot.overall}><span>{slot.round}.{slot.pickInRound.toString().padStart(2, '0')}</span><select value={slot.teamId} disabled={working} onChange={(e) => action('set_slot', { overall: slot.overall, teamId: e.target.value })}>{state.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{team && <i style={{ background: team.primaryColor }} />}</label>;
          })}
        </div>
      </section>

      <section className="panel section-panel">
        <div className="section-title"><div><span className="eyebrow">Player pool</span><h2>Replace draft class</h2></div><small>Only available before the first pick.</small></div>
        <form onSubmit={replacePlayers}>
          <textarea rows={8} value={playerCsv} onChange={(e) => setPlayerCsv(e.target.value)} placeholder="Rank, Name, Position, Pro Team, College, optional ID" />
          <button className="button" disabled={working || !playerCsv.trim()}>Replace player pool</button>
        </form>
      </section>

      <section className="panel section-panel board-section">
        <div className="section-title"><div><span className="eyebrow">Complete draft</span><h2>All 28 rounds</h2></div></div>
        <DraftBoard state={state} />
      </section>
    </main>
  );
}
