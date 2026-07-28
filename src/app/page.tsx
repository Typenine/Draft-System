'use client';

import { FormEvent, useMemo, useState, type CSSProperties } from 'react';
import { DraftablePlayerSource } from '@/components/setup/DraftablePlayerSource';
import { createDefaultTeams, TeamSetupEditor, type EditableTeam } from '@/components/setup/TeamSetupEditor';
import { useDraftState } from '@/components/useDraftState';
import { DRAFTABLE_PLAYER_SOURCE } from '@/data/draftable-player-source';
import type { SetupTeamInput } from '@/lib/types';

const placeholderNames = ['Alpha Wolves', 'Bay City', 'Capital Club', 'Desert Storm'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const playerCount = new Intl.NumberFormat('en-US').format(DRAFTABLE_PLAYER_SOURCE.playerCount);

function friendlySetupError(value: unknown): string {
  const message = String(value || 'Setup failed.');
  if (message === 'exactly_12_teams_required') return 'Set up exactly 12 teams.';
  if (message === 'minimum_336_players_required' || message === 'draftable_player_source_invalid') return 'The Draftable Players sheet source could not be loaded.';
  if (message.includes('_login_code_duplicate')) return 'Every team needs a unique access code.';
  if (message.includes('_incomplete')) return 'Each team needs a name and access code.';
  if (message === 'admin_code_required') return 'Create a commissioner access code.';
  if (message === 'sample_replacement_not_available') return 'The sample league can no longer be replaced because real draft activity already exists.';
  return message.replaceAll('_', ' ');
}

function setupTeams(teams: EditableTeam[]): SetupTeamInput[] {
  return teams.map((team) => ({
    name: team.name.trim(),
    shortName: team.shortName.trim().toUpperCase(),
    primaryColor: team.primaryColor.trim(),
    secondaryColor: team.secondaryColor.trim(),
    loginCode: team.loginCode.trim(),
    logoUrl: team.logoUrl.trim() || null,
  }));
}

export default function HomePage() {
  const { state, loading, error, refresh } = useDraftState(0);
  const [role, setRole] = useState<'team' | 'admin'>('team');
  const [code, setCode] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [teams, setTeams] = useState<EditableTeam[]>(() => createDefaultTeams());
  const [setup, setSetup] = useState({
    leagueName: 'Panther Nation',
    adminCode: '',
    primaryColor: '#be161e',
    secondaryColor: '#bf9944',
    logoUrl: '',
    rounds: 28,
    clockSeconds: 120,
  });

  const placeholderLeague = Boolean(
    state.configured
      && state.leagueName === 'Draft League'
      && state.picks.length === 0
      && state.teams.length === placeholderNames.length
      && state.teams.every((team, index) => team.name === placeholderNames[index]),
  );
  const showSetup = !state.configured || placeholderLeague;

  const teamStatus = useMemo(() => {
    const incomplete = teams.filter((team) => !team.name.trim() || !team.shortName.trim() || !team.loginCode.trim()).length;
    const normalizedCodes = teams.map((team) => team.loginCode.trim().toLowerCase()).filter(Boolean);
    const uniqueCodes = new Set(normalizedCodes).size === normalizedCodes.length;
    const validColors = teams.every((team) => HEX_COLOR.test(team.primaryColor.trim()) && HEX_COLOR.test(team.secondaryColor.trim()));
    return { incomplete, uniqueCodes, validColors, ready: teams.length === 12 && incomplete === 0 && uniqueCodes && validColors };
  }, [teams]);
  const setupReady = Boolean(setup.leagueName.trim() && setup.adminCode.trim() && teamStatus.ready);

  const theme = useMemo(() => ({
    '--league-primary': state.branding?.primaryColor || setup.primaryColor,
    '--league-secondary': state.branding?.secondaryColor || setup.secondaryColor,
  }) as CSSProperties, [setup.primaryColor, setup.secondaryColor, state.branding]);

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
    setMessage(null);

    if (!teamStatus.ready) {
      if (teamStatus.incomplete) setMessage(`${teamStatus.incomplete} team${teamStatus.incomplete === 1 ? '' : 's'} still need a name, abbreviation, or access code.`);
      else if (!teamStatus.uniqueCodes) setMessage('Every team must have a unique access code.');
      else setMessage('Every team color must be a six-digit hex value such as #be161e.');
      return;
    }

    setWorking(true);
    const response = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...setup,
        rounds: 28,
        teams: setupTeams(teams),
        replacePlaceholder: placeholderLeague,
      }),
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
      <main className="setup-page setup-page-wide" style={theme}>
        <section className="setup-intro">
          <span className="eyebrow">League setup</span>
          <h1>{placeholderLeague ? 'Replace the temporary sample league.' : 'Configure your draft room.'}</h1>
          <p>Set up the league and visually configure all 12 teams. The draftable player pool is already loaded from the linked Google Sheet.</p>
          {placeholderLeague && <div className="notice">The four-team sample data is untouched and has no picks, so it can be safely replaced here without the unknown sample commissioner code.</div>}
        </section>

        <form className="setup-form setup-wizard panel" onSubmit={configure}>
          <div className="setup-summary">
            <div><small>League size</small><strong>12 teams</strong></div>
            <div><small>Draft length</small><strong>28 rounds</strong></div>
            <div><small>Player pool</small><strong>{playerCount}</strong></div>
          </div>

          <section className="setup-section">
            <div className="setup-section-heading">
              <div><span className="eyebrow">Step 1</span><h2>League and event details</h2><p>These colors and the logo provide the default event branding. Each team gets its own colors in the next step.</p></div>
            </div>
            <div className="form-grid three">
              <label>League name<input value={setup.leagueName} onChange={(event) => setSetup({ ...setup, leagueName: event.target.value })} required /></label>
              <label>Commissioner access code<input type="password" value={setup.adminCode} onChange={(event) => setSetup({ ...setup, adminCode: event.target.value })} autoComplete="new-password" required /></label>
              <label>League or draft logo URL<input value={setup.logoUrl} onChange={(event) => setSetup({ ...setup, logoUrl: event.target.value })} placeholder="Optional" /></label>
              <label>Primary event color
                <div className="color-control"><input type="color" value={setup.primaryColor} onChange={(event) => setSetup({ ...setup, primaryColor: event.target.value })} /><input value={setup.primaryColor} maxLength={7} onChange={(event) => setSetup({ ...setup, primaryColor: event.target.value })} /></div>
              </label>
              <label>Secondary event color
                <div className="color-control"><input type="color" value={setup.secondaryColor} onChange={(event) => setSetup({ ...setup, secondaryColor: event.target.value })} /><input value={setup.secondaryColor} maxLength={7} onChange={(event) => setSetup({ ...setup, secondaryColor: event.target.value })} /></div>
              </label>
              <label>Pick clock in seconds<input type="number" min="10" value={setup.clockSeconds} onChange={(event) => setSetup({ ...setup, clockSeconds: Number(event.target.value) })} /></label>
            </div>
          </section>

          <TeamSetupEditor teams={teams} leaguePrimary={setup.primaryColor} leagueSecondary={setup.secondaryColor} onChange={setTeams} />
          <DraftablePlayerSource />

          <section className="setup-section setup-final-review">
            <div className="setup-section-heading">
              <div><span className="eyebrow">Step 4</span><h2>Review and create the league</h2><p>The sample league will only be deleted after this complete setup passes validation.</p></div>
            </div>
            <div className="readiness-grid">
              <div className={setup.leagueName.trim() && setup.adminCode.trim() ? 'ready' : ''}><span>League access</span><strong>{setup.leagueName.trim() && setup.adminCode.trim() ? 'Ready' : 'Needs details'}</strong></div>
              <div className={teamStatus.ready ? 'ready' : ''}><span>Team setup</span><strong>{teamStatus.ready ? '12 teams ready' : `${teamStatus.incomplete || 12} need attention`}</strong></div>
              <div className="ready"><span>Player pool</span><strong>{playerCount} sheet players ready</strong></div>
            </div>
            {message && <p className="form-message error">{message}</p>}
            <button className="button primary setup-submit" disabled={working || !setupReady}>{working ? 'Creating 12-team draft room…' : setupReady ? 'Create league and enter commissioner control' : 'Complete league and team setup'}</button>
          </section>
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
            <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)} required>
              <option value="">Select team</option>
              {state.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
        )}
        <label>{role === 'team' ? 'Team access code' : 'Commissioner access code'}
          <input type="password" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="current-password" required />
        </label>
        {message && <p className="form-message error">{message}</p>}
        {error && <p className="form-message error">{error}</p>}
        <button className="button primary access-submit" disabled={working}>{working ? 'Opening draft room…' : role === 'team' ? 'Enter team draft room' : 'Open commissioner control'}</button>
        <div className="public-links"><a href="/draft/overlay">Open broadcast</a><a href="/archives">View archives</a></div>
      </form>
    </main>
  );
}
