'use client';

import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { DraftBoard } from '@/components/DraftBoard';
import { useDraftState } from '@/components/useDraftState';
import type { ArchiveDraft, DraftState } from '@/lib/types';

export default function ArchivesPage() {
  const { state } = useDraftState(0);
  const [drafts, setDrafts] = useState<ArchiveDraft[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/archives', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) setError(String(data.error || 'Unable to load archives.'));
      else {
        setDrafts(data.drafts as ArchiveDraft[]);
        setSelected((data.drafts as ArchiveDraft[])[0]?.id || '');
      }
    });
  }, []);

  const draft = drafts.find((item) => item.id === selected) || null;
  const archiveState: DraftState = draft ? { ...state, draft, slots: draft.slots, picks: draft.picks, currentTeam: null, availablePlayers: [] } : state;

  return (
    <main className="app-page">
      <AppHeader state={state} />
      <section className="page-heading"><div><span className="eyebrow">Draft history</span><h1>Archives</h1></div></section>
      {error && <div className="notice error">{error}</div>}
      <section className="archive-layout">
        <aside className="panel archive-list"><h2>Drafts</h2>{drafts.map((item) => <button key={item.id} className={selected === item.id ? 'active' : ''} onClick={() => setSelected(item.id)}><strong>{item.name}</strong><span>{item.status.replace('_', ' ')}</span><small>{item.picks.length} picks · {new Date(item.createdAt).toLocaleDateString()}</small></button>)}{!drafts.length && <div className="empty">No drafts have been created.</div>}</aside>
        <section className="panel section-panel board-section"><div className="section-title"><div><span className="eyebrow">Saved board</span><h2>{draft?.name || 'Select a draft'}</h2></div>{draft && <small>{draft.status.replace('_', ' ')} · {draft.picks.length} selections</small>}</div>{draft && <DraftBoard state={archiveState} />}</section>
      </section>
    </main>
  );
}
