'use client';

import { FormEvent, useEffect, useState } from 'react';

export default function AdminSignInPage() {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return;
      const session = await response.json();
      if (session.role === 'admin') window.location.href = '/commissioner';
    }).catch(() => {});
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
