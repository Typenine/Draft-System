'use client';

import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { DraftablePlayerSource } from '@/components/setup/DraftablePlayerSource';
import { DraftOrderEditor, generateDraftOrder, type DraftFormat } from '@/components/setup/DraftOrderEditor';
import { TeamSetupEditor, type EditableTeam } from '@/components/setup/TeamSetupEditor';
import { useDraftState } from '@/components/useDraftState';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export default function CommissionerSettingsPage() {
  const { state, loading, error, refresh } = useDraftState(2500);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [secondaryColor, setSecondaryColor] = useState('#0f172a');
  const [logoUrl, setLogoUrl] = useState('');
  const [clockSeconds, setClockSeconds] = useState(120);
  const [teams, setTeams] = useState<EditableTeam[]>([]);
  const [draftFormat, setDraftFormat] = useState<DraftFormat>('linear');
  const [baseOrder, setBaseOrder] = useState<string[]>([]);
  const [slotOrder, setSlotOrder] = useState<string[]>([]);

  useEffect(() => {
    void fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      const ok = response.ok && data.role === 'admin';
      setAuthorized(ok);
      if (!ok) window.location.href = '/admin';
    });
  }, []);

  useEffect(() => {
    if (initialized || !state.configured || !state.teams.length) return;
    const editableTeams = state.teams.map((team) => ({
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      primaryColor: team.primaryColor,
      secondaryColor: team.secondaryColor,
      logoUrl: team.logoUrl || '',
      loginCode: '',
    }));
    const fallbackBase = state.teams.map((team) => team.id);
    const nextFormat = state.settings?.draftFormat || 'linear';
    const nextBase = state.settings?.baseOrder?.length === state.teams.length ? state.settings.baseOrder : fallbackBase;
    const generated = generateDraftOrder(nextBase, state.draft?.rounds || 28, nextFormat);
    const currentSlots = state.slots.length === generated.length ? state.slots.map((slot) => slot.teamId) : generated;
    setTeams(editableTeams);
    setLeagueName(state.leagueName || 'Draft League');
    setDraftName(state.draft?.name || 'Draft');
    setPrimaryColor(state.branding?.primaryColor || '#2563eb');
    setSecondaryColor(state.branding?.secondaryColor || '#0f172a');
    setLogoUrl(state.branding?.logoUrl || '');
    setClockSeconds(state.draft?.clockSeconds || state.settings?.clockSeconds || 120);
    setDraftFormat(nextFormat);
    setBaseOrder(nextBase);
    setSlotOrder(currentSlots);
    setInitialized(true);
  }, [initialized, state]);

  const lockedOverall = useMemo(() => state.picks.map((pick) => pick.overall), [state.picks]);
  const teamStatus = useMemo(() => {
    const incomplete = teams.filter((team) => !team.name.trim() || !team.shortName.trim()).length;
    const validColors = teams.every((team) => HEX_COLOR.test(team.primaryColor.trim()) && HEX_COLOR.test(team.secondaryColor.trim()));
    return { incomplete, validColors, ready: teams.length === 12 && incomplete === 0 && validColors };
  }, [teams]);
  const orderReady = baseOrder.length === 12 && new Set(baseOrder).size === 12 && slotOrder.length === 336;
  const ready = Boolean(leagueName.trim() && draftName.trim() && teamStatus.ready && orderReady);

  const theme = {
    '--league-primary': primaryColor,
    '--league-secondary': secondaryColor,
  } as CSSProperties;

  function updateOrderTemplate(nextBase: string[], nextFormat: DraftFormat) {
    const rounds = state.draft?.rounds || 28;
    const previousGenerated = generateDraftOrder(baseOrder, rounds, draftFormat);
    const nextGenerated = generateDraftOrder(nextBase, rounds, nextFormat);
    const locked = new Set(lockedOverall);
    setSlotOrder((current) => current.map((teamId, index) => {
      if (locked.has(index + 1)) return teamId;
      return teamId === previousGenerated[index] ? nextGenerated[index] : teamId;
    }));
    setBaseOrder(nextBase);
    setDraftFormat(nextFormat);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (!ready) {
      if (!teamStatus.ready) setMessage(teamStatus.incomplete ? `${teamStatus.incomplete} teams still need a name or abbreviation.` : 'Every team color must be a six-digit hex value.');
      else setMessage('Review the complete draft order before saving.');
      return;
    }
    setWorking(true);
    const response = await fetch('/api/admin/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_setup',
        leagueName,
        draftName,
        adminCode,
        primaryColor,
        secondaryColor,
        logoUrl,
        clockSeconds,
        draftFormat,
        baseOrder,
        slotTeamIds: slotOrder,
        teams: teams.map((team) => ({
          id: team.id,
          name: team.name,
          shortName: team.shortName,
          primaryColor: team.primaryColor,
          secondaryColor: team.secondaryColor,
          logoUrl: team.logoUrl || null,
          loginCode: team.loginCode,
        })),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(String(data.error || 'Settings could not be saved.').replaceAll('_', ' '));
      setWorking(false);
      return;
    }
    setAdminCode('');
    setMessage('League, teams, and draft order saved. The draft was paused if it had been live.');
    await refresh();
    setWorking(false);
  }

  if (loading || authorized === null || !initialized) return <main className="center-screen"><div className="loader" />Loading league settings…</main>;
  if (!authorized) return null;

  return (
    <main className="app-page commissioner-settings-page" style={theme}>
      <AppHeader state={state} showLogout />
      <section className="settings-heading">
        <div><span className="eyebrow">Commissioner settings</span><h1>Edit the complete draft setup.</h1><p>Changes apply to the current draft and become the defaults for future drafts. Picks already made cannot be reassigned.</p></div>
        <a className="button" href="/commissioner">Back to commissioner room</a>
      </section>
      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <form className="setup-form setup-wizard panel settings-form" onSubmit={save}>
        <div className="setup-summary four">
          <div><small>League size</small><strong>12 teams</strong></div>
          <div><small>Draft length</small><strong>28 rounds</strong></div>
          <div><small>Draft format</small><strong>{draftFormat === 'snake' ? 'Snake' : 'Linear'}</strong></div>
          <div><small>Completed picks</small><strong>{state.picks.length}</strong></div>
        </div>

        <section className="setup-section">
          <div className="setup-section-heading"><div><span className="eyebrow">League and draft</span><h2>Event details and access</h2><p>Leave the new commissioner code blank to keep the existing code.</p></div></div>
          <div className="form-grid three">
            <label>League name<input value={leagueName} onChange={(event) => setLeagueName(event.target.value)} required /></label>
            <label>Current draft name<input value={draftName} onChange={(event) => setDraftName(event.target.value)} required /></label>
            <label>New commissioner code<input type="password" value={adminCode} onChange={(event) => setAdminCode(event.target.value)} placeholder="Leave blank to keep current" autoComplete="new-password" /></label>
            <label>League or draft logo URL<input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="Optional" /></label>
            <label>Primary event color<div className="color-control"><input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} /><input value={primaryColor} maxLength={7} onChange={(event) => setPrimaryColor(event.target.value)} /></div></label>
            <label>Secondary event color<div className="color-control"><input type="color" value={secondaryColor} onChange={(event) => setSecondaryColor(event.target.value)} /><input value={secondaryColor} maxLength={7} onChange={(event) => setSecondaryColor(event.target.value)} /></div></label>
            <label>Pick clock in seconds<input type="number" min="10" value={clockSeconds} onChange={(event) => setClockSeconds(Number(event.target.value))} /></label>
          </div>
        </section>

        <TeamSetupEditor
          teams={teams}
          leaguePrimary={primaryColor}
          leagueSecondary={secondaryColor}
          onChange={setTeams}
          requireAccessCodes={false}
          stepLabel="Team settings"
          heading="Edit teams, colors, logos, and access"
        />
        <DraftOrderEditor
          teams={teams.map((team) => ({ id: String(team.id), name: team.name, shortName: team.shortName, primaryColor: team.primaryColor }))}
          rounds={28}
          format={draftFormat}
          baseOrder={baseOrder}
          slotOrder={slotOrder}
          lockedOverall={lockedOverall}
          stepLabel="Draft order"
          onFormatChange={(nextFormat) => updateOrderTemplate(baseOrder, nextFormat)}
          onBaseOrderChange={(nextBase) => updateOrderTemplate(nextBase, draftFormat)}
          onSlotOrderChange={setSlotOrder}
        />
        <DraftablePlayerSource stepLabel="Player source" />

        <section className="setup-section setup-final-review">
          <div className="setup-section-heading"><div><span className="eyebrow">Save changes</span><h2>Apply the updated setup</h2><p>Saving pauses a live draft so the new order and clock cannot change while a selection is being made.</p></div></div>
          <div className="readiness-grid">
            <div className={leagueName.trim() && draftName.trim() ? 'ready' : ''}><span>League and draft</span><strong>{leagueName.trim() && draftName.trim() ? 'Ready' : 'Needs details'}</strong></div>
            <div className={teamStatus.ready ? 'ready' : ''}><span>Teams</span><strong>{teamStatus.ready ? '12 ready' : `${teamStatus.incomplete || 12} need attention`}</strong></div>
            <div className={orderReady ? 'ready' : ''}><span>Order</span><strong>{orderReady ? '336 picks ready' : 'Needs review'}</strong></div>
          </div>
          <button className="button primary setup-submit" disabled={working || !ready}>{working ? 'Saving complete setup…' : 'Save league, teams, and draft order'}</button>
        </section>
      </form>
    </main>
  );
}
