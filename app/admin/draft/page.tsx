'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SectionHeader from '@/components/ui/SectionHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Label from '@/components/ui/Label';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import { TEAM_NAMES } from '@/lib/constants/league';
import DraftOverlayLive, {
  type DraftInfoBarTickerControlState,
  type DraftOverlayLiveHandle,
} from '@/components/draft-overlay/DraftOverlayLive';
import { getTeamLogoPath } from '@/lib/utils/team-utils';
import { getTeamColors } from '@/lib/constants/team-colors';

const LEAGUE_LOGO_PATH = `/assets/teams/East%20v%20West%20Logos/${encodeURIComponent('Official East v. West Logo.png')}`;

type DraftOverview = {
  id: string;
  year: number;
  rounds: number;
  clockSeconds: number;
  status: 'NOT_STARTED' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  curOverall: number;
  onClockTeam?: string | null;
  clockStartedAt?: string | null;
  deadlineTs?: string | null;
  eventName?: string | null;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  eventColor2?: string | null;
  roundEndPause?: boolean | null;
  recentPicks: Array<{ overall: number; round: number; team: string; playerId: string; playerName?: string | null; playerPos?: string | null; playerNfl?: string | null; madeAt: string }>;
  allPicks?: Array<{ overall: number; round: number; team: string; playerId: string; playerName?: string | null; playerPos?: string | null; playerNfl?: string | null; madeAt: string }>;
  upcoming: Array<{ overall: number; round: number; team: string }>;
  allSlots?: Array<{ overall: number; round: number; team: string }>;
};

function PlayerMediaCard() {
  type MediaEntry = { playerId: string; playerName: string | null; hasImage: boolean; hasVideo: boolean; videoUrl: string | null };
  const [media, setMedia] = useState<MediaEntry[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; pos: string; nfl: string }>>([]);
  const [searchingPlayers, setSearchingPlayers] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: string; name: string; pos: string; nfl: string } | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreviewStatus, setImagePreviewStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  /** Root-relative paths /player-images/... found on disk */
  const [projectImages, setProjectImages] = useState<string[]>([]);

  async function loadProjectImages() {
    try {
      const res = await fetch('/api/draft/player-images-files', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      setProjectImages(Array.isArray(j.paths) ? j.paths : []);
    } catch {
      setProjectImages([]);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const r = fr.result;
        if (typeof r !== 'string') {
          reject(new Error('read'));
          return;
        }
        const i = r.indexOf(',');
        resolve(i >= 0 ? r.slice(i + 1) : r);
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  async function loadMedia() {
    try {
      const res = await fetch('/api/draft/player-videos', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      setMedia(j.videos || []);
    } catch {}
  }
  useEffect(() => {
    loadMedia();
    loadProjectImages();
  }, []);

  async function searchPlayers() {
    if (!playerSearch.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchingPlayers(true);
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'available', q: playerSearch, limit: 20, showAll: true }),
      });
      setSearchResults((await res.json())?.available || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchingPlayers(false);
    }
  }

  // Typeahead suggestions: fetch while typing (debounced), no auto-select.
  useEffect(() => {
    if (selectedPlayer) return;
    const q = playerSearch.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchPlayers();
    }, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerSearch, selectedPlayer]);

  async function saveMedia() {
    if (!selectedPlayer) return;
    setSaving(true);
    try {
      if (imageUrl.trim() && imageUrl.trim().toLowerCase().startsWith('data:')) {
        alert('data: URLs are not allowed. Use a hosted URL or app path.');
        return;
      }
      if (imageUrl.trim() && !imageUrl.trim().startsWith('/') && !/^https?:\/\//i.test(imageUrl.trim())) {
        alert('Image must be a root-relative path like /player-images/name.png or an http(s) URL.');
        return;
      }
      if (videoUrl.trim() && videoUrl.trim().toLowerCase().startsWith('data:')) {
        alert('data: URLs are not allowed. Use a hosted URL.');
        return;
      }
      if (videoUrl.trim()) {
        setUploadProgress('Saving video URL…');
        const r = await fetch('/api/draft/player-videos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId: selectedPlayer.id, videoUrl: videoUrl.trim(), playerName: selectedPlayer.name }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert(`Video URL save failed: ${err?.error || r.status}`);
          return;
        }
        setVideoUrl('');
      }
      if (imageUrl.trim()) {
        setUploadProgress('Saving image URL/path…');
        const r = await fetch('/api/draft/player-videos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId: selectedPlayer.id, imageUrl: imageUrl.trim(), playerName: selectedPlayer.name }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert(`Image URL save failed: ${err?.error || r.status}`);
          return;
        }
        setImageUrl('');
        setImagePreviewStatus('idle');
      }
      setSelectedPlayer(null); setPlayerSearch(''); setSearchResults([]);
      await loadMedia();
      await loadProjectImages();
    } catch { alert('Save failed'); }
    finally { setSaving(false); setUploadProgress(null); }
  }

  async function deleteEntry(playerId: string) {
    if (!confirm('Remove all media for this player?')) return;
    setDeletingId(playerId);
    try {
      await fetch('/api/draft/player-videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, action: 'delete' }),
      });
      await loadMedia();
    } catch { alert('Delete failed'); }
    finally { setDeletingId(null); }
  }

  const canSave = !!(selectedPlayer && (videoUrl.trim() || imageUrl.trim()));

  return (
    <div className="max-w-4xl space-y-6">
      {/* Add/update panel */}
      <Card>
        <CardHeader><CardTitle>Add / Update Player Media</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted)] mb-4">
            Attach a highlight video and/or player headshot to any player. The image appears on the draft pick card; the video plays after the animation sequence.
          </p>
          <div className="space-y-4">
            {/* Player search */}
            <div className="space-y-2">
              <Label className="block text-sm font-semibold">1. Find Player</Label>
              <div className="flex gap-2">
                <Input value={playerSearch} onChange={e => setPlayerSearch(e.target.value)}
                  placeholder="Search player name…" className="flex-1"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchPlayers(); } }} />
                <Button size="sm" onClick={searchPlayers}>Search</Button>
              </div>
              {searchingPlayers && !selectedPlayer && (
                <div className="text-xs text-zinc-400">Searching...</div>
              )}
              {searchResults.length > 0 && !selectedPlayer && (
                <div className="max-h-40 overflow-auto border border-zinc-600 rounded bg-zinc-900">
                  {searchResults.map(p => (
                    <button key={p.id} type="button"
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700 flex items-center justify-between text-white"
                      onClick={() => { setSelectedPlayer(p); setSearchResults([]); }}>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-zinc-400 ml-2">{p.pos} · {p.nfl}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedPlayer && (
                <div className="flex items-center gap-2 p-2 bg-zinc-700/50 rounded text-sm">
                  <span className="font-semibold text-white">{selectedPlayer.name}</span>
                  <span className="text-zinc-400">{selectedPlayer.pos} · {selectedPlayer.nfl}</span>
                  <button type="button" className="ml-auto text-zinc-400 hover:text-white" onClick={() => { setSelectedPlayer(null); setVideoUrl(''); setImageUrl(''); setImagePreviewStatus('idle'); }}>✕ Clear</button>
                </div>
              )}
            </div>

            {/* Video */}
            <div className="space-y-2">
              <Label className="block text-sm font-semibold">2. Video <span className="text-zinc-500 font-normal">(YouTube / URL, or upload)</span></Label>
              <Input value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=… or another hosted URL" className="w-full" disabled={!selectedPlayer} />
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="file"
                  accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
                  disabled={!selectedPlayer || saving}
                  className="text-sm text-zinc-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-zinc-700 file:text-white hover:file:bg-zinc-600"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file || !selectedPlayer) return;
                    const name = file.name.toLowerCase();
                    if (!(/\.(mp4|webm|mov)$/i.test(name))) {
                      alert('Use mp4, webm, or mov for uploaded highlight clips.');
                      return;
                    }
                    setSaving(true);
                    setUploadProgress('Saving video under public/player-videos…');
                    try {
                      const fileData = await fileToBase64(file);
                      const r = await fetch('/api/draft/player-media', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          playerId: selectedPlayer.id,
                          playerName: selectedPlayer.name,
                          type: 'video',
                          fileName: file.name,
                          fileData,
                        }),
                      });
                      const j = await r.json().catch(() => ({}));
                      if (!r.ok) {
                        alert(typeof j?.error === 'string' ? j.error : `Save failed (${r.status}).`);
                        return;
                      }
                      setVideoUrl('');
                      await loadMedia();
                    } catch {
                      alert('Upload failed.');
                    } finally {
                      setSaving(false);
                      setUploadProgress(null);
                    }
                  }}
                />
              </div>
              <p className="text-xs text-zinc-500">Paste a YouTube URL above, or upload a clip (writes to `public/player-videos/` locally; on Vercel add the file to the repo instead).</p>
            </div>

            {/* Image */}
            <div className="space-y-2">
              <Label className="block text-sm font-semibold">3. Player Image <span className="text-zinc-500 font-normal">(pick from project, upload, URL, or path)</span></Label>
              <div className="space-y-1">
                <Label className="block text-xs text-zinc-500">Files in `public/player-images/`</Label>
                <select
                  value={imageUrl && projectImages.includes(imageUrl) ? imageUrl : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      setImageUrl(v);
                      setImagePreviewStatus('idle');
                    }
                  }}
                  disabled={!selectedPlayer}
                  className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  <option value="">{projectImages.length === 0 ? 'No image files in folder (add some or deploy)' : 'Choose an existing file…'}</option>
                  {projectImages.map((p) => (
                    <option key={p} value={p}>{p.replace(/^\/player-images\//, '')}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  disabled={!selectedPlayer || saving}
                  className="text-sm text-zinc-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-zinc-700 file:text-white hover:file:bg-zinc-600"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file || !selectedPlayer) return;
                    const name = file.name.toLowerCase();
                    if (!(/\.(png|jpe?g|webp)$/i.test(name))) {
                      alert('Use png, jpg, jpeg, or webp images.');
                      return;
                    }
                    setSaving(true);
                    setUploadProgress('Saving image under public/player-images…');
                    try {
                      const fileData = await fileToBase64(file);
                      const r = await fetch('/api/draft/player-media', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          playerId: selectedPlayer.id,
                          playerName: selectedPlayer.name,
                          type: 'image',
                          fileName: file.name,
                          fileData,
                        }),
                      });
                      const j = await r.json().catch(() => ({}));
                      if (!r.ok) {
                        alert(typeof j?.error === 'string' ? j.error : `Save failed (${r.status}). Add the file under public/player-images/ in git or paste an image URL below.`);
                        return;
                      }
                      setImageUrl('');
                      setImagePreviewStatus('idle');
                      await loadMedia();
                      await loadProjectImages();
                    } catch {
                      alert('Upload failed.');
                    } finally {
                      setSaving(false);
                      setUploadProgress(null);
                    }
                  }}
                />
              </div>
              <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                placeholder="https://... or /player-images/cam-ward.webp" className="w-full" disabled={!selectedPlayer} />
              <p className="text-xs text-zinc-500">Put files in <span className="font-mono text-zinc-400">east-v-west/public/player-images/</span> (same as URL <span className="font-mono text-zinc-400">/player-images/…</span>). A <span className="font-mono text-zinc-400">template.svg</span> lives there so you know you’re in the right folder. Uploads save here locally; on Vercel, commit images to git and deploy. You can also paste an https image URL.</p>
              <p className="text-xs text-zinc-500">`data:` URLs are blocked for pasted URLs. Use png/jpg/jpeg/webp.</p>
              {imageUrl.trim() ? (
                <div className="flex items-center gap-3">
                  <img
                    src={imageUrl}
                    alt="Image preview"
                    className="w-16 h-20 object-cover rounded border border-zinc-700"
                    onLoad={() => setImagePreviewStatus('ok')}
                    onError={() => setImagePreviewStatus('error')}
                  />
                  <div className="text-xs">
                    <div className="text-zinc-300 break-all">{imageUrl}</div>
                    {imagePreviewStatus === 'ok' && <div className="text-emerald-400">Preview loaded.</div>}
                    {imagePreviewStatus === 'error' && <div className="text-red-400">Preview failed. Verify the file exists under `public/player-images/` and the filename/path matches exactly.</div>}
                  </div>
                </div>
              ) : null}
            </div>

            {uploadProgress && <p className="text-sm text-blue-400 animate-pulse">{uploadProgress}</p>}

            <Button variant="primary" disabled={!canSave || saving} onClick={saveMedia} className="w-full sm:w-auto">
              {saving ? 'Saving…' : 'Save Media'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Existing media list */}
      <Card>
        <CardHeader><CardTitle>Existing Media ({media.length})</CardTitle></CardHeader>
        <CardContent>
          {media.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No player media set yet.</p>
          ) : (
            <div className="space-y-2">
              {media.map(m => (
                <div key={m.playerId} className="flex items-center gap-3 p-2 bg-zinc-800/40 rounded">
                  {m.hasImage ? (
                    <img src={`/api/draft/player-image?playerId=${encodeURIComponent(m.playerId)}`} alt={m.playerName || ''} className="w-10 h-12 object-cover rounded flex-shrink-0" style={{ objectPosition: 'top center' }} />
                  ) : (
                    <div className="w-10 h-12 bg-zinc-700 rounded flex-shrink-0 flex items-center justify-center text-zinc-500 text-xs">No img</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-white truncate">{m.playerName || m.playerId}</div>
                    <div className="text-xs text-zinc-400 space-x-2">
                      {m.hasVideo && m.videoUrl && <span>🎬 {m.videoUrl.startsWith('/') ? 'local video' : m.videoUrl.length > 50 ? m.videoUrl.slice(0, 50) + '…' : m.videoUrl}</span>}
                      {m.hasImage && <span>🖼️ headshot via `/api/draft/player-image`</span>}
                      {!m.hasVideo && !m.hasImage && <span className="text-zinc-600">no media</span>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-900/30 flex-shrink-0"
                    disabled={deletingId === m.playerId} onClick={() => deleteEntry(m.playerId)}>
                    {deletingId === m.playerId ? '…' : '🗑️'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDraftPage() {
  type ConfirmIntent = {
    action: 'undo' | 'skip_pick' | 'reset_trades' | 'reset' | 'delete';
    title: string;
    message: string;
  };
  const isDev = process.env.NODE_ENV !== 'production';
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftOverview | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [localRemainingSec, setLocalRemainingSec] = useState<number | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now());
  const [clockMins, setClockMins] = useState('10');
  const [clockSecs, setClockSecs] = useState('0');
  const [form, setForm] = useState({ year: new Date().getFullYear().toString(), rounds: '4' });
  const [roundOrders, setRoundOrders] = useState<Record<number, string[]>>({});
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState('');
  const [avail, setAvail] = useState<Array<{ id: string; name: string; pos: string; nfl: string }>>([]);
  const [forcePlayer, setForcePlayer] = useState<{ id: string; name: string; pos: string; nfl: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [teamOrder, setTeamOrder] = useState<string[]>(TEAM_NAMES);
  const [playersInfo, setPlayersInfo] = useState<{ useCustom: boolean; count: number }>({ useCustom: false, count: 0 });
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [pendingPick, setPendingPick] = useState<{
    id: string; overall: number; team: string; playerId: string;
    playerName: string | null; playerPos: string | null; playerNfl: string | null; submittedAt: string;
  } | null>(null);
  const [approvingPick, setApprovingPick] = useState(false);
  const [activeTab, setActiveTab] = useState<'draft' | 'branding' | 'order'>('draft');
  const [slotAssignments, setSlotAssignments] = useState<Record<number, string>>({});
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderSaved, setOrderSaved] = useState(false);
  const [orderRound, setOrderRound] = useState(1);
  type AdminTrade = { id: string; draftId: string; status: string; proposedBy: string; teams: string[]; acceptedBy: string[]; notes?: string | null; proposedAt: string; updatedAt: string; assets: Array<{ id: string; fromTeam: string; toTeam: string; assetType: string; playerId?: string | null; playerName?: string | null; playerPos?: string | null; pickOverall?: number | null; pickYear?: number | null; pickRound?: number | null; pickOriginalTeam?: string | null }> };
  const [pendingTrades, setPendingTrades] = useState<AdminTrade[]>([]);
  const [tradeAction, setTradeAction] = useState<string | null>(null);
  const overlayRef = useRef<DraftOverlayLiveHandle>(null);
  const [tickerControl, setTickerControl] = useState<DraftInfoBarTickerControlState>({
    paused: false,
    slideLabel: 'Best Available',
  });
  const [brandingForm, setBrandingForm] = useState({ eventName: '', eventColor1: '#a4c810', eventColor2: '#ffffff', eventLogoUrl: '' });
  const [brandingLogoPreview, setBrandingLogoPreview] = useState<string | null>(null);
  const [savingBranding, setSavingBranding] = useState(false);
  type BrandingTemplate = { id: string; label: string; eventName: string | null; eventLogoUrl: string | null; eventColor1: string | null; eventColor2: string | null; updatedAt: string };
  const [brandingTemplates, setBrandingTemplates] = useState<BrandingTemplate[]>([]);
  const [newTemplateLabel, setNewTemplateLabel] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [showLogoBrowser, setShowLogoBrowser] = useState(false);
  const [draftLogoFiles, setDraftLogoFiles] = useState<string[]>([]);

  async function loadBrandingTemplates() {
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list_branding_templates' }),
      });
      if (!res.ok) return;
      const j = await res.json();
      setBrandingTemplates(Array.isArray(j.templates) ? j.templates : []);
    } catch { /* ignore */ }
  }

  async function loadDraftLogoFiles() {
    try {
      const res = await fetch('/api/draft/logo-files', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      setDraftLogoFiles(Array.isArray(j.paths) ? j.paths : []);
    } catch { /* ignore */ }
  }

  function applyBrandingTemplate(t: BrandingTemplate) {
    setBrandingForm({
      eventName: t.eventName ?? '',
      eventColor1: t.eventColor1 ?? '#a4c810',
      eventColor2: t.eventColor2 ?? '#ffffff',
      eventLogoUrl: t.eventLogoUrl ?? '',
    });
    setBrandingLogoPreview(t.eventLogoUrl || null);
  }

  async function saveAsBrandingTemplate() {
    const label = newTemplateLabel.trim();
    if (!label) return;
    setSavingTemplate(true);
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save_branding_template',
          label,
          eventName: brandingForm.eventName || null,
          eventLogoUrl: brandingForm.eventLogoUrl || null,
          eventColor1: brandingForm.eventColor1 || null,
          eventColor2: brandingForm.eventColor2 || null,
        }),
      });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error || 'failed');
      setBrandingTemplates(Array.isArray(j.templates) ? j.templates : []);
      setNewTemplateLabel('');
    } catch (e) {
      alert((e as Error).message || 'Save template failed');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function deleteBrandingTemplateById(id: string) {
    setDeletingTemplateId(id);
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete_branding_template', templateId: id }),
      });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error || 'failed');
      setBrandingTemplates(Array.isArray(j.templates) ? j.templates : []);
    } catch (e) {
      alert((e as Error).message || 'Delete failed');
    } finally {
      setDeletingTemplateId(null);
    }
  }
  type PoolSummary = { id: string; label: string; playerCount: number; updatedAt: string };
  const [playerPoolsList, setPlayerPoolsList] = useState<PoolSummary[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [newPoolLabel, setNewPoolLabel] = useState('');
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent | null>(null);
  const metricsStartAtRef = useRef<number>(Date.now());
  const [netMetrics, setNetMetrics] = useState({
    requestCount: 0,
    totalBytes: 0,
    draftPollCount: 0,
    availCount: 0,
    tradePollCount: 0,
    lastRevision: '-',
  });

  function recordNetMetric(params: { bytes: number; isDraftPoll?: boolean; includeAvail?: boolean; isTradePoll?: boolean; revision?: string | null }) {
    setNetMetrics(prev => ({
      requestCount: prev.requestCount + 1,
      totalBytes: prev.totalBytes + Math.max(0, params.bytes),
      draftPollCount: prev.draftPollCount + (params.isDraftPoll ? 1 : 0),
      availCount: prev.availCount + (params.includeAvail ? 1 : 0),
      tradePollCount: prev.tradePollCount + (params.isTradePoll ? 1 : 0),
      lastRevision: params.revision ?? prev.lastRevision,
    }));
  }

  function resetNetMetrics() {
    metricsStartAtRef.current = Date.now();
    setNetMetrics({
      requestCount: 0,
      totalBytes: 0,
      draftPollCount: 0,
      availCount: 0,
      tradePollCount: 0,
      lastRevision: '-',
    });
  }

  // Convert mins:secs to total seconds
  async function loadPendingTrades() {
    try {
      const res = await fetch('/api/draft/trade?action=get_admin_pending', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (isDev) {
        recordNetMetric({
          bytes: JSON.stringify(data).length,
          isTradePoll: true,
        });
      }
      setPendingTrades((data.trades as AdminTrade[]) || []);
    } catch {}
  }

  async function handleTradeDecision(tradeId: string, decision: 'approve' | 'reject_admin') {
    if (!draft) return;
    setTradeAction(tradeId + decision);
    try {
      await fetch('/api/draft/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decision, draftId: draft.id, tradeId }),
      });
      await loadPendingTrades();
      await load();
    } catch {}
    finally { setTradeAction(null); }
  }

  const getTotalSeconds = () => Number(clockMins || 0) * 60 + Number(clockSecs || 0);
  
  // Format seconds as MM:SS
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  useEffect(() => {
    fetch('/api/admin-login').then(r => r.json()).then(j => setIsAdmin(Boolean(j?.isAdmin))).catch(() => setIsAdmin(false));
  }, []);

  async function loadAdminWorkspace() {
    if (!isAdmin) return;
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'admin_workspace' }),
      });
      if (!res.ok) return;
      const j = await res.json();
      setPlayerPoolsList(Array.isArray(j.pools) ? j.pools : []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!isAdmin) return;
    void loadAdminWorkspace();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, draft?.id]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'branding') return;
    void loadBrandingTemplates();
    void loadDraftLogoFiles();
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!isAdmin || draft) return;
    (async () => {
      try {
        const res = await fetch('/api/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'admin_workspace' }),
        });
        if (!res.ok) return;
        const j = await res.json();
        const w = j.workspace;
        if (!w) return;
        setBrandingForm(prev => ({
          eventName: w.eventName ?? prev.eventName,
          eventColor1: w.eventColor1 ?? prev.eventColor1,
          eventColor2: w.eventColor2 ?? prev.eventColor2,
          eventLogoUrl: w.eventLogoUrl ?? prev.eventLogoUrl,
        }));
        if (w.eventLogoUrl && !brandingLogoPreview) {
          setBrandingLogoPreview(w.eventLogoUrl);
        }
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, draft, draft?.id]);

  async function load(includeAvail = false, showSpinner = false) {
    try {
      if (showSpinner) setLoading(true);
      const url = includeAvail ? '/api/draft?include=available' : '/api/draft';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      const j = await res.json();
      if (isDev) {
        recordNetMetric({
          bytes: JSON.stringify(j).length,
          isDraftPoll: true,
          includeAvail,
          revision: typeof j?.revision === 'string' ? j.revision : null,
        });
      }
      const newDraft = j?.draft || null;
      setDraft(newDraft);
      const nextRemaining = j?.remainingSec ?? null;
      setRemainingSec(nextRemaining);
      setLocalRemainingSec(nextRemaining);
      setLastFetchTime(Date.now());
      setPendingPick(j?.pendingPick ?? null);
      if (newDraft) {
        setBrandingForm(prev => ({
          eventName: newDraft.eventName ?? prev.eventName,
          eventColor1: newDraft.eventColor1 ?? prev.eventColor1,
          eventColor2: newDraft.eventColor2 ?? prev.eventColor2,
          eventLogoUrl: newDraft.eventLogoUrl ?? prev.eventLogoUrl,
        }));
        if (newDraft.eventLogoUrl && !brandingLogoPreview) {
          setBrandingLogoPreview(newDraft.eventLogoUrl);
        }
      }
      if (includeAvail) setAvail(j?.available || []);
    } catch {
      setError('Failed to load draft');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  function getDraftPollMs(status: DraftOverview['status'] | null | undefined): number {
    if (status === 'LIVE') return 3000;
    if (status === 'PAUSED' || status === 'NOT_STARTED') return 8000;
    if (status === 'COMPLETED') return 12000;
    return 5000;
  }

  useEffect(() => {
    load(true, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(false);
    let t: ReturnType<typeof setInterval>;
    const jitter = () => Math.floor(Math.random() * 400);
    const start = () => {
      const ms = (document.hidden ? 10000 : getDraftPollMs(draft?.status)) + jitter();
      t = setInterval(() => { load(false); loadPendingTrades(); }, ms);
    };
    const onVis = () => {
      clearInterval(t);
      load(false);
      loadPendingTrades();
      start();
    };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.status]);

  useEffect(() => {
    if (remainingSec == null) {
      setLocalRemainingSec(null);
      return;
    }
    if (draft?.status !== 'LIVE') {
      setLocalRemainingSec(remainingSec);
      return;
    }
    const t = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastFetchTime) / 1000);
      setLocalRemainingSec(Math.max(0, remainingSec - elapsed));
    }, 1000);
    return () => clearInterval(t);
  }, [remainingSec, draft?.status, lastFetchTime]);

  async function saveBranding() {
    setSavingBranding(true);
    try {
      const logoUrl = (brandingForm.eventLogoUrl || '').trim();
      if (logoUrl && logoUrl.trimStart().toLowerCase().startsWith('data:')) {
        throw new Error('Direct logo file/base64 uploads are disabled. Use /draft-logos/... or an https URL.');
      }
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'update_branding',
          ...(draft ? { id: draft.id } : {}),
          eventName: brandingForm.eventName || null,
          eventLogoUrl: logoUrl || null,
          eventColor1: brandingForm.eventColor1 || null,
          eventColor2: brandingForm.eventColor2 || null,
        }),
      });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error || 'failed');
      await load(false);
    } catch (e) {
      alert((e as Error).message || 'Save failed');
    } finally {
      setSavingBranding(false);
    }
  }

  async function refreshPlayersInfo() {
    try {
      const res = await fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'players_info' }) });
      const j = await res.json();
      setPlayersInfo({ useCustom: Boolean(j?.useCustom), count: Number(j?.count || 0) });
    } catch {}
  }
  useEffect(() => { refreshPlayersInfo(); }, []);

  // Auto-load draft order from existing /api/draft/next-order endpoint
  // This loads ALL rounds with their unique orders (accounting for trades)
  useEffect(() => {
    if (orderLoaded) return;
    
    async function loadDraftOrder() {
      try {
        const res = await fetch('/api/draft/next-order', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        
        // Load per-round orders from roundsData
        if (data?.roundsData && Array.isArray(data.roundsData)) {
          const newRoundOrders: Record<number, string[]> = {};
          for (const rd of data.roundsData) {
            if (rd.round && rd.picks) {
              // Order by slot, map to ownerTeam (who owns the pick now)
              const sortedPicks = [...rd.picks].sort((a: {slot: number}, b: {slot: number}) => a.slot - b.slot);
              newRoundOrders[rd.round] = sortedPicks.map((p: {ownerTeam: string}) => p.ownerTeam);
            }
          }
          if (Object.keys(newRoundOrders).length > 0) {
            setRoundOrders(newRoundOrders);
            // Use round 1 as the base teamOrder display
            if (newRoundOrders[1]) {
              setTeamOrder(newRoundOrders[1]);
            }
            setOrderLoaded(true);
          }
        } else if (data?.slotOrder && Array.isArray(data.slotOrder)) {
          // Fallback to basic slot order
          const order = data.slotOrder.map((slot: { team: string }) => slot.team);
          if (order.length > 0) {
            setTeamOrder(order);
            setOrderLoaded(true);
          }
        }
      } catch (err) {
        console.error('Failed to auto-load draft order:', err);
      }
    }
    
    loadDraftOrder();
  }, [orderLoaded]);

  const onAdmin = async (action: string, payload?: Record<string, unknown>) => {
    setBusy(action);
    try {
      const res = await fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...(payload || {}) }) });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error || 'failed');
      await load(true);
    } catch (e) {
      alert((e as Error).message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const openConfirm = (intent: ConfirmIntent) => setConfirmIntent(intent);
  const runConfirmedAction = async () => {
    if (!confirmIntent) return;
    const { action } = confirmIntent;
    setConfirmIntent(null);
    await onAdmin(action);
  };

  const recent = draft?.recentPicks || [];
  const upcoming = draft?.upcoming || [];

  const parsePlayersText = (text: string): Array<{ id: string; name: string; pos: string; nfl?: string | null; rank?: number; imageUrl?: string; videoUrl?: string }> => {
    // Try JSON first
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j)) {
        return j
          .map((o: unknown) => {
            const obj = (o as Record<string, unknown>) || {};
            const getStr = (k: string) => {
              const v = obj[k];
              return typeof v === 'string' ? v : '';
            };
            const getNum = (k: string) => {
              const v = obj[k];
              if (typeof v === 'number') return v;
              if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
              return undefined;
            };
            const id = (getStr('id') || getStr('player_id') || getStr('overall_pick') || getStr('pick')).trim();
            const name = (getStr('name') || getStr('player') || `${getStr('first_name')} ${getStr('last_name')}`).trim();
            const pos = (getStr('pos') || getStr('position')).trim().toUpperCase();
            const nfl = (getStr('nfl') || getStr('team') || getStr('nfl_team'));
            const rank = getNum('rank') ?? getNum('overall_pick') ?? getNum('pick');
            const imageUrl = getStr('image_url') || getStr('image') || undefined;
            const videoUrl = getStr('video_url') || getStr('video') || undefined;
            const base: { id: string; name: string; pos: string; nfl: string; rank?: number; imageUrl?: string; videoUrl?: string } = rank != null ? { id, name, pos, nfl, rank } : { id, name, pos, nfl };
            if (imageUrl) base.imageUrl = imageUrl;
            if (videoUrl) base.videoUrl = videoUrl;
            return base;
          })
          .filter((p) => p.id && p.name && p.pos);
      }
    } catch {}
    // Fallback CSV (id,name,pos,nfl or first_name,last_name)
    const lines = text.trim().split(/\r?\n/);
    if (lines.length === 0) return [];
    const headers = (lines.shift() || '')
      .split(',')
      .map((h) => h.trim().toLowerCase());
    const idx = (k: string) => headers.indexOf(k);
    const idIdx = idx('id') >= 0 ? idx('id') : idx('player_id') >= 0 ? idx('player_id') : idx('overall_pick') >= 0 ? idx('overall_pick') : idx('pick');
    const nameIdx = idx('name') >= 0 ? idx('name') : idx('player');
    const firstIdx = idx('first_name');
    const lastIdx = idx('last_name');
    const posIdx = idx('pos') >= 0 ? idx('pos') : idx('position');
    const nflIdx = idx('nfl') >= 0 ? idx('nfl') : idx('team') >= 0 ? idx('team') : idx('nfl_team');
    const rankIdx = idx('rank') >= 0 ? idx('rank') : idx('overall_pick') >= 0 ? idx('overall_pick') : idx('pick') >= 0 ? idx('pick') : -1;
    const imageUrlIdx = idx('image_url') >= 0 ? idx('image_url') : idx('image');
    const videoUrlIdx = idx('video_url') >= 0 ? idx('video_url') : idx('video');
    const out: Array<{ id: string; name: string; pos: string; nfl?: string | null; rank?: number; imageUrl?: string; videoUrl?: string }> = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = line.split(',').map((c) => c.trim());
      const id = (cols[idIdx] || '').trim();
      const name = nameIdx >= 0 ? (cols[nameIdx] || '').trim() : `${cols[firstIdx] || ''} ${cols[lastIdx] || ''}`.trim();
      const pos = ((cols[posIdx] || '').trim().toUpperCase());
      const nfl = (nflIdx >= 0 ? cols[nflIdx] : '') || '';
      const rankRaw = rankIdx >= 0 ? cols[rankIdx] : '';
      const rank = rankRaw && !Number.isNaN(Number(rankRaw)) ? Number(rankRaw) : undefined;
      const imageUrl = (imageUrlIdx >= 0 ? cols[imageUrlIdx] : '') || undefined;
      const videoUrl = (videoUrlIdx >= 0 ? cols[videoUrlIdx] : '') || undefined;
      if (id && name && pos) {
        const entry: typeof out[number] = rank != null ? { id, name, pos, nfl, rank } : { id, name, pos, nfl };
        if (imageUrl) entry.imageUrl = imageUrl;
        if (videoUrl) entry.videoUrl = videoUrl;
        out.push(entry);
      }
    }
    return out;
  };

  const onUploadPlayers = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const text = await file.text();
    const players = parsePlayersText(text);
    if (!players || players.length === 0) { alert('No players parsed'); return; }
    setBusy('upload_players');
    try {
      // Upload player pool (strip media fields — only core data goes here)
      const corePlayers = players.map(({ id, name, pos, nfl, rank }) => rank != null ? { id, name, pos, nfl, rank } : { id, name, pos, nfl });
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upload_players',
          ...(draft ? { id: draft.id } : {}),
          ...(selectedPoolId ? { poolId: selectedPoolId } : {}),
          ...(!selectedPoolId && newPoolLabel.trim() ? { poolLabel: newPoolLabel.trim() } : {}),
          players: corePlayers,
        }),
      });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error || 'failed');
      if (typeof j?.poolId === 'string') {
        setSelectedPoolId(j.poolId);
        await loadAdminWorkspace();
      }
      // Upload media URLs for players that have them (stored as tiny URL strings, not blobs)
      const withMedia = players.filter(p => p.imageUrl || p.videoUrl);
      for (const p of withMedia) {
        if (p.imageUrl) {
          await fetch('/api/draft/player-videos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: p.id, imageUrl: p.imageUrl, playerName: p.name }) }).catch(() => {});
        }
        if (p.videoUrl) {
          await fetch('/api/draft/player-videos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: p.id, videoUrl: p.videoUrl, playerName: p.name }) }).catch(() => {});
        }
      }
      await refreshPlayersInfo();
      const mediaNote = withMedia.length > 0 ? ` (${withMedia.length} with media URLs)` : '';
      alert(`Uploaded ${j?.count ?? players.length} players${mediaNote}`);
    } catch (e) {
      alert((e as Error).message || 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  const onClearPlayers = async () => {
    setBusy('clear_players');
    try {
      const res = await fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'clear_players' }) });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error || 'failed');
      await refreshPlayersInfo();
    } catch (e) {
      alert((e as Error).message || 'Clear failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-[1800px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title="Admin: Draft Control" />
        <div className="flex gap-2">
          <Link href="/draft">
            <Button variant="ghost" size="sm">← Draft Page</Button>
          </Link>
          <Link href="/draft/room">
            <Button variant="ghost" size="sm">Draft Room</Button>
          </Link>
        </div>
      </div>
      {/* Pending Pick Approval — floating panel */}
      {pendingPick && (
        <div
          className="fixed bottom-6 right-6 z-[9999] w-80 rounded-xl border-2 border-yellow-400 bg-zinc-900 shadow-2xl p-4 animate-pulse"
          style={{ boxShadow: '0 0 24px rgba(250,204,21,0.4)' }}
        >
          <div className="text-yellow-400 font-black text-sm uppercase tracking-widest mb-1">⏳ Pending Pick</div>
          <div className="text-white font-bold text-lg leading-tight mb-0.5">
            {pendingPick.playerName || pendingPick.playerId}
          </div>
          <div className="text-zinc-400 text-xs mb-1">
            {[pendingPick.playerPos, pendingPick.playerNfl].filter(Boolean).join(' · ')}
          </div>
          <div className="text-zinc-300 text-sm mb-3">
            <span className="font-semibold">{pendingPick.team}</span>
            <span className="text-zinc-500 ml-2">Pick #{pendingPick.overall}</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              className="flex-1"
              disabled={approvingPick}
              onClick={async () => {
                try { (window as Window & { __pickAudioAt?: number }).__pickAudioAt = Date.now(); new Audio('/assets/teams/audio/pickIsIn.mp3').play().catch(() => {}); } catch { /* ignored */ }
                setApprovingPick(true);
                try {
                  const res = await fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve_pick' }) });
                  const j = await res.json();
                  if (!j.ok) alert(j.error || 'Approve failed');
                  else { setPendingPick(null); await load(true); }
                } catch { alert('Approve failed'); }
                finally { setApprovingPick(false); }
              }}
            >
              {approvingPick ? '…' : '✓ Approve'}
            </Button>
            <Button
              variant="ghost"
              className="flex-1 border border-red-600 text-red-400 hover:bg-red-900/30"
              disabled={approvingPick}
              onClick={async () => {
                setApprovingPick(true);
                try {
                  await fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reject_pick' }) });
                  setPendingPick(null);
                  await load(true);
                } catch { alert('Reject failed'); }
                finally { setApprovingPick(false); }
              }}
            >
              ✗ Reject
            </Button>
          </div>
        </div>
      )}

      {/* Pending Trade Approvals — floating panel (stacks below pending pick if both present) */}
      {pendingTrades.length > 0 && (
        <div
          className="fixed z-[9998] w-96 rounded-xl border-2 border-blue-400 bg-zinc-900 shadow-2xl p-4"
          style={{ bottom: pendingPick ? '200px' : '24px', right: '24px', boxShadow: '0 0 24px rgba(59,130,246,0.35)' }}
        >
          <div className="text-blue-400 font-black text-sm uppercase tracking-widest mb-3">🤝 Trade Approval ({pendingTrades.length})</div>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {pendingTrades.map(trade => {
              const byFrom: Record<string, typeof trade.assets> = {};
              for (const a of trade.assets) { if (!byFrom[a.fromTeam]) byFrom[a.fromTeam] = []; byFrom[a.fromTeam].push(a); }
              const isActing = tradeAction !== null;
              return (
                <div key={trade.id} className="rounded-lg border border-zinc-700 p-3 space-y-2 bg-zinc-800/60">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {trade.teams.map(t => (
                      <div key={t} className="flex items-center gap-1 bg-zinc-700 rounded-full px-2 py-0.5">
                        <img src={getTeamLogoPath(t)} alt={t} className="w-4 h-4 object-contain" />
                        <span className="text-white text-xs font-bold">{t}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {Object.entries(byFrom).map(([from, assets]) => (
                      <div key={from} className="text-[11px]">
                        <span className="text-zinc-400 font-bold">{from} sends: </span>
                        {assets.map((a, i) => (
                          <span key={i} className="text-white">
                            {a.assetType === 'player' ? (a.playerName || a.playerId) :
                             a.assetType === 'current_pick' ? `Pick #${a.pickOverall}` :
                             `${a.pickYear} Rd ${a.pickRound}`}
                            {i < assets.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                        <span className="text-zinc-500"> → {assets[0].toTeam}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => handleTradeDecision(trade.id, 'approve')} disabled={isActing}
                      className="flex-1 py-1.5 rounded-lg font-black text-xs bg-emerald-500 hover:bg-emerald-400 text-white transition-colors disabled:opacity-50">
                      {tradeAction === trade.id + 'approve' ? '…' : '✓ Approve'}
                    </button>
                    <button onClick={() => handleTradeDecision(trade.id, 'reject_admin')} disabled={isActing}
                      className="flex-1 py-1.5 rounded-lg font-black text-xs bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50">
                      {tradeAction === trade.id + 'reject_admin' ? '…' : '✗ Reject'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Overlay - Full Screen Display */}
      {draft && (
        <div className="mb-4 rounded-lg overflow-hidden border border-[var(--border)] bg-black" style={{ height: 'calc(100vh - 300px)', minHeight: '700px' }}>
          <DraftOverlayLive ref={overlayRef} onTickerControlStateChange={setTickerControl} />
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-zinc-700">
        {(['draft', 'order', 'branding'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab);
              if (tab === 'order' && draft && Object.keys(slotAssignments).length === 0) {
                const init: Record<number, string> = {};
                for (const s of (draft.allSlots || [])) init[s.overall] = s.team;
                setSlotAssignments(init);
                setOrderRound(1);
              }
            }}
            className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg transition-colors -mb-px border-b-2 relative ${
              activeTab === tab
                ? 'border-[#bf9944] text-white bg-zinc-800'
                : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-800/50'
            }`}
          >
            {tab === 'draft' ? '⚙️ Draft Control' : tab === 'order' ? '📋 Draft Order' : '🎨 Branding & player media'}
          </button>
        ))}
      </div>

      {error && activeTab === 'draft' && (
        <div className="mb-4 text-[var(--danger)] text-sm">{error}</div>
      )}

      {/* Draft Order Tab */}
      {activeTab === 'order' && isAdmin && (
        <div className="space-y-4" style={{ maxWidth: '800px' }}>
          {!draft ? (
            <Card><CardContent><p className="text-[var(--muted)] text-sm">Create a draft first before setting draft order.</p></CardContent></Card>
          ) : (() => {
            const allSlots = (draft.allSlots || []).slice().sort((a: { overall: number }, b: { overall: number }) => a.overall - b.overall);
            const rounds = [...new Set(allSlots.map((s: { round: number }) => s.round))].sort((a, b) => a - b);
            const slotsForRound = (r: number) => allSlots.filter((s: { round: number }) => s.round === r);
            return (
              <>
                <div className="rounded-lg border border-zinc-700 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <p className="text-sm text-zinc-400">
                    Set the team assigned to each pick slot. Each slot has its own dropdown — teams can hold multiple picks or none in a round.
                    {draft.status === 'NOT_STARTED'
                      ? <span className="text-emerald-400 font-semibold"> Draft not started — changes apply immediately.</span>
                      : <span className="text-amber-400 font-semibold"> Draft in progress — changes only affect future resets.</span>}
                  </p>
                </div>

                {/* Round tabs */}
                <div className="flex gap-1 border-b border-zinc-700 pb-0">
                  {rounds.map(r => (
                    <button key={r} type="button" onClick={() => setOrderRound(r)}
                      className={`px-4 py-2 text-sm font-bold rounded-t-lg border-b-2 transition-colors ${
                        orderRound === r ? 'border-[#bf9944] text-white bg-zinc-800' : 'border-transparent text-zinc-400 hover:text-white'
                      }`}>
                      Round {r}
                    </button>
                  ))}
                </div>

                {/* Slots for selected round */}
                <div className="rounded-lg border border-zinc-700 overflow-hidden">
                  <div className="px-4 py-2 border-b border-zinc-700 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">Round {orderRound} — {slotsForRound(orderRound).length} picks</span>
                    <button type="button" className="text-xs text-zinc-500 hover:text-white transition-colors"
                      onClick={() => {
                        const fresh: Record<number, string> = { ...slotAssignments };
                        for (const s of slotsForRound(orderRound)) fresh[s.overall] = s.team;
                        setSlotAssignments(fresh);
                        setOrderSaved(false);
                      }}
                    >↺ Reset round to current</button>
                  </div>
                  <div className="divide-y divide-zinc-800">
                    {slotsForRound(orderRound).map((slot: { overall: number; round: number; team: string }) => {
                      const assigned = slotAssignments[slot.overall] ?? slot.team;
                      const tc = getTeamColors(assigned);
                      return (
                        <div key={slot.overall} className="flex items-center gap-4 px-4 py-2.5">
                          <div className="flex items-center gap-2 w-24 flex-shrink-0">
                            <span className="text-zinc-500 font-mono text-xs w-8 text-right">#{slot.overall}</span>
                            <span className="text-xs text-zinc-600">Rd {slot.round}</span>
                          </div>
                          <div className="w-6 h-6 rounded overflow-hidden flex-shrink-0 border" style={{ borderColor: tc.primary + '88', background: tc.primary + '22' }}>
                            <img src={getTeamLogoPath(assigned)} alt={assigned} className="w-full h-full object-contain" />
                          </div>
                          <select
                            value={assigned}
                            onChange={e => {
                              setSlotAssignments(prev => ({ ...prev, [slot.overall]: e.target.value }));
                              setOrderSaved(false);
                            }}
                            className="flex-1 rounded-lg border border-zinc-600 bg-zinc-800 text-white text-sm px-3 py-1.5 font-semibold focus:outline-none focus:border-[#bf9944] transition-colors"
                          >
                            {TEAM_NAMES.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Save bar */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={orderSaving || Object.keys(slotAssignments).length === 0}
                    variant="primary"
                    onClick={async () => {
                      setOrderSaving(true);
                      setOrderSaved(false);
                      try {
                        const slots = Object.entries(slotAssignments).map(([overall, team]) => ({ overall: Number(overall), team }));
                        const res = await fetch('/api/draft', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ action: 'set_draft_slots', slots, setAsDefault: false }),
                        });
                        if (res.ok) { setOrderSaved(true); await load(); }
                        else { alert('Failed to apply'); }
                      } catch { alert('Error'); }
                      finally { setOrderSaving(false); }
                    }}
                  >
                    {orderSaving ? '⏳ Saving…' : '✅ Apply Now'}
                  </Button>
                  <Button
                    disabled={orderSaving || Object.keys(slotAssignments).length === 0}
                    onClick={async () => {
                      setOrderSaving(true);
                      setOrderSaved(false);
                      try {
                        const slots = Object.entries(slotAssignments).map(([overall, team]) => ({ overall: Number(overall), team }));
                        const res = await fetch('/api/draft', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ action: 'set_draft_slots', slots, setAsDefault: true }),
                        });
                        if (res.ok) { setOrderSaved(true); await load(); }
                        else { alert('Failed to save'); }
                      } catch { alert('Error'); }
                      finally { setOrderSaving(false); }
                    }}
                  >
                    {orderSaving ? '⏳ Saving…' : '💾 Apply + Set as Default'}
                  </Button>
                  <button type="button" className="text-sm text-zinc-400 hover:text-white transition-colors"
                    onClick={() => {
                      const init: Record<number, string> = {};
                      for (const s of allSlots) init[s.overall] = s.team;
                      setSlotAssignments(init);
                      setOrderSaved(false);
                    }}
                  >↺ Reset all to current</button>
                  {orderSaved && <span className="text-emerald-400 text-sm font-bold">✓ Saved!</span>}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Branding Tab — event look + pick animations (player headshots / videos) */}
      {activeTab === 'branding' && isAdmin && (
        <div className="space-y-10">
          <div className="max-w-3xl space-y-6">
            <Card>
              <CardHeader><CardTitle>Branding Templates</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-[var(--muted)] text-sm">Save the form below as a named template, then load it instantly next time (e.g. one per host city or theme).</p>
                {brandingTemplates.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {brandingTemplates.map(t => (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => applyBrandingTemplate(t)}
                        className="group relative flex items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800/60 hover:bg-zinc-800 hover:border-zinc-500 pl-2 pr-7 py-1.5 cursor-pointer transition-colors"
                      >
                        <div className="w-7 h-7 rounded overflow-hidden bg-zinc-950 border border-zinc-700 flex items-center justify-center flex-shrink-0">
                          {t.eventLogoUrl ? (
                            <img src={t.eventLogoUrl} alt="" className="w-full h-full object-contain p-0.5" />
                          ) : (
                            <span className="text-[10px] text-zinc-600">—</span>
                          )}
                        </div>
                        <div className="flex flex-col leading-tight">
                          <span className="text-sm font-semibold text-white">{t.label}</span>
                          <div className="flex gap-1 mt-0.5">
                            <span className="w-2.5 h-2.5 rounded-full border border-white/20" style={{ background: t.eventColor1 || '#666' }} />
                            <span className="w-2.5 h-2.5 rounded-full border border-white/20" style={{ background: t.eventColor2 || '#666' }} />
                          </div>
                        </div>
                        <button
                          type="button"
                          title="Delete template"
                          disabled={deletingTemplateId === t.id}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete template "${t.label}"?`)) void deleteBrandingTemplateById(t.id);
                          }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    placeholder="Template name (e.g. Pittsburgh 2026)"
                    value={newTemplateLabel}
                    onChange={e => setNewTemplateLabel(e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="ghost" disabled={savingTemplate || !newTemplateLabel.trim()} onClick={saveAsBrandingTemplate}>
                    {savingTemplate ? 'Saving…' : '💾 Save as Template'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Event Branding</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                {!draft && (
                  <p className="text-[var(--muted)] text-sm">Branding is saved for the site. It applies automatically when you create the next draft.</p>
                )}
                {/* Event Name */}
                <div>
                  <Label className="mb-1 block">Event Name</Label>
                  <Input
                    placeholder="e.g. Pittsburgh 2026 Draft"
                    value={brandingForm.eventName}
                    onChange={e => setBrandingForm(f => ({ ...f, eventName: e.target.value }))}
                  />
                </div>

                {/* Logo URL / path */}
                <div>
                  <Label className="mb-1 block">Event Logo</Label>
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <Input
                        placeholder="/draft-logos/2026-draft-logo.png or https://..."
                        value={brandingForm.eventLogoUrl}
                        onChange={e => {
                          const v = e.target.value;
                          setBrandingForm(f => ({ ...f, eventLogoUrl: v }));
                          setBrandingLogoPreview(v.trim() || null);
                        }}
                      />
                      <p className="text-xs text-zinc-500 mt-1">Use a project path (e.g. <span className="font-mono text-zinc-400">/draft-logos/2026-draft-logo.png</span>) or an <span className="font-mono text-zinc-400">https://</span> URL. <span className="text-amber-300">data:</span> URLs are blocked.</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => setShowLogoBrowser(v => !v)}
                      >
                        {showLogoBrowser ? '▲ Hide logo picker' : '🖼️ Choose from project logos'}
                      </Button>
                    </div>
                    {(brandingLogoPreview || brandingForm.eventLogoUrl) && (
                      <div className="w-20 h-20 rounded-lg overflow-hidden border border-zinc-600 bg-zinc-900 flex items-center justify-center flex-shrink-0">
                        <img
                          src={brandingLogoPreview || brandingForm.eventLogoUrl}
                          alt="Event logo preview"
                          className="w-full h-full object-contain p-1"
                        />
                      </div>
                    )}
                  </div>

                  {showLogoBrowser && (
                    <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 space-y-4 max-h-80 overflow-y-auto">
                      <div>
                        <p className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">League &amp; Team Logos</p>
                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                          {[{ path: LEAGUE_LOGO_PATH, label: 'League Logo' }, ...TEAM_NAMES.map(t => ({ path: getTeamLogoPath(t), label: t }))].map(item => (
                            <button
                              key={item.path}
                              type="button"
                              title={item.label}
                              onClick={() => {
                                setBrandingForm(f => ({ ...f, eventLogoUrl: item.path }));
                                setBrandingLogoPreview(item.path);
                              }}
                              className={`aspect-square rounded-md border-2 overflow-hidden bg-zinc-950 flex items-center justify-center transition-colors ${brandingForm.eventLogoUrl === item.path ? 'border-[#bf9944]' : 'border-zinc-700 hover:border-zinc-500'}`}
                            >
                              <img src={item.path} alt={item.label} className="w-full h-full object-contain p-1" />
                            </button>
                          ))}
                        </div>
                      </div>
                      {draftLogoFiles.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Files in `public/draft-logos/`</p>
                          <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                            {draftLogoFiles.map(p => (
                              <button
                                key={p}
                                type="button"
                                title={p}
                                onClick={() => {
                                  setBrandingForm(f => ({ ...f, eventLogoUrl: p }));
                                  setBrandingLogoPreview(p);
                                }}
                                className={`aspect-square rounded-md border-2 overflow-hidden bg-zinc-950 flex items-center justify-center transition-colors ${brandingForm.eventLogoUrl === p ? 'border-[#bf9944]' : 'border-zinc-700 hover:border-zinc-500'}`}
                              >
                                <img src={p} alt="" className="w-full h-full object-contain p-1" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Colors */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="mb-1 block">Primary Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandingForm.eventColor1}
                        onChange={e => setBrandingForm(f => ({ ...f, eventColor1: e.target.value }))}
                        className="w-10 h-10 rounded cursor-pointer border border-zinc-600 bg-transparent p-0.5"
                      />
                      <Input
                        value={brandingForm.eventColor1}
                        onChange={e => setBrandingForm(f => ({ ...f, eventColor1: e.target.value }))}
                        className="font-mono text-sm uppercase"
                        maxLength={7}
                        placeholder="#FFB612"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="mb-1 block">Secondary Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandingForm.eventColor2}
                        onChange={e => setBrandingForm(f => ({ ...f, eventColor2: e.target.value }))}
                        className="w-10 h-10 rounded cursor-pointer border border-zinc-600 bg-transparent p-0.5"
                      />
                      <Input
                        value={brandingForm.eventColor2}
                        onChange={e => setBrandingForm(f => ({ ...f, eventColor2: e.target.value }))}
                        className="font-mono text-sm uppercase"
                        maxLength={7}
                        placeholder="#000000"
                      />
                    </div>
                  </div>
                </div>

                {/* Live Color Preview */}
                <div
                  className="rounded-lg p-4 flex items-center gap-4 border border-zinc-700"
                  style={{ background: `linear-gradient(135deg, ${brandingForm.eventColor1}22 0%, ${brandingForm.eventColor2}22 100%)` }}
                >
                  <div className="flex gap-2">
                    <div className="w-8 h-8 rounded-full border-2 border-white/20" style={{ background: brandingForm.eventColor1 }} title="Primary" />
                    <div className="w-8 h-8 rounded-full border-2 border-white/20" style={{ background: brandingForm.eventColor2 }} title="Secondary" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">{brandingForm.eventName || 'Event Name'}</div>
                    <div className="text-xs text-zinc-400">Clock timer & board will use these colors</div>
                  </div>
                </div>

                <Button variant="primary" disabled={savingBranding} onClick={saveBranding} className="w-full sm:w-auto">
                  {savingBranding ? 'Saving…' : 'Save Branding'}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="border-t border-zinc-700 pt-8">
            <p className="text-sm text-zinc-400 mb-4 max-w-4xl">
              <span className="font-semibold text-zinc-300">Player pick animations</span>
              {' — '}Headshots and highlight videos for the draft overlay (shown after each pick). Does not require the draft to be live.
            </p>
            <PlayerMediaCard />
          </div>
        </div>
      )}

      {activeTab === 'draft' && (
        !isAdmin ? (
          <Card><CardContent><p className="text-[var(--muted)]">Admin mode required. Use the Admin login on /login.</p></CardContent></Card>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Live Status Banner */}
            {draft && (
              <div className={`rounded-lg p-4 ${draft.status === 'LIVE' ? 'bg-emerald-900/30 border border-emerald-600' : draft.status === 'PAUSED' ? 'bg-yellow-900/30 border border-yellow-600' : 'bg-zinc-800/50 border border-zinc-700'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`px-3 py-1 rounded-full text-sm font-bold ${draft.status === 'LIVE' ? 'bg-emerald-600 text-white' : draft.status === 'PAUSED' ? 'bg-yellow-600 text-black' : 'bg-zinc-600 text-white'}`}>
                      {draft.status}
                    </div>
                    <div className="text-lg">
                      <span className="font-bold">{draft.onClockTeam || '—'}</span>
                      <span className="text-[var(--muted)] ml-2">on the clock</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-3xl font-mono font-bold ${remainingSec !== null && remainingSec <= 10 ? 'text-red-500' : ''}`}>
                      {localRemainingSec !== null ? formatTime(localRemainingSec) : '--:--'}
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      Pick #{draft.curOverall} • Round {draft.upcoming?.[0]?.round || Math.ceil(draft.curOverall / TEAM_NAMES.length)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>{draft ? 'Draft Controls' : 'Create Draft'}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-[var(--muted)]">Loading…</p>
                ) : !draft ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <Label className="mb-1 block">Year</Label>
                        <Input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
                      </div>
                      <div>
                        <Label className="mb-1 block">Rounds</Label>
                        <Input type="number" min={1} value={form.rounds} onChange={(e) => setForm({ ...form, rounds: e.target.value })} />
                      </div>
                      <div>
                        <Label className="mb-1 block">Clock Time</Label>
                        <div className="flex gap-1 items-center">
                          <Input type="number" min={0} max={59} value={clockMins} onChange={(e) => setClockMins(e.target.value)} className="w-16 text-center" placeholder="min" />
                          <span className="text-lg font-bold">:</span>
                          <Input type="number" min={0} max={59} value={clockSecs} onChange={(e) => setClockSecs(e.target.value)} className="w-16 text-center" placeholder="sec" />
                        </div>
                      </div>
                      <div>
                        <Label className="mb-1 block">Draft Type</Label>
                        <div className="text-sm text-[var(--muted)] py-2">Linear (Dynasty)</div>
                      </div>
                    </div>
                    <div>
                      <Label className="mb-2 block">Draft Order (All Rounds)</Label>
                      <div className="grid grid-cols-4 gap-2 max-h-80 overflow-auto border rounded bg-zinc-900/50 p-2">
                        {[1, 2, 3, 4].map(round => {
                          const order = roundOrders[round] || teamOrder;
                          return (
                            <div key={round} className="space-y-1">
                              <div className="text-xs font-bold text-center text-[var(--muted)] border-b border-zinc-700 pb-1">Round {round}</div>
                              {order.map((t, i) => (
                                <div key={`${round}-${i}`} className="text-xs px-1 py-0.5 bg-zinc-800/50 rounded flex items-center gap-1">
                                  <span className="text-[var(--muted)] w-4">{i + 1}.</span>
                                  <span className="truncate">{t}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setTeamOrder(TEAM_NAMES)}>Reset to Default</Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={async () => {
                            setOrderLoaded(false);
                            try {
                              const res = await fetch('/api/draft/next-order', { cache: 'no-store' });
                              if (!res.ok) throw new Error('Failed to fetch');
                              const data = await res.json();
                              // Load per-round orders from roundsData
                              if (data?.roundsData && Array.isArray(data.roundsData)) {
                                const newRoundOrders: Record<number, string[]> = {};
                                for (const rd of data.roundsData) {
                                  if (rd.round && rd.picks) {
                                    const sortedPicks = [...rd.picks].sort((a: {slot: number}, b: {slot: number}) => a.slot - b.slot);
                                    newRoundOrders[rd.round] = sortedPicks.map((p: {ownerTeam: string}) => p.ownerTeam);
                                  }
                                }
                                if (Object.keys(newRoundOrders).length > 0) {
                                  setRoundOrders(newRoundOrders);
                                  if (newRoundOrders[1]) setTeamOrder(newRoundOrders[1]);
                                  setOrderLoaded(true);
                                }
                              } else if (data?.slotOrder && Array.isArray(data.slotOrder)) {
                                const order = data.slotOrder.map((slot: { team: string }) => slot.team);
                                if (order.length > 0) {
                                  setTeamOrder(order);
                                  setRoundOrders({});
                                  setOrderLoaded(true);
                                }
                              }
                            } catch (e) {
                              alert(`❌ Error: ${(e as Error).message}`);
                            }
                          }}
                        >
                          🔄 Reload from Standings
                        </Button>
                      </div>
                      {orderLoaded && (
                        <div className="mt-2 text-sm text-green-600 flex items-center gap-1">
                          <span>✓</span> Order synced with standings
                        </div>
                      )}
                    </div>
                    <Button disabled={busy==='create'} onClick={() => onAdmin('create', { year: Number(form.year), rounds: Number(form.rounds), clockSeconds: getTotalSeconds(), teams: teamOrder, roundOrders: Object.keys(roundOrders).length > 0 ? roundOrders : undefined })}>
                      Create Draft
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Primary Controls */}
                    <div className="flex flex-wrap gap-2">
                      {draft.status === 'NOT_STARTED' && (
                        <Button disabled={busy==='start'} variant="primary" onClick={() => onAdmin('start')}>▶️ Start Draft</Button>
                      )}
                      {draft.status === 'LIVE' && (
                        <Button disabled={busy==='pause'} variant="ghost" onClick={() => onAdmin('pause')}>⏸️ Pause</Button>
                      )}
                      {draft.status === 'PAUSED' && draft.roundEndPause && (() => {
                        const completedRound = (draft.allPicks ?? draft.recentPicks).slice(-1)[0]?.round ?? 1;
                        const nextRound = completedRound + 1;
                        return (
                          <Button disabled={busy==='resume'} variant="primary" onClick={() => onAdmin('resume')}>
                            ▶️ Start Round {nextRound}
                          </Button>
                        );
                      })()}
                      {draft.status === 'PAUSED' && !draft.roundEndPause && (
                        <Button disabled={busy==='resume'} variant="primary" onClick={() => onAdmin('resume')}>▶️ Resume</Button>
                      )}
                      <Button
                        disabled={busy==='undo'}
                        variant="ghost"
                        onClick={() => openConfirm({
                          action: 'undo',
                          title: 'Undo Last Pick?',
                          message: 'This will remove the most recent pick and move the clock back to that pick.',
                        })}
                      >
                        ↩️ Undo Last Pick
                      </Button>
                      <Button
                        disabled={busy==='skip_pick'}
                        variant="ghost"
                        onClick={() => openConfirm({
                          action: 'skip_pick',
                          title: 'Skip Current Pick?',
                          message: 'This will skip the team currently on the clock and advance to the next pick.',
                        })}
                        title="Skip current pick and advance to next"
                      >
                        ⏭️ Skip Pick
                      </Button>
                      <Button disabled={busy==='auto_pick'} variant="ghost" onClick={() => onAdmin('auto_pick')} title="Force auto-pick using queue or highest-ranked player">
                        🤖 Auto-Pick
                      </Button>
                      <a href="/draft/room" target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm">👥 Team View →</Button>
                      </a>
                      <Button 
                        disabled={busy==='reset_trades'} 
                        variant="ghost" 
                        size="sm"
                        onClick={() => openConfirm({
                          action: 'reset_trades',
                          title: 'Reset All Trades?',
                          message: 'This will return traded picks/players to original owners and delete trade records. Draft picks already made are not affected.',
                        })}
                        title="Undo all trades: restore picks and players to original owners"
                      >
                        🔁 Reset Trades
                      </Button>
                      <Button 
                        disabled={busy==='reset'} 
                        variant="ghost" 
                        size="sm"
                        onClick={() => openConfirm({
                          action: 'reset',
                          title: 'Reset Entire Draft?',
                          message: 'This clears all picks, undoes all trades, deletes trade records, and returns to Round 1. Draft order is kept.',
                        })}
                        title="Clear all picks, undo all trades, return to Round 1"
                      >
                        🔄 Reset Draft
                      </Button>
                      <Button 
                        disabled={busy==='delete'} 
                        variant="danger" 
                        size="sm"
                        onClick={() => openConfirm({
                          action: 'delete',
                          title: 'Delete Draft?',
                          message: 'This permanently deletes the entire draft and cannot be undone.',
                        })}
                      >
                        🗑️ Delete Draft
                      </Button>
                    </div>

                    {/* Clock Controls */}
                    <div className="p-3 bg-zinc-800/50 rounded-lg">
                      <Label className="mb-2 block text-sm font-semibold">Set Clock Time</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1 items-center">
                          <Input type="number" min={0} max={59} value={clockMins} onChange={(e) => setClockMins(e.target.value)} className="w-16 text-center" />
                          <span className="text-lg font-bold">:</span>
                          <Input type="number" min={0} max={59} value={clockSecs} onChange={(e) => setClockSecs(e.target.value)} className="w-16 text-center" />
                        </div>
                        <span className="text-sm text-[var(--muted)]">({getTotalSeconds()}s)</span>
                        <Button disabled={busy==='set_clock'} size="sm" onClick={() => onAdmin('set_clock', { seconds: getTotalSeconds() })}>
                          Apply
                        </Button>
                        <div className="flex gap-1 flex-wrap">
                          <Button size="sm" variant="ghost" onClick={() => { setClockMins('0'); setClockSecs('10'); }}>0:10</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setClockMins('0'); setClockSecs('30'); }}>0:30</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setClockMins('1'); setClockSecs('0'); }}>1:00</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setClockMins('2'); setClockSecs('0'); }}>2:00</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setClockMins('5'); setClockSecs('0'); }}>5:00</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setClockMins('10'); setClockSecs('0'); }}>10:00</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {draft && (
              <Card>
                <CardHeader>
                  <CardTitle>Ticker Controls</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-[var(--muted)] mb-3">
                    Pause or step through info-bar slides while reviewing the live overlay preview above.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => overlayRef.current?.stepTicker(-1)}
                    >
                      ◀ Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => overlayRef.current?.toggleTickerPause()}
                    >
                      {tickerControl.paused ? '▶ Resume' : '⏸ Pause'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => overlayRef.current?.stepTicker(1)}
                    >
                      Next ▶
                    </Button>
                    <span className="text-sm font-semibold text-[var(--text)] ml-1">
                      {tickerControl.slideLabel}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Pick Reordering - Only show when draft is LIVE or PAUSED */}
            {draft && (draft.status === 'LIVE' || draft.status === 'PAUSED') && (
              <Card>
                <CardHeader>
                  <CardTitle>Assign Teams to Picks</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-[var(--muted)] mb-4">
                    Select a team for each unpicked slot. Use this to handle trades or reorder picks.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[600px] overflow-y-auto">
                    {(draft.allSlots?.filter(s => s.overall >= draft.curOverall) || upcoming).map((pick) => {
                      const teamLogo = getTeamLogoPath(pick.team);
                      const teamColors = getTeamColors(pick.team);
                      return (
                        <div 
                          key={pick.overall} 
                          className="flex items-center gap-2 p-2 rounded border" 
                          style={{ borderColor: teamColors.primary + '40', backgroundColor: teamColors.primary + '10' }}
                        >
                          <div className="flex items-center gap-2 min-w-[80px]">
                            {teamLogo && <img src={teamLogo} alt={pick.team} className="w-6 h-6 object-contain" />}
                            <span className="font-semibold text-sm">#{pick.overall}</span>
                            <span className="text-xs text-[var(--muted)]">R{pick.round}</span>
                          </div>
                          <Select
                            value={pick.team}
                            onChange={async (e) => {
                              const newTeam = e.target.value;
                              if (newTeam === pick.team) return;
                              setBusy('update_slot_' + pick.overall);
                              try {
                                const res = await fetch('/api/draft', {
                                  method: 'POST',
                                  headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({ 
                                    action: 'update_slot', 
                                    overall: pick.overall, 
                                    team: newTeam  // Fixed: was 'newTeam', API expects 'team'
                                  })
                                });
                                const j = await res.json();
                                if (!j.ok) {
                                  alert(j.error === 'slot_has_pick' ? 'This pick has already been made' : 'Failed to update slot');
                                } else {
                                  await load(true);
                                }
                              } catch {
                                alert('Failed to update slot');
                              } finally {
                                setBusy(null);
                              }
                            }}
                            disabled={busy?.startsWith('update_slot')}
                            className="flex-1 text-sm"
                          >
                            {TEAM_NAMES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}


            {/* Testing Tools */}
            {draft && draft.status !== 'COMPLETED' && (
              <Card>
                <CardHeader>
                  <CardTitle>🧪 Testing Tools</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!avail.length) {
                            alert('Search for players first using the Force Pick panel');
                            return;
                          }
                          const randomPlayer = avail[Math.floor(Math.random() * avail.length)];
                          await onAdmin('force_pick', { playerId: randomPlayer.id, playerName: randomPlayer.name, playerPos: randomPlayer.pos, playerNfl: randomPlayer.nfl });
                        }}
                        disabled={Boolean(busy) || draft.status !== 'LIVE'}
                      >
                        🎲 Auto-Pick Random
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!avail.length) {
                            alert('Search for players first using the Force Pick panel');
                            return;
                          }
                          if (!confirm('Auto-fill entire round with random picks? This will make 12 picks.')) return;
                          setBusy('auto-fill');
                          try {
                            for (let i = 0; i < 12; i++) {
                              const randomPlayer = avail[Math.floor(Math.random() * Math.min(avail.length, 50))];
                              await fetch('/api/draft', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ action: 'force_pick', playerId: randomPlayer.id, playerName: randomPlayer.name, playerPos: randomPlayer.pos, playerNfl: randomPlayer.nfl })
                              });
                              await new Promise(resolve => setTimeout(resolve, 500));
                            }
                            await load(true);
                          } catch (e) {
                            alert('Auto-fill failed: ' + (e as Error).message);
                          } finally {
                            setBusy(null);
                          }
                        }}
                        disabled={Boolean(busy) || draft.status !== 'LIVE'}
                      >
                        ⚡ Auto-Fill Round
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          window.open('/draft/overlay', 'overlay', 'width=1920,height=1080');
                        }}
                      >
                        🖥️ Test Overlay
                      </Button>
                    </div>
                    <div className="text-xs text-[var(--muted)] space-y-1 mt-3">
                      <p>• <strong>Auto-Pick Random:</strong> Makes a random pick for current team (tests single animation)</p>
                      <p>• <strong>Auto-Fill Round:</strong> Completes entire round quickly (tests board fill + multiple animations)</p>
                      <p>• <strong>Test Overlay:</strong> Opens overlay in popup to verify animations while making picks</p>
                      <p className="text-yellow-600">⚠️ Testing tools only work when draft is LIVE. Search for players first.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle>Recent Picks</CardTitle></CardHeader>
              <CardContent>
                {recent.length === 0 ? <p className="text-[var(--muted)]">No picks yet.</p> : (
                  <ul className="space-y-2">
                    {recent.slice().reverse().map((p, idx) => {
                      const teamLogo = getTeamLogoPath(p.team);
                      const teamColors = getTeamColors(p.team);
                      return (
                        <li 
                          key={`${p.overall}-${idx}`} 
                          className="flex items-center gap-3 p-2 rounded"
                          style={{
                            background: `linear-gradient(90deg, ${teamColors.primary}20 0%, transparent 100%)`,
                            borderLeft: `3px solid ${teamColors.primary}`
                          }}
                        >
                          <div className="w-8 h-8 bg-zinc-800 rounded overflow-hidden flex-shrink-0">
                            {teamLogo && <img src={teamLogo} alt={p.team} className="w-full h-full object-contain" />}
                          </div>
                          <div className="flex-1 text-sm">
                            <div className="font-semibold">#{p.overall} (R{p.round}) — {p.playerName || p.playerId}</div>
                            <div className="text-xs text-[var(--muted)]">{p.team}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Upcoming Picks</CardTitle></CardHeader>
              <CardContent>
                {upcoming.length === 0 ? <p className="text-[var(--muted)]">—</p> : (
                  <ul className="space-y-1">
                    {upcoming.map((u) => {
                      const teamLogo = getTeamLogoPath(u.team);
                      const teamColors = getTeamColors(u.team);
                      return (
                        <li 
                          key={u.overall} 
                          className="flex items-center gap-2 p-1 text-xs rounded"
                          style={{
                            background: `${teamColors.primary}10`,
                            borderLeft: `2px solid ${teamColors.primary}`
                          }}
                        >
                          <div className="w-6 h-6 bg-zinc-800 rounded overflow-hidden flex-shrink-0">
                            {teamLogo && <img src={teamLogo} alt={u.team} className="w-full h-full object-contain" />}
                          </div>
                          <span className="font-semibold">#{u.overall}</span>
                          <span className="text-[var(--muted)]">R{u.round}</span>
                          <span className="flex-1">{u.team}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader><CardTitle>Force Pick</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <Label className="mb-1 block">Search</Label>
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name search" />
                  </div>
                  <div>
                    <Label className="mb-1 block">Position</Label>
                    <Select value={pos} onChange={(e) => setPos(e.target.value)}>
                      <option value="">All</option>
                      {['QB','RB','WR','TE','K'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={async () => {
                      const res = await fetch('/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'available', q: search, pos, limit: 50 }) });
                      const j = await res.json();
                      setAvail(j?.available || []);
                    }}>Search</Button>
                    <Button variant="ghost" onClick={() => setAvail([])}>Clear</Button>
                  </div>
                  <div className="max-h-64 overflow-auto border rounded p-2">
                    <ul className="space-y-1">
                      {avail.map((p) => (
                        <li key={p.id} className="flex items-center justify-between text-sm">
                          <span>{p.name} <span className="text-[var(--muted)]">({p.pos} {p.nfl})</span></span>
                          <Button size="sm" onClick={() => setForcePlayer(p)}>Select</Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {forcePlayer && (
                    <div className="text-sm p-2 bg-blue-50 rounded">
                      Selected: <strong>{forcePlayer.name}</strong> ({forcePlayer.pos} {forcePlayer.nfl})
                    </div>
                  )}
                  <Button disabled={!forcePlayer || busy==='force_pick'} onClick={() => onAdmin('force_pick', { playerId: forcePlayer!.id, playerName: forcePlayer!.name, playerPos: forcePlayer!.pos, playerNfl: forcePlayer!.nfl })}>Force Pick</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Custom Player Pool</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <p className="text-sm">{playersInfo.useCustom ? `Using custom list (${playersInfo.count} players)` : 'Using Sleeper player pool'}</p>
                  {!draft && (
                    <p className="text-xs text-amber-400/90">No active draft — upload saves a reusable pool for next time. After you create a draft, use &quot;Apply saved pool&quot; or upload again to attach it.</p>
                  )}
                  <div>
                    <Label className="mb-1 block">Saved pool</Label>
                    <Select
                      value={selectedPoolId}
                      onChange={(e) => setSelectedPoolId(e.target.value)}
                    >
                      <option value="">New pool on upload…</option>
                      {playerPoolsList.map((p) => (
                        <option key={p.id} value={p.id}>{p.label} — {p.playerCount} players</option>
                      ))}
                    </Select>
                  </div>
                  {!selectedPoolId && (
                    <div>
                      <Label className="mb-1 block">New pool name (optional)</Label>
                      <Input value={newPoolLabel} onChange={(e) => setNewPoolLabel(e.target.value)} placeholder="e.g. Rookie draft 2026" />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!draft || !selectedPoolId || busy !== null}
                      onClick={async () => {
                        if (!draft || !selectedPoolId) return;
                        setBusy('apply_player_pool');
                        try {
                          const res = await fetch('/api/draft', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ action: 'apply_player_pool', id: draft.id, poolId: selectedPoolId }),
                          });
                          const j = await res.json();
                          if (!res.ok || j?.error) throw new Error(j?.error || 'failed');
                          await refreshPlayersInfo();
                          await load(true);
                          alert(`Applied ${j.count ?? ''} players to draft`);
                        } catch (e) {
                          alert((e as Error).message || 'Apply failed');
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >Apply saved pool to draft</Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-400 border border-red-800 hover:bg-red-950/40"
                      disabled={!selectedPoolId || busy !== null}
                      onClick={async () => {
                        if (!selectedPoolId || !confirm('Delete this saved player pool from the library?')) return;
                        setBusy('delete_player_pool');
                        try {
                          const res = await fetch('/api/draft', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ action: 'delete_player_pool', poolId: selectedPoolId }),
                          });
                          const j = await res.json();
                          if (!res.ok || j?.error) throw new Error(j?.error || 'failed');
                          setSelectedPoolId('');
                          await loadAdminWorkspace();
                        } catch (e) {
                          alert((e as Error).message || 'Delete failed');
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >Delete saved pool</Button>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    <p className="mb-2">Accepted formats:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>CSV with header: <strong>id,name,pos,nfl,rank</strong> (nfl and rank optional). Synonyms: <em>player_id / overall_pick / pick</em> for id; <em>player / first_name+last_name</em> for name; <em>position</em> for pos; <em>team / nfl_team</em> for nfl; <em>overall_pick / pick</em> also used as rank. Optional: <em>image_url</em> (headshot URL), <em>video_url</em> (YouTube or direct link) — stored as URL strings, not uploads.</li>
                      <li>JSON array of objects with keys: <strong>id</strong>, <strong>name</strong> (or <em>first_name</em> + <em>last_name</em>), <strong>pos</strong>, optional <strong>nfl</strong>, optional <strong>rank</strong>.</li>
                    </ul>
                  </div>
                  <div>
                    <Label className="mb-1 block">Upload CSV or JSON</Label>
                    <Input id="player-pool-upload" type="file" accept=".csv,.json" className="hidden" onChange={(e) => onUploadPlayers(e.target.files)} />
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={busy==='upload_players'} onClick={() => (document.getElementById('player-pool-upload') as HTMLInputElement | null)?.click()}>Upload</Button>
                    <Button variant="ghost" disabled={!playersInfo.useCustom || busy==='clear_players'} onClick={onClearPlayers}>Clear Custom Players</Button>
                    <Button variant="ghost" onClick={() => {
                      const header = 'id,name,pos,nfl,rank\n';
                      const sample = [
                        'p001,John Doe,RB,SEA,1',
                        'p002,Jane Smith,WR,DAL,2',
                        'p003,Bob Qb,QB,KC,3',
                      ].join('\n');
                      const blob = new Blob([header + sample + '\n'], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'evw-draft-template.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                    }}>Download CSV Template</Button>
                    <Button variant="ghost" onClick={() => {
                      const data = [
                        { id: 'p001', name: 'John Doe', pos: 'RB', nfl: 'SEA', rank: 1 },
                        { id: 'p002', name: 'Jane Smith', pos: 'WR', nfl: 'DAL', rank: 2 },
                        { id: 'p003', name: 'Bob Qb', pos: 'QB', nfl: 'KC', rank: 3 },
                      ];
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'evw-draft-template.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                    }}>Download JSON Template</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        )
      )}

      {isDev && (
        <div className="mt-6 rounded-lg border border-cyan-400/30 bg-cyan-950/20 px-4 py-3 text-xs text-cyan-100">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold tracking-wide uppercase">Dev Poll Metrics (this tab)</div>
            <Button variant="ghost" size="sm" onClick={resetNetMetrics}>Reset</Button>
          </div>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>Requests: <span className="font-bold">{netMetrics.requestCount}</span></div>
            <div>Draft polls: <span className="font-bold">{netMetrics.draftPollCount}</span></div>
            <div>Avail fetches: <span className="font-bold">{netMetrics.availCount}</span></div>
            <div>Trade polls: <span className="font-bold">{netMetrics.tradePollCount}</span></div>
            <div>Approx MB: <span className="font-bold">{(netMetrics.totalBytes / (1024 * 1024)).toFixed(2)}</span></div>
            <div>Approx req/min: <span className="font-bold">{(netMetrics.requestCount / Math.max(1 / 60, (Date.now() - metricsStartAtRef.current) / 60000)).toFixed(1)}</span></div>
            <div>Approx KB/req: <span className="font-bold">{(netMetrics.totalBytes / Math.max(1, netMetrics.requestCount) / 1024).toFixed(1)}</span></div>
            <div>Last revision: <span className="font-bold">{netMetrics.lastRevision}</span></div>
          </div>
        </div>
      )}

      {confirmIntent && (
        <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-base font-black text-white">{confirmIntent.title}</h3>
            </div>
            <div className="px-4 py-4 text-sm text-zinc-300">
              {confirmIntent.message}
            </div>
            <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmIntent(null)}>
                Cancel
              </Button>
              <Button
                variant={confirmIntent.action === 'delete' ? 'danger' : 'primary'}
                size="sm"
                disabled={busy === confirmIntent.action}
                onClick={runConfirmedAction}
              >
                {busy === confirmIntent.action ? 'Working…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

