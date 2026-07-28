'use client';

import Link from 'next/link';
import type { DraftState } from '@/lib/types';

export function AppHeader({ state, showLogout = false }: { state: DraftState; showLogout?: boolean }) {
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  return (
    <header className="app-header">
      <Link href="/" className="brand-link">
        {state.branding?.logoUrl ? <img src={state.branding.logoUrl} alt="" /> : <span className="brand-icon">DS</span>}
        <span><strong>{state.leagueName || 'Draft System'}</strong><small>Live Draft Platform</small></span>
      </Link>
      <nav>
        <Link href="/broadcast">Broadcast</Link>
        <Link href="/archives">Archives</Link>
        {showLogout && <button className="link-button" onClick={logout}>Sign out</button>}
      </nav>
    </header>
  );
}
