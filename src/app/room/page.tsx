'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { Clock } from '@/components/Clock';
import { DraftBoard } from '@/components/DraftBoard';
import { TeamMark } from '@/components/TeamMark';
import { useDraftState } from '@/components/useDraftState';
import type { Player, Team } from '@/lib/types';

export default function TeamRoomPage() {
  const { state, loading, error, refresh } = useDraftState(1000);
  const [team, setTeam] = useState<Team | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<Player[]>([]);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('ALL');
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      const ok = response.ok && data.role === 'team' && data.team;
      setAuthorized(Boolean(ok));
      if (ok) setTeam(data.team as Team);
      else window.location.href = '/';
    });
  }, []);

  async function loadQueue() {
    const response = await fetch('/api/team/queue', { cache: 'no-store' });
    if (response.ok) setQueue((await response.json()).queue as Player[]);
  }

  useEffect(() => {
    if (authorized) void loadQueue();
  }, [authorized, state.picks.length]);

  const positions = useMemo(() => ['ALL', ...Array.from(new Set(state.availablePlayers.map((player) => player.position))).sort()], [state.availablePlayers]);
  const filtered = useMemo(() => state.availablePlayers.filter((player) => {
    const matchesPosition = position === 'ALL' || player.position === position;
    const haystack = `${player.name} ${player.position} ${player.proTeam || ''} ${player.college || ''}`.toLowerCase();
    return matchesPosition && haystack.includes(search.toLowerCase());
  }), [position, search, state.availablePlayers]);
  const onClock = Boolean(team && state.currentTeam?.id === team.id && state.draft?.status === 'LIVE');

  async function saveQueue(next: Player[]) {
    setQueue(next);
    await fetch('/api/team/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerIds: next.map((player) => player.id) }) });
  }

  async function submitPick() {
    if (!selected) return;
    setWorking(true);
    setMessage(null);
    const response = await fetch('/api/team/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: selected }) });
    const data = await response.json();
    setMessage(response.ok ? 'Pick submitted.' : String(data.error || 'Pick failed.'));
    if (response.ok) setSelected('');
    await refresh();
    await loadQueue();
    setWorking(false);
  }

  if (loading || authorized === null) return <main className="center-screen"><div className="loader" />Loading team room…</main>;
  if (!authorized || !team) return null;

  return (
    <main className="app-page team-room-page">
      <AppHeader state={state} showLogout />
      <section className="team-room-hero" style={{ background: `linear-gradient(135deg, ${team.primaryColor}, ${team.secondaryColor})` }}>
        <TeamMark team={team} size="large" />
        <div><span className="eyebrow">Team draft room</span><h1>{team.name}</h1><p>{onClock ? 'Your team is on the clock.' : state.currentTeam ? `${state.currentTeam.name} is on the clock.` : 'The draft is not active.'}</p></div>
        <div className="team-clock"><small>{state.draft?.status.replace('_', ' ')}</small><Clock deadline={state.draft?.deadlineTs || null} status={state.draft?.status} fallback={state.draft?.clockSeconds || 0} /><span>Pick {state.draft?.currentOverall || 0}</span></div>
      </section>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <section className="room-grid">
        <div className="panel player-panel">
          <div className="section-title"><div><span className="eyebrow">Draft class</span><h2>Available players</h2></div><strong>{state.availablePlayers.length}</strong></div>
          <div className="player-filters"><input placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} /><select value={position} onChange={(e) => setPosition(e.target.value)}>{positions.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="player-list">
            {filtered.map((player) => {
              const queued = queue.some((item) => item.id === player.id);
              return <div className={`player-row ${selected === player.id ? 'selected' : ''}`} key={player.id} onClick={() => setSelected(player.id)}><span className="rank">{player.rank}</span><span className="position-badge">{player.position}</span><span className="player-copy"><strong>{player.name}</strong><small>{[player.proTeam, player.college].filter(Boolean).join(' · ')}</small></span><button type="button" className="queue-button" onClick={(event) => { event.stopPropagation(); void saveQueue(queued ? queue.filter((item) => item.id !== player.id) : [...queue, player]); }}>{queued ? 'Queued' : '+ Queue'}</button></div>;
            })}
          </div>
          <div className="pick-submit"><div><small>Selected player</small><strong>{state.availablePlayers.find((player) => player.id === selected)?.name || 'None'}</strong></div><button className="button primary" disabled={!onClock || !selected || working} onClick={submitPick}>{working ? 'Submitting…' : onClock ? 'Submit pick' : 'Waiting for your turn'}</button></div>
        </div>

        <aside className="panel queue-panel">
          <div className="section-title"><div><span className="eyebrow">Auto-pick order</span><h2>Your queue</h2></div><strong>{queue.length}</strong></div>
          <p className="muted">When the clock expires, the first available queued player is selected. If the queue is empty, the highest-ranked available player is used.</p>
          <div className="queue-list">{queue.map((player, index) => <div className="queue-row" key={player.id}><span>{index + 1}</span><div><strong>{player.name}</strong><small>{player.position} · Rank {player.rank}</small></div><div className="queue-actions"><button disabled={index === 0} onClick={() => { const next = [...queue]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void saveQueue(next); }}>↑</button><button disabled={index === queue.length - 1} onClick={() => { const next = [...queue]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; void saveQueue(next); }}>↓</button><button onClick={() => saveQueue(queue.filter((item) => item.id !== player.id))}>×</button></div></div>)}{!queue.length && <div className="empty">Your queue is empty.</div>}</div>
        </aside>
      </section>

      <section className="panel section-panel board-section"><div className="section-title"><div><span className="eyebrow">Draft board</span><h2>All selections</h2></div></div><DraftBoard state={state} compact /></section>
    </main>
  );
}
