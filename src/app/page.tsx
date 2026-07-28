'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useDraftState } from '@/components/useDraftState';
import type { SetupPlayerInput, SetupTeamInput } from '@/lib/types';

const sampleTeams = `Alpha Wolves,AW,#2563eb,#0f172a,alpha123,
Bay City,BAY,#dc2626,#111827,bay123,
Capital Club,CAP,#16a34a,#052e16,capital123,
Desert Storm,DST,#d97706,#1c1917,desert123`;

const samplePlayers = `1,Player One,QB,KC,Example University
2,Player Two,RB,GB,State College
3,Player Three,WR,SEA,Tech
4,Player Four,TE,DET,University`;

function csvLines(value: string): string[][] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(',').map((part) => part.trim()));
}

function parseTeams(value: string): SetupTeamInput[] {
  return csvLines(value).map(([name, shortName, primaryColor, secondaryColor, loginCode, logoUrl]) => ({
    name,
    shortName,
    primaryColor,
    secondaryColor,
    loginCode,
    logoUrl: logoUrl || null,
  }));
}

function parsePlayers(value: string): SetupPlayerInput[] {
  return csvLines(value).map(([rank, name, position, proTeam, college, id]) => ({
    id: id || undefined,
    rank: Number(rank),
    name,
    position,
    proTeam: proTeam || null,
    college: college || null,
  }));
}

export default function HomePage() {
  const { state, loading, error, refresh } = useDraftState(0);
  const [role, setRole] = useState<'team' | 'admin'>('team');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [setup, setSetup] = useState({
    leagueName: 'Draft League',
    adminCode: '',
    primaryColor: '#2563eb',
    secondaryColor: '#0f172a',
    logoUrl: '',
    rounds: 4,
    clockSeconds: 120,
    teamsCsv: sampleTeams,
    playersCsv: samplePlayers,
  });

  const theme = useMemo(() => ({
    '--league-primary': state.branding?.primaryColor || setup.primaryColor,
    '--league-secondary': state.branding?.secondaryColor || setup.secondaryColor,
  }) as React.CSSProperties, [setup.primaryColor, setup.secondaryColor, state.branding]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setMessage(null);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, code }),
    });
    const data = await response.json();
    if (response.ok) window.location.href = role === 'admin' ? '/commissioner' : '/room';
    else setMessage(String(data.error || 'Login failed.'));
    setWorking(false);
  }

  async function configure(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setMessage(null);
    const teams = parseTeams(setup.teamsCsv);
    const players = parsePlayers(setup.playersCsv);
    const response = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...setup, teams, players }),
    });
    const data = await response.json();
    if (response.ok) {
      setMessage('Setup complete. Sign in with the commissioner code.');
      await refresh();
    } else setMessage(String(data.error || 'Setup failed.'));
    setWorking(false);
  }

  if (loading) return <main className="center-screen"><div className="loader" />Loading Draft System…</main>;

  if (state.databaseConfigured === false) {
    return (
      <main className="center-screen">
        <section className="status-card">
          <span className="brand-icon large">DS</span>
          <h1>Database connection required</h1>
          <p>Add a Neon PostgreSQL connection string as <code>DATABASE_URL</code> in the Vercel production environment. Add <code>SESSION_SECRET</code> as a long random value.</p>
          <p className="muted">No league data has been created.</p>
        </section>
      </main>
    );
  }

  if (!state.configured) {
    return (
      <main className="setup-page" style={theme}>
        <section className="setup-intro">
          <span className="eyebrow">One-time setup</span>
          <h1>Configure your standalone draft.</h1>
          <p>Team and player data are stored in your own database. This project has no East v. West branding or league dependencies.</p>
        </section>
        <form className="setup-form panel" onSubmit={configure}>
          <div className="form-grid three">
            <label>League name<input value={setup.leagueName} onChange={(e) => setSetup({ ...setup, leagueName: e.target.value })} required /></label>
            <label>Commissioner code<input type="password" value={setup.adminCode} onChange={(e) => setSetup({ ...setup, adminCode: e.target.value })} required /></label>
            <label>Logo URL<input value={setup.logoUrl} onChange={(e) => setSetup({ ...setup, logoUrl: e.target.value })} placeholder="Optional" /></label>
            <label>Primary color<input type="color" value={setup.primaryColor} onChange={(e) => setSetup({ ...setup, primaryColor: e.target.value })} /></label>
            <label>Secondary color<input type="color" value={setup.secondaryColor} onChange={(e) => setSetup({ ...setup, secondaryColor: e.target.value })} /></label>
            <label>Rounds<input type="number" min="1" max="20" value={setup.rounds} onChange={(e) => setSetup({ ...setup, rounds: Number(e.target.value) })} /></label>
            <label>Clock seconds<input type="number" min="10" value={setup.clockSeconds} onChange={(e) => setSetup({ ...setup, clockSeconds: Number(e.target.value) })} /></label>
          </div>
          <label>Teams CSV<textarea rows={7} value={setup.teamsCsv} onChange={(e) => setSetup({ ...setup, teamsCsv: e.target.value })} /></label>
          <p className="field-help">One team per line: Name, abbreviation, primary color, secondary color, login code, optional logo URL.</p>
          <label>Players CSV<textarea rows={9} value={setup.playersCsv} onChange={(e) => setSetup({ ...setup, playersCsv: e.target.value })} /></label>
          <p className="field-help">One player per line: Rank, name, position, pro team, college, optional unique ID.</p>
          {message && <p className="form-message">{message}</p>}
          <button className="button primary" disabled={working}>{working ? 'Creating league…' : 'Create draft system'}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="login-page" style={theme}>
      <section className="login-hero">
        <div>
          {state.branding?.logoUrl ? <img className="hero-logo" src={state.branding.logoUrl} alt="" /> : <span className="brand-icon large">DS</span>}
          <span className="eyebrow">Live draft platform</span>
          <h1>{state.leagueName}</h1>
          <p>Enter your team code to open the draft room or use the commissioner code to manage the event.</p>
        </div>
        <div className="hero-status">
          <span>{state.draft?.status.replace('_', ' ') || 'NO DRAFT'}</span>
          <strong>{state.draft?.name || 'Draft not created'}</strong>
          <small>{state.teams.length} teams · {state.draft?.rounds || 0} rounds</small>
        </div>
      </section>
      <form className="login-card panel" onSubmit={login}>
        <div className="role-toggle">
          <button type="button" className={role === 'team' ? 'active' : ''} onClick={() => setRole('team')}>Team room</button>
          <button type="button" className={role === 'admin' ? 'active' : ''} onClick={() => setRole('admin')}>Commissioner</button>
        </div>
        <label>{role === 'team' ? 'Team access code' : 'Commissioner code'}<input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required /></label>
        {message && <p className="form-message error">{message}</p>}
        {error && <p className="form-message error">{error}</p>}
        <button className="button primary" disabled={working}>{working ? 'Signing in…' : 'Enter draft'}</button>
        <div className="public-links"><a href="/broadcast">Open broadcast</a><a href="/archives">View archives</a></div>
      </form>
    </main>
  );
}
