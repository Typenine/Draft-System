'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { useDraftState } from '@/components/useDraftState';

type MediaEntry = {
  playerId: string;
  playerName: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  hasImage: boolean;
};

export default function CommissionerMediaPage() {
  const { state, loading } = useDraftState(0);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<MediaEntry[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      const ok = response.ok && data.role === 'admin';
      setAuthorized(ok);
      if (!ok) window.location.href = '/admin';
    });
  }, []);

  async function refreshMedia() {
    const response = await fetch('/api/draft/player-videos', { cache: 'no-store' });
    const data = await response.json();
    setEntries(Array.isArray(data.videos) ? data.videos : []);
  }

  useEffect(() => { void refreshMedia(); }, []);

  const selected = useMemo(() => state.players.find((player) => player.id === playerId) || null, [playerId, state.players]);

  useEffect(() => {
    const entry = entries.find((item) => item.playerId === playerId);
    setImageUrl(entry?.imageUrl || '');
    setVideoUrl(entry?.videoUrl || '');
  }, [entries, playerId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!playerId) return;
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch('/api/draft/player-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, imageUrl: imageUrl.trim() || null, videoUrl: videoUrl.trim() || null }),
      });
      const data = await response.json();
      setMessage(response.ok ? 'Player media saved.' : String(data.error || 'Unable to save media.').replaceAll('_', ' '));
      if (response.ok) await refreshMedia();
    } finally {
      setWorking(false);
    }
  }

  async function clear(type: 'image' | 'video' | 'all') {
    if (!playerId) return;
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch('/api/draft/player-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', type, playerId }),
      });
      const data = await response.json();
      setMessage(response.ok ? 'Player media updated.' : String(data.error || 'Unable to update media.').replaceAll('_', ' '));
      if (response.ok) await refreshMedia();
    } finally {
      setWorking(false);
    }
  }

  if (loading || authorized === null) return <main className="center-screen"><div className="loader" />Loading media controls…</main>;
  if (!authorized) return null;

  return (
    <main className="app-page">
      <AppHeader state={state} showLogout />
      <section className="page-heading">
        <div><span className="eyebrow">Broadcast assets</span><h1>Player Media</h1><p>Add optional images and videos used during pick animations.</p></div>
        <a className="button" href="/commissioner">Back to commissioner room</a>
      </section>
      {message && <div className="notice">{message}</div>}
      <section className="admin-grid media-admin-grid">
        <form className="panel control-panel" onSubmit={save}>
          <h2>Player image and video</h2>
          <p className="muted">Use an HTTPS URL or a repository path under <code>public/</code>, such as <code>/player-images/name.jpg</code>.</p>
          <label>Player<select value={playerId} onChange={(event) => setPlayerId(event.target.value)}><option value="">Select player</option>{state.players.map((player) => <option key={player.id} value={player.id}>{player.rank}. {player.name} · {player.position}</option>)}</select></label>
          <label>Image URL or public path<input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://… or /player-images/…" /></label>
          <label>Video URL or public path<input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="YouTube, HTTPS video, or /player-videos/…" /></label>
          <div className="button-grid">
            <button className="button primary" disabled={working || !playerId} type="submit">Save media</button>
            <button className="button" disabled={working || !playerId} type="button" onClick={() => clear('image')}>Clear image</button>
            <button className="button" disabled={working || !playerId} type="button" onClick={() => clear('video')}>Clear video</button>
            <button className="button danger" disabled={working || !playerId} type="button" onClick={() => clear('all')}>Clear both</button>
          </div>
        </form>
        <section className="panel control-panel media-preview-panel">
          <h2>Preview</h2>
          {!selected && <div className="empty">Select a player to preview their broadcast media.</div>}
          {selected && <><h3>{selected.name}</h3><p className="muted">{selected.position}{selected.proTeam ? ` · ${selected.proTeam}` : ''}</p>{imageUrl ? <img className="player-media-preview-image" src={imageUrl.startsWith('/') ? imageUrl : `/api/draft/player-image?playerId=${encodeURIComponent(playerId)}`} alt={selected.name} /> : <div className="empty">No image assigned.</div>}{videoUrl ? (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be') ? <p className="muted">YouTube video saved. It will play in the draft animation.</p> : <video className="player-media-preview-video" src={videoUrl} controls />) : <div className="empty">No video assigned.</div>}</>}
        </section>
      </section>
      <section className="panel section-panel">
        <div className="section-title"><div><span className="eyebrow">Configured assets</span><h2>{entries.length} players with media</h2></div></div>
        <div className="media-entry-grid">{entries.map((entry) => <button key={entry.playerId} className="media-entry-card" onClick={() => setPlayerId(entry.playerId)}><strong>{entry.playerName || entry.playerId}</strong><span>{entry.hasImage ? 'Image' : 'No image'} · {entry.videoUrl ? 'Video' : 'No video'}</span></button>)}</div>
      </section>
    </main>
  );
}
