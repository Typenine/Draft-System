'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock } from '@/components/Clock';
import { DraftBoard } from '@/components/DraftBoard';
import { TeamMark } from '@/components/TeamMark';
import { useDraftState } from '@/components/useDraftState';

export default function BroadcastPage() {
  const { state, loading, error } = useDraftState(800);
  const [animationKey, setAnimationKey] = useState('');
  const latestPick = state.picks.at(-1) || null;

  useEffect(() => {
    if (latestPick) setAnimationKey(`${latestPick.overall}-${latestPick.madeAt}`);
  }, [latestPick?.madeAt, latestPick?.overall]);

  const latestTeam = useMemo(() => latestPick ? state.teams.find((team) => team.id === latestPick.teamId) || null : null, [latestPick, state.teams]);
  const theme = {
    '--league-primary': state.branding?.primaryColor || '#2563eb',
    '--league-secondary': state.branding?.secondaryColor || '#0f172a',
  } as React.CSSProperties;

  if (loading) return <main className="broadcast-loading"><div className="loader" />Loading broadcast…</main>;

  return (
    <main className="broadcast-page" style={theme}>
      <header className="broadcast-header">
        <div className="broadcast-brand">{state.branding?.logoUrl ? <img src={state.branding.logoUrl} alt="" /> : <span className="brand-icon">DS</span>}<div><strong>{state.leagueName || 'Draft System'}</strong><small>{state.draft?.name || 'Live Draft'}</small></div></div>
        <div className="broadcast-round">Round {state.slots.find((slot) => slot.overall === state.draft?.currentOverall)?.round || state.draft?.rounds || 0}<small>Pick {state.draft?.currentOverall || 0}</small></div>
      </header>

      {latestPick && latestTeam && (
        <section className="pick-animation" key={animationKey} style={{ '--team-primary': latestTeam.primaryColor, '--team-secondary': latestTeam.secondaryColor } as React.CSSProperties}>
          <div className="pick-sweep" />
          <TeamMark team={latestTeam} size="large" />
          <div><span>The pick is in</span><h1>{latestPick.playerName}</h1><p>{latestPick.playerPosition}{latestPick.playerProTeam ? ` · ${latestPick.playerProTeam}` : ''}</p><small>{latestTeam.name} · Pick {latestPick.overall}</small></div>
        </section>
      )}

      <section className="broadcast-main">
        <div className="on-clock-broadcast">
          {state.currentTeam ? <><span className="eyebrow">Now on the clock</span><TeamMark team={state.currentTeam} size="large" /><h2>{state.currentTeam.name}</h2><Clock deadline={state.draft?.deadlineTs || null} status={state.draft?.status} fallback={state.draft?.clockSeconds || 0} /></> : <><span className="eyebrow">Draft status</span><h2>{state.draft?.status.replace('_', ' ') || 'Waiting'}</h2></>}
        </div>
        <div className="broadcast-board"><DraftBoard state={state} compact /></div>
      </section>

      <footer className="broadcast-ticker"><span>{state.draft?.status === 'LIVE' ? 'LIVE' : state.draft?.status.replace('_', ' ')}</span><div>{state.picks.slice(-8).reverse().map((pick) => <b key={pick.overall}>{pick.overall}. {pick.playerName} <small>{pick.playerPosition}</small></b>)}</div></footer>
      {error && <div className="broadcast-error">{error}</div>}
    </main>
  );
}
