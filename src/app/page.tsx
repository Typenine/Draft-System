'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useDraftState } from '@/components/useDraftState';
import type { SetupPlayerInput, SetupTeamInput } from '@/lib/types';

const sampleTeams = Array.from({ length: 12 }, (_, index) => {
  const number = index + 1;
  const palette = [
    ['#be161e', '#bf9944'], ['#1d4ed8', '#0f172a'], ['#15803d', '#052e16'], ['#c2410c', '#1c1917'],
    ['#7e22ce', '#2e1065'], ['#0f766e', '#042f2e'], ['#b91c1c', '#111827'], ['#0369a1', '#082f49'],
    ['#4d7c0f', '#1a2e05'], ['#a21caf', '#4a044e'], ['#b45309', '#451a03'], ['#4338ca', '#1e1b4b'],
  ][index];
  return `Team ${number},T${String(number).padStart(2, '0')},${palette[0]},${palette[1]},team${String(number).padStart(2, '0')},`;
}).join('\n');

const samplePlayers = '';
const placeholderNames = ['Alpha Wolves', 'Bay City', 'Capital Club', 'Desert Storm'];

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

function friendlySetupError(value: unknown): string {
  const message = String(value || 'Setup failed.');
  if (message === 'exactly_12_teams_required') return 'Enter exactly 12 teams—one team per line.';
  if (message.includes('_login_code_duplicate')) return 'Every team needs a unique access code.';
  if (message.includes('_incomplete')) return 'Each team row needs a name and access code.';
  if (message === 'admin_code_required') return 'Create a commissioner access code.';
  if (message === 'sample_replacement_not_available') return 'The sample league can no longer be replaced because real draft activity already exists.';
  return message.replaceAll('_', ' ');
}

export default function HomePage() {
  const { state, loading, error, refresh } = useDraftState(0);
  const [role, setRole] = useState<'team' | 'admin'>('team');
  const [code, setCode] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [setup, setSetup] = useState({
    leagueName: 'Panther Nation',
    adminCode: '',
    primaryColor: '#be161e',
    secondaryColor: '#bf9944',
    logoUrl: '',
    rounds: 28,
    clockSeconds: 120,
    teamsCsv: sampleTeams,
    playersCsv: samplePlayers,
  });

  const placeholderLeague = Boolean(
    state.configured
      && state.leagueName === 'Draft League'
      && state.picks.length === 0
      && state.teams.length === placeholderNames.length
      && state.teams.every((team, index) => team.name === placeholderNames[index]),
  );
  const showSetup = !state.configured || placeholderLeague;

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
      body: JSON.stringify({ role, code, teamId: role === 'team' ? selectedTeamId : undefined }),
    });
    const data = await response.json();
    if (response.ok) window.location.href = String(data.redirectTo || (role === 'admin' ? '/commissioner' : '/draft/room/team'));
    else setMessage(String(data.error || 'Login failed.'));
    setWorking(false);
  }

  async function configure(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setMessage(null);
    const teams = parseTeams(setup.teamsCsv);
    const players = parsePlayers(setup.playersCsv);
    if (teams.length !== 12) {
      setMessage('Enter exactly 12 teams—one team per line.');
      setWorking(false);
      return;
    }

    const response = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...setup, rounds: 28, teams, players, replacePlaceholder: placeholderLeague }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(friendlySetupError(data.error));
      setWorking(false);
      return;
    }

    const loginResponse = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', code: setup.adminCode }),
    });
    if (loginResponse.ok) {
      window.location.href = '/commissioner';
      return;
    }

    setMessage('League created. Sign in with the commissioner code you just selected.');
    await refresh();
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

  if (showSetup) {
    return (
      <main className="setup-page" style={theme}>
        <section className="setup-intro">
          <span className="eyebrow">League setup</span>
          <h1>{placeholderLeague ? 'Replace the temporary sample league.' : 'Configure your draft room.'}</h1>
          <p>This draft system is fixed for 12 teams and 28 rounds. After setup, you will be signed directly into commissioner control.</p>
          {placeholderLeague && <div className="notice">The four-team sample data is untouched and has no picks, so it can be safely replaced here without the unknown sample commissioner code.</div>}
        </section>
        <form className="setup-form panel" onSubmit={configure}>
          <div className="setup-summary">
            <div><small>League size</small><strong>12 teams</strong></div>
            <div><small>Draft length</small><strong>28 rounds</strong></div>
            <div><small>Total selections</small><strong>336 picks</strong></div>
          </div>
          <div className="form-grid three">
            <label>League name<input value={setup.leagueName} onChange={(e) => setSetup({ ...setup, leagueName: e.target.value })} required /></label>
            <label>Commissioner access code<input type="password" value={setup.adminCode} onChange={(e) => setSetup({ ...setup, adminCode: e.target.value })} autoComplete="new-password" required /></label>
            <label>League or draft logo URL<input value={setup.logoUrl} onChange={(e) => setSetup({ ...setup, logoUrl: e.target.value })} placeholder="Optional" /></label>
            <label>Primary color<input type="color" value={setup.primaryColor} onChange={(e) => setSetup({ ...setup, primaryColor: e.target.value })} /></label>
            <label>Secondary color<input type="color" value={setup.secondaryColor} onChange={(e) => setSetup({ ...setup, secondaryColor: e.target.value })} /></label>
            <label>Pick clock in seconds<input type="number" min="10" value={setup.clockSeconds} onChange={(e) => setSetup({ ...setup, clockSeconds: Number(e.target.value) })} /></label>
          </div>
          <label>12 teams<textarea rows={14} value={setup.teamsCsv} onChange={(e) => setSetup({ ...setup, teamsCsv: e.target.value })} spellCheck={false} /></label>
          <p className="field-help">Exactly 12 lines: team name, abbreviation, primary color, secondary color, team access code, optional logo URL. Replace the Team 1–12 labels and codes with the real league information.</p>
          <label>Draftable players<textarea rows={11} value={setup.playersCsv} onChange={(e) => setSetup({ ...setup, playersCsv: e.target.value })} placeholder="1,Patrick Mahomes,QB,KC,Texas Tech\n2,Micah Parsons,EDGE,DAL,Penn State" spellCheck={false} /></label>
          <p className="field-help">One player per line: rank, name, position, NFL team, college, optional unique ID. IDP positions such as EDGE, DL, LB, CB, and S are supported.</p>
          {message && <p className="form-message error">{message}</p>}
          <button className="button primary setup-submit" disabled={working}>{working ? 'Creating 12-team draft room…' : 'Create league and enter commissioner control'}</button>
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
          <p>Choose your access type, enter one code, and go directly to the correct draft room.</p>
        </div>
        <div className="hero-status">
          <span>{state.draft?.status.replace('_', ' ') || 'NO DRAFT'}</span>
          <strong>{state.draft?.name || 'Draft not created'}</strong>
          <small>{state.teams.length} teams · {state.draft?.rounds || 0} rounds · {(state.teams.length || 0) * (state.draft?.rounds || 0)} picks</small>
        </div>
      </section>
      <form className="login-card panel access-panel" onSubmit={login}>
        <div className="access-choice">
          <button type="button" className={role === 'team' ? 'active' : ''} onClick={() => { setRole('team'); setMessage(null); }}>
            <span>Team owner</span><small>Pick, queue, trade, and view the live board</small>
          </button>
          <button type="button" className={role === 'admin' ? 'active' : ''} onClick={() => { setRole('admin'); setMessage(null); }}>
            <span>Commissioner</span><small>Run the clock, approve picks, and control the broadcast</small>
          </button>
        </div>
        {role === 'team' && (
          <label>Choose your team
            <select value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)} required>
              <option value="">Select team</option>
              {state.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
        )}
        <label>{role === 'team' ? 'Team access code' : 'Commissioner access code'}
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" required />
        </label>
        {message && <p className="form-message error">{message}</p>}
        {error && <p className="form-message error">{error}</p>}
        <button className="button primary access-submit" disabled={working}>{working ? 'Opening draft room…' : role === 'team' ? 'Enter team draft room' : 'Open commissioner control'}</button>
        <div className="public-links"><a href="/draft/overlay">Open broadcast</a><a href="/archives">View archives</a></div>
      </form>
    </main>
  );
}
