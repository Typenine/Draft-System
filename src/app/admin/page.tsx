'use client';

import { FormEvent, useEffect, useState } from 'react';

const placeholderNames = ['Alpha Wolves', 'Bay City', 'Capital Club', 'Desert Storm'];

type StateResponse = {
  configured?: boolean;
  leagueName?: string;
  picks?: unknown[];
  teams?: Array<{ name?: string }>;
};

export default function AdminSignInPage() {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch('/api/state', { cache: 'no-store' }),
      fetch('/api/auth/session', { cache: 'no-store' }),
    ]).then(async ([stateResponse, sessionResponse]) => {
      const state = stateResponse.ok ? await stateResponse.json() as StateResponse : null;
      const placeholderLeague = Boolean(
        state?.configured
          && state.leagueName === 'Draft League'
          && state.picks?.length === 0
          && state.teams?.length === placeholderNames.length
          && state.teams.every((team, index) => team.name === placeholderNames[index]),
      );

      if (!state?.configured || placeholderLeague) {
        window.location.replace('/');
        return;
      }

      if (sessionResponse.ok) {
        const session = await sessionResponse.json();
        if (session.role === 'admin') {
          window.location.replace('/commissioner');
          return;
        }
      }
      setChecking(false);
    }).catch(() => setChecking(false));
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setMessage(null);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', code }),
    });
    const data = await response.json();
    if (response.ok) {
      window.location.href = '/commissioner';
      return;
    }
    setMessage(String(data.error || 'Commissioner sign in failed.'));
    setWorking(false);
  }

  if (checking) return <main className="center-screen"><div className="loader" />Checking league setup…</main>;

  return (
    <main className="admin-signin-page">
      <section className="admin-signin-copy">
        <span className="eyebrow">Commissioner access</span>
        <h1>Run and configure the draft.</h1>
        <p>Sign in to control the live room, rehearse every animation, edit teams and event branding, and manage all 336 draft slots.</p>
        <a href="/">Return to league entry</a>
      </section>
      <form className="panel admin-signin-card" onSubmit={signIn}>
        <span className="brand-icon large">DS</span>
        <div><span className="eyebrow">Admin sign in</span><h2>Commissioner code</h2></div>
        <label>Commissioner access code
          <input type="password" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="current-password" autoFocus required />
        </label>
        {message && <p className="form-message error">{message}</p>}
        <button className="button primary" disabled={working}>{working ? 'Signing in…' : 'Open commissioner control'}</button>
      </form>
    </main>
  );
}
