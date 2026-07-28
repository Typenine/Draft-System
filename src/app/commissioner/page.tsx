'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimationTestingPanel } from '@/components/admin/AnimationTestingPanel';
import { AppHeader } from '@/components/AppHeader';
import { Clock } from '@/components/Clock';
import { DraftBoard } from '@/components/DraftBoard';
import { TeamMark } from '@/components/TeamMark';
import { useDraftState } from '@/components/useDraftState';
import DraftOverlayLive from '@/components/draft-overlay/DraftOverlayLive';
import { ClockDurationInput } from '@/components/setup/ClockDurationInput';
import type { TradeAsset } from '@/lib/types';

function assetLabel(asset: TradeAsset): string {
  if (asset.assetType === 'player') return `${asset.playerName || asset.playerId || 'Player'} (${asset.fromTeam} → ${asset.toTeam})`;
  if (asset.assetType === 'current_pick') return `Pick #${asset.pickOverall || '?'} (${asset.fromTeam} → ${asset.toTeam})`;
  return `${asset.pickYear || '?'} Round ${asset.pickRound || '?'} (${asset.fromTeam} → ${asset.toTeam})`;
}

export default function CommissionerPage() {
  const { state, loading, error, refresh } = useDraftState(1200);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [forcePlayer, setForcePlayer] = useState('');
  const [clockSeconds, setClockSeconds] = useState(120);
  const [newDraftName, setNewDraftName] = useState('');

  useEffect(() => {
    void fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      const ok = response.ok && data.role === 'admin';
      setAuthorized(ok);
      if (!ok) window.location.href = '/admin';
    });
  }, []);

  useEffect(() => {
    if (state.draft) setClockSeconds(state.draft.clockSeconds);
  }, [state.draft?.clockSeconds]);

  const upcoming = useMemo(() => state.slots.filter((slot) => slot.overall >= (state.draft?.currentOverall || 1)).slice(0, 24), [state.draft?.currentOverall, state.slots]);
  const moderationCount = (state.pendingPick ? 1 : 0) + (state.pendingTrades?.length || 0);

  async function action(actionName: string, extra: Record<string, unknown> = {}) {
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionName, ...extra }),
      });
      const data = await response.json();
      setMessage(response.ok ? 'Saved.' : String(data.error || 'Action failed.').replaceAll('_', ' '));
      await refresh();
    } finally {
      setWorking(false);
    }
  }

  if (loading || authorized === null) return <main className="center-screen"><div className="loader" />Loading commissioner controls…</main>;
  if (!authorized) return null;

  return (
    <main className="app-page commissioner-page">
      <AppHeader state={state} showLogout />

      <section className="commissioner-stage">
        <div className="commissioner-stage-heading">
          <div className="commissioner-brand-heading">
            {state.branding?.logoUrl && <img className="commissioner-event-logo" src={state.branding.logoUrl} alt={`${state.leagueName || 'Draft'} logo`} />}
            <div>
              <span className="eyebrow">Commissioner draft room</span>
              <h1>{state.draft?.name || 'Draft'}</h1>
              <p>The live broadcast board and animations remain the primary workspace.</p>
            </div>
          </div>
          <div className="commissioner-stage-actions">
            <span className={`status-pill status-${state.draft?.status.toLowerCase()}`}>{state.draft?.status.replace('_', ' ')}</span>
            <Clock deadline={state.draft?.deadlineTs || null} status={state.draft?.status} fallback={state.draft?.clockSeconds || 0} />
            <a className="button" href="/commissioner/settings">Edit full setup</a>
            <a className="button" href="/draft/overlay" target="_blank" rel="noreferrer">Open full-screen broadcast</a>
            <a className="button" href="/draft/room/team?commissionerTest=1" target="_blank" rel="noreferrer">Open team-view tester</a>
          </div>
        </div>
        <div className="commissioner-overlay-frame">
          <DraftOverlayLive />
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <section className="panel moderation-panel">
        <div className="section-title">
          <div><span className="eyebrow">Commissioner review</span><h2>Pending approvals {moderationCount ? `(${moderationCount})` : ''}</h2></div>
          <small>Nothing becomes final or triggers an animation until it is approved here.</small>
        </div>
        {!state.pendingPick && !(state.pendingTrades?.length) && <div className="empty moderation-empty">No picks or trades are waiting for review.</div>}
        <div className="moderation-grid">
          {state.pendingPick && (
            <article className="moderation-card pending-pick-card">
              <div className="moderation-card-heading"><span className="status-pill">PICK</span><strong>Pick #{state.pendingPick.overall}</strong></div>
              <h3>{state.pendingPick.playerName}</h3>
              <p>{state.pendingPick.playerPosition}{state.pendingPick.playerProTeam ? ` · ${state.pendingPick.playerProTeam}` : ''}</p>
              <p className="muted">Submitted by {state.pendingPick.teamName}</p>
              <div className="moderation-actions">
                <button className="button success" disabled={working} onClick={() => action('approve_pick')}>Approve and play animation</button>
                <button className="button danger" disabled={working} onClick={() => action('reject_pick')}>Reject pick</button>
              </div>
            </article>
          )}
          {(state.pendingTrades || []).map((trade) => {
            const fullyAccepted = trade.status === 'accepted';
            return (
              <article className="moderation-card" key={trade.id}>
                <div className="moderation-card-heading"><span className={`status-pill status-${trade.status}`}>TRADE</span><strong>{fullyAccepted ? 'Ready for commissioner' : 'Awaiting teams'}</strong></div>
                <h3>{trade.teams.join(' ↔ ')}</h3>
                <p className="muted">Accepted: {trade.acceptedBy.length}/{trade.teams.length}</p>
                <ul className="moderation-assets">{trade.assets.map((asset) => <li key={asset.id}>{assetLabel(asset)}</li>)}</ul>
                {trade.notes && <p className="muted">“{trade.notes}”</p>}
                <div className="moderation-actions">
                  <button className="button success" disabled={working || !fullyAccepted} onClick={() => action('approve_trade', { tradeId: trade.id })}>Approve, execute, and animate</button>
                  <button className="button danger" disabled={working} onClick={() => action('reject_trade', { tradeId: trade.id })}>Reject trade</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="admin-grid">
        <div className="panel control-panel">
          <h2>Draft controls</h2>
          <div className="button-grid">
            <button className="button success" disabled={working || state.draft?.status === 'LIVE' || Boolean(state.pendingPick)} onClick={() => action(state.draft?.status === 'PAUSED' ? 'resume' : 'start')}>{state.draft?.status === 'PAUSED' ? 'Resume draft' : 'Start draft'}</button>
            <button className="button" disabled={working || state.draft?.status !== 'LIVE'} onClick={() => action('pause')}>Pause</button>
            <button className="button" disabled={working} onClick={() => action('undo')}>Undo last pick</button>
            <button className="button" disabled={working || Boolean(state.pendingPick)} onClick={() => action('skip')}>Skip current slot</button>
            <button className="button danger" disabled={working} onClick={() => { if (window.confirm('Reset all picks and queues for this draft?')) void action('reset'); }}>Reset draft</button>
          </div>
          <div className="on-clock-card">
            {state.currentTeam ? <><TeamMark team={state.currentTeam} /><div><small>On the clock</small><strong>{state.currentTeam.name}</strong><span>Pick {state.draft?.currentOverall}</span></div></> : <span>No team is on the clock.</span>}
          </div>
        </div>

        <div className="panel control-panel">
          <h2>Clock and force pick</h2>
          <div className="clock-control-row"><ClockDurationInput value={clockSeconds} onChange={setClockSeconds} disabled={working} /><button className="button" disabled={working} onClick={() => action('set_clock', { clockSeconds })}>Save clock</button></div>
          <label>Available player<select value={forcePlayer} onChange={(event) => setForcePlayer(event.target.value)}><option value="">Select player</option>{state.availablePlayers.map((player) => <option key={player.id} value={player.id}>{player.rank}. {player.name} · {player.position}</option>)}</select></label>
          <button className="button warning" disabled={working || !forcePlayer || Boolean(state.pendingPick)} onClick={() => action('force_pick', { playerId: forcePlayer })}>Force pick for current team</button>
        </div>

        <div className="panel control-panel">
          <h2>Create another draft</h2>
          <p className="muted">The current draft remains in Archives. Team settings, the 28-round format, player pool, and selected linear or snake base order carry forward.</p>
          <label>Draft name<input value={newDraftName} onChange={(event) => setNewDraftName(event.target.value)} placeholder={`Draft ${new Date().getFullYear() + 1}`} /></label>
          <button className="button primary" disabled={working} onClick={() => action('create', { name: newDraftName || `Draft ${new Date().getFullYear() + 1}` })}>Create next draft</button>
        </div>
      </section>

      <AnimationTestingPanel state={state} />

      <section className="panel section-panel">
        <div className="section-title"><div><span className="eyebrow">Quick pick ownership</span><h2>Next 24 selections</h2></div><small>Use Full Setup for linear, snake, or all 336 picks.</small></div>
        <div className="slot-grid">
          {upcoming.map((slot) => {
            const team = state.teams.find((item) => item.id === slot.teamId);
            const locked = state.picks.some((pick) => pick.overall === slot.overall);
            return <label className="slot-editor" key={slot.overall}><span>{slot.round}.{slot.pickInRound.toString().padStart(2, '0')}</span><select value={slot.teamId} disabled={working || locked} onChange={(event) => action('set_slot', { overall: slot.overall, teamId: event.target.value })}>{state.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{team && <i style={{ background: team.primaryColor }} />}</label>;
          })}
        </div>
      </section>

      <section className="panel section-panel board-section">
        <div className="section-title"><div><span className="eyebrow">Complete draft</span><h2>All 28 rounds</h2></div></div>
        <DraftBoard state={state} />
      </section>
    </main>
  );
}
