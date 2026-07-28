'use client';
/* eslint-disable @next/next/no-img-element */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getTeamLogoPath } from '@/lib/utils/team-utils';
import { getTeamColors } from '@/lib/constants/team-colors';

// ── Types ──────────────────────────────────────────────────────────────────
type RosterPlayer = { playerId: string; playerName: string | null; playerPos: string | null; playerNfl: string | null };
type FuturePick   = { id: string; ownerTeam: string; originalTeam: string; year: number; round: number };
type CurrentPick  = { overall: number; round: number; team: string };

type SelectedAsset =
  | { kind: 'player';       fromTeam: string; toTeam: string; player: RosterPlayer }
  | { kind: 'current_pick'; fromTeam: string; toTeam: string; pick: CurrentPick }
  | { kind: 'future_pick';  fromTeam: string; toTeam: string; fp: FuturePick };

type TradeAsset = {
  id: string; tradeId: string; fromTeam: string; toTeam: string; assetType: string;
  playerId?: string | null; playerName?: string | null; playerPos?: string | null;
  pickOverall?: number | null; pickYear?: number | null; pickRound?: number | null; pickOriginalTeam?: string | null;
};

type DraftTrade = {
  id: string; draftId: string; status: string; proposedBy: string;
  teams: string[]; acceptedBy: string[]; counterOf?: string | null;
  notes?: string | null; proposedAt: string; updatedAt: string; assets: TradeAsset[];
};

type TeamAssets = { rosterPlayers: RosterPlayer[]; futurePicks: FuturePick[]; currentPicks: CurrentPick[] };

// ── Helpers ────────────────────────────────────────────────────────────────
const POS_COLORS: Record<string, string> = { QB:'#ef4444', RB:'#22c55e', WR:'#3b82f6', TE:'#f97316', K:'#a855f7', DEF:'#6b7280' };
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pending',           color: '#f59e0b' },
  accepted:  { label: 'Awaiting Commish',  color: '#3b82f6' },
  approved:  { label: 'Approved ✓',        color: '#22c55e' },
  rejected:  { label: 'Rejected',          color: '#ef4444' },
  countered: { label: 'Countered',         color: '#8b5cf6' },
  cancelled: { label: 'Cancelled',         color: '#6b7280' },
};


function AssetPill({ asset, onRemove }: { asset: SelectedAsset; onRemove?: () => void }) {
  if (asset.kind === 'player') {
    const p = asset.player;
    return (
      <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full px-2.5 py-1 text-xs">
        <span className="font-black px-1 py-0.5 rounded text-white text-[10px]" style={{ background: POS_COLORS[p.playerPos || ''] || '#555' }}>{p.playerPos || '?'}</span>
        <span className="text-white font-medium">{p.playerName || p.playerId}</span>
        {p.playerNfl && <span className="text-zinc-400">{p.playerNfl}</span>}
        {onRemove && <button onClick={onRemove} className="ml-1 text-zinc-400 hover:text-red-400 font-bold">×</button>}
      </div>
    );
  }
  if (asset.kind === 'current_pick') {
    const pk = asset.pick;
    const pickInRound = ((pk.overall - 1) % 12) + 1;
    return (
      <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full px-2.5 py-1 text-xs">
        <span className="text-yellow-400 font-black">⦿</span>
        <span className="text-white font-medium">Rd {pk.round} Pk {pickInRound}</span>
        <span className="text-zinc-400">(#{pk.overall})</span>
        {onRemove && <button onClick={onRemove} className="ml-1 text-zinc-400 hover:text-red-400 font-bold">×</button>}
      </div>
    );
  }
  const fp = asset.fp;
  return (
    <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full px-2.5 py-1 text-xs">
      <span className="text-sky-400 font-black">◈</span>
      <span className="text-white font-medium">{fp.year} Rd {fp.round}</span>
      {fp.originalTeam !== fp.ownerTeam && <span className="text-zinc-400">({fp.originalTeam.split(' ').pop()})</span>}
      {onRemove && <button onClick={onRemove} className="ml-1 text-zinc-400 hover:text-red-400 font-bold">×</button>}
    </div>
  );
}

function TradeSummary({ teams, assets, myTeam, allTeamLogos }: { teams: string[]; assets: SelectedAsset[]; myTeam: string; allTeamLogos: Record<string, string | null> }) {
  return (
    <div className="flex gap-3">
      {teams.map((team) => {
        const sending = assets.filter(a => a.fromTeam === team);
        const receiving = assets.filter(a => a.toTeam === team);
        const colors = getTeamColors(team);
        const isMe = team === myTeam;
        return (
          <div key={team} className="flex-1 rounded-xl border border-zinc-700 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2" style={{ background: `linear-gradient(135deg, ${colors.primary}99, ${colors.secondary}88)` }}>
              {allTeamLogos[team] && <img src={allTeamLogos[team]!} alt={team} className="w-6 h-6 object-contain" />}
              <span className="text-white font-black text-sm truncate">{team}{isMe ? ' (You)' : ''}</span>
            </div>
            <div className="p-2 bg-zinc-900/60 space-y-1.5">
              <div className="text-[10px] font-bold text-zinc-500 uppercase">Sends</div>
              {sending.length === 0 ? <div className="text-[11px] text-zinc-600 italic">Nothing</div>
                : sending.map((a, i) => <AssetPill key={i} asset={a} />)}
              <div className="text-[10px] font-bold text-zinc-500 uppercase mt-2">Receives</div>
              {receiving.length === 0 ? <div className="text-[11px] text-zinc-600 italic">Nothing</div>
                : receiving.map((a, i) => <AssetPill key={i} asset={a} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── TeamAssetPicker ─────────────────────────────────────────────────────────
function TeamAssetPicker({
  team, assets, selectedAssets, otherTeams, onToggle, onSetToTeam, disabled
}: {
  team: string; assets: TeamAssets; selectedAssets: SelectedAsset[];
  otherTeams: string[]; onToggle: (a: SelectedAsset) => void;
  onSetToTeam?: (assetKey: string, fromTeam: string, newToTeam: string) => void;
  disabled?: boolean;
}) {
  const defaultToTeam = otherTeams[0] || '';
  const colors = getTeamColors(team);
  const logo = getTeamLogoPath(team);
  const [tab, setTab] = useState<'players' | 'picks'>('players');

  const getToTeam = (id: string) => selectedAssets.find(a =>
    (a.kind === 'player' && a.player.playerId === id && a.fromTeam === team) ||
    (a.kind === 'current_pick' && String(a.pick.overall) === id && a.fromTeam === team) ||
    (a.kind === 'future_pick' && a.fp.id === id && a.fromTeam === team)
  )?.toTeam ?? defaultToTeam;

  const isSelected = (id: string) => selectedAssets.some(a =>
    (a.kind === 'player' && a.player.playerId === id && a.fromTeam === team) ||
    (a.kind === 'current_pick' && String(a.pick.overall) === id && a.fromTeam === team) ||
    (a.kind === 'future_pick' && a.fp.id === id && a.fromTeam === team)
  );

  return (
    <div className="rounded-xl border border-zinc-700 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: `linear-gradient(135deg, ${colors.primary}cc, ${colors.secondary}aa)` }}>
        <img src={logo} alt={team} className="w-7 h-7 object-contain" />
        <span className="text-white font-black text-sm flex-1 truncate">{team}</span>
        {otherTeams.length > 1 && (
          <span className="text-white/40 text-[10px] italic">select → dest per asset</span>
        )}
      </div>

      <div className="flex border-b border-zinc-800">
        {['players','picks'].map(t => (
          <button key={t} onClick={() => setTab(t as 'players' | 'picks')}
            className={`flex-1 text-[11px] font-bold py-1.5 uppercase tracking-wide ${tab === t ? 'text-white border-b-2 border-yellow-400' : 'text-zinc-500'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto max-h-48 p-1 space-y-0.5 bg-zinc-950">
        {tab === 'players' && (
          assets.rosterPlayers.length === 0
            ? <div className="text-xs text-zinc-600 italic p-2">No roster data yet</div>
            : assets.rosterPlayers.map(p => {
              const sel = isSelected(p.playerId);
              return (
                <button key={p.playerId} disabled={disabled}
                  onClick={() => !sel && onToggle({ kind: 'player', fromTeam: team, toTeam: defaultToTeam, player: p })}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${sel ? 'bg-yellow-400/20 border border-yellow-400/40' : 'hover:bg-zinc-800'}`}>
                  <button type="button" disabled={disabled} onClick={e => { e.stopPropagation(); if (sel) onToggle({ kind: 'player', fromTeam: team, toTeam: getToTeam(p.playerId), player: p }); }}
                    className="shrink-0 text-[10px] font-black px-1 py-0.5 rounded text-white" style={{ background: POS_COLORS[p.playerPos || ''] || '#555' }}>{p.playerPos || '?'}</button>
                  <span className="text-white text-xs font-medium truncate">{p.playerName || p.playerId}</span>
                  {p.playerNfl && <span className="text-zinc-500 text-[10px] shrink-0">{p.playerNfl}</span>}
                  {sel && otherTeams.length === 1 && <span className="ml-auto text-yellow-400 font-bold text-xs shrink-0">✓</span>}
                  {sel && otherTeams.length > 1 && (
                    <select value={getToTeam(p.playerId)} onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); onSetToTeam?.(p.playerId, team, e.target.value); }}
                      className="ml-auto text-[10px] bg-zinc-900 text-white border border-yellow-400/50 rounded px-1 py-0.5 shrink-0">
                      {otherTeams.map(t => <option key={t} value={t}>→ {t}</option>)}
                    </select>
                  )}
                </button>
              );
            })
        )}
        {tab === 'picks' && (
          <>
            {assets.currentPicks.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-bold text-zinc-500 uppercase">This Draft</div>
                {assets.currentPicks.map(pk => {
                  const sel = isSelected(String(pk.overall));
                  return (
                    <button key={pk.overall} disabled={disabled}
                      onClick={() => onToggle({ kind: 'current_pick', fromTeam: team, toTeam: sel ? getToTeam(String(pk.overall)) : defaultToTeam, pick: pk })}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${sel ? 'bg-yellow-400/20 border border-yellow-400/40' : 'hover:bg-zinc-800'}`}>
                      <span className="text-yellow-400 font-black text-sm">⦿</span>
                      <span className="text-white text-xs font-medium">Rd {pk.round} Pk {((pk.overall - 1) % 12) + 1}</span>
                      <span className="text-zinc-500 text-[10px]">(#{pk.overall})</span>
                      {sel && otherTeams.length === 1 && <span className="ml-auto text-yellow-400 font-bold text-xs">✓</span>}
                      {sel && otherTeams.length > 1 && (
                        <select value={getToTeam(String(pk.overall))} onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); onSetToTeam?.(String(pk.overall), team, e.target.value); }}
                          className="ml-auto text-[10px] bg-zinc-900 text-white border border-yellow-400/50 rounded px-1 py-0.5 shrink-0">
                          {otherTeams.map(t => <option key={t} value={t}>→ {t}</option>)}
                        </select>
                      )}
                    </button>
                  );
                })}
              </>
            )}
            {assets.futurePicks.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-bold text-zinc-500 uppercase mt-1">Future Picks</div>
                {assets.futurePicks.map(fp => {
                  const sel = isSelected(fp.id);
                  return (
                    <button key={fp.id} disabled={disabled}
                      onClick={() => onToggle({ kind: 'future_pick', fromTeam: team, toTeam: sel ? getToTeam(fp.id) : defaultToTeam, fp })}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${sel ? 'bg-yellow-400/20 border border-yellow-400/40' : 'hover:bg-zinc-800'}`}>
                      <span className="text-sky-400 font-black text-sm">◈</span>
                      <span className="text-white text-xs font-medium">{fp.year} Round {fp.round}</span>
                      {fp.originalTeam !== fp.ownerTeam && <span className="text-zinc-500 text-[10px]">via {fp.originalTeam}</span>}
                      {sel && otherTeams.length === 1 && <span className="ml-auto text-yellow-400 font-bold text-xs">✓</span>}
                      {sel && otherTeams.length > 1 && (
                        <select value={getToTeam(fp.id)} onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); onSetToTeam?.(fp.id, team, e.target.value); }}
                          className="ml-auto text-[10px] bg-zinc-900 text-white border border-yellow-400/50 rounded px-1 py-0.5 shrink-0">
                          {otherTeams.map(t => <option key={t} value={t}>→ {t}</option>)}
                        </select>
                      )}
                    </button>
                  );
                })}
              </>
            )}
            {assets.currentPicks.length === 0 && assets.futurePicks.length === 0 && (
              <div className="text-xs text-zinc-600 italic p-2">No picks available</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── TradeCard ───────────────────────────────────────────────────────────────
function TradeCard({ trade, myTeam, onAccept, onReject, onCounter, onCancel, allTeamLogos }: {
  trade: DraftTrade; myTeam: string;
  onAccept?: () => void; onReject?: () => void; onCounter?: () => void; onCancel?: () => void;
  allTeamLogos: Record<string, string | null>;
}) {
  const statusInfo = STATUS_LABEL[trade.status] || { label: trade.status, color: '#fff' };
  const isIncoming = trade.proposedBy !== myTeam && trade.status === 'pending' && !trade.acceptedBy.includes(myTeam);
  const needsMyAcceptance = trade.teams.includes(myTeam) && !trade.acceptedBy.includes(myTeam) && trade.status === 'pending';
  const isMine = trade.proposedBy === myTeam;

  // Group assets by fromTeam
  const byFromTeam: Record<string, TradeAsset[]> = {};
  for (const a of trade.assets) {
    if (!byFromTeam[a.fromTeam]) byFromTeam[a.fromTeam] = [];
    byFromTeam[a.fromTeam].push(a);
  }

  function renderAsset(a: TradeAsset) {
    if (a.assetType === 'player') {
      return (
        <div key={a.id} className="flex items-center gap-1.5 text-xs">
          {a.playerPos && <span className="font-black px-1 py-0.5 rounded text-white text-[10px]" style={{ background: POS_COLORS[a.playerPos] || '#555' }}>{a.playerPos}</span>}
          <span className="text-white">{a.playerName || a.playerId}</span>
          <span className="text-zinc-400 text-[10px]">→ {a.toTeam}</span>
        </div>
      );
    }
    if (a.assetType === 'current_pick') {
      const pickInRound = a.pickOverall != null ? ((a.pickOverall - 1) % 12) + 1 : null;
      return (
        <div key={a.id} className="flex items-center gap-1.5 text-xs">
          <span className="text-yellow-400 font-black">⦿</span>
          <span className="text-white">Rd {a.pickRound} Pk {pickInRound ?? '?'} (#{a.pickOverall})</span>
          <span className="text-zinc-400 text-[10px]">→ {a.toTeam}</span>
        </div>
      );
    }
    return (
      <div key={a.id} className="flex items-center gap-1.5 text-xs">
        <span className="text-sky-400 font-black">◈</span>
        <span className="text-white">{a.pickYear} Rd {a.pickRound}{a.pickOriginalTeam && a.pickOriginalTeam !== a.fromTeam ? ` (${a.pickOriginalTeam})` : ''}</span>
        <span className="text-zinc-400 text-[10px]">→ {a.toTeam}</span>
      </div>
    );
  }

  const needsAcceptanceFrom = trade.teams.filter(t => !trade.acceptedBy.includes(t));

  return (
    <div className={`rounded-xl border overflow-hidden ${isIncoming || needsMyAcceptance ? 'border-yellow-400/50 shadow-lg shadow-yellow-400/10' : 'border-zinc-700'}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/80">
        <div className="flex -space-x-2">
          {trade.teams.map(t => allTeamLogos[t] && (
            <img key={t} src={allTeamLogos[t]!} alt={t} className="w-6 h-6 rounded-full border-2 border-zinc-800 object-contain bg-zinc-900" />
          ))}
        </div>
        <span className="text-white/70 text-xs flex-1 truncate">
          {trade.teams.join(' ↔ ')}
        </span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: statusInfo.color + '22', color: statusInfo.color }}>
          {statusInfo.label}
        </span>
      </div>

      {/* Asset breakdown */}
      <div className="p-3 space-y-2 bg-zinc-900/50">
        {Object.entries(byFromTeam).map(([from, assets]) => (
          <div key={from}>
            <div className="flex items-center gap-1.5 mb-1">
              {allTeamLogos[from] && <img src={allTeamLogos[from]!} alt={from} className="w-4 h-4 object-contain" />}
              <span className="text-[11px] font-bold text-zinc-400">{from} sends:</span>
            </div>
            <div className="pl-5 space-y-0.5">{assets.map(renderAsset)}</div>
          </div>
        ))}
        {trade.notes && (
          <div className="text-[11px] text-zinc-400 italic border-t border-zinc-800 pt-2">&ldquo;{trade.notes}&rdquo;</div>
        )}
        {trade.status === 'pending' && needsAcceptanceFrom.length > 0 && (
          <div className="text-[10px] text-zinc-500 border-t border-zinc-800 pt-1.5">
            Waiting on: {needsAcceptanceFrom.join(', ')}
          </div>
        )}
        <div className="text-[10px] text-zinc-600">
          {new Date(trade.proposedAt).toLocaleString()}
        </div>
      </div>

      {/* Actions */}
      {(needsMyAcceptance || (isMine && ['pending','accepted'].includes(trade.status))) && (
        <div className="flex gap-2 px-3 py-2 bg-zinc-800/60 border-t border-zinc-700">
          {needsMyAcceptance && (
            <>
              <button onClick={onAccept} className="flex-1 text-xs font-bold py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white transition-colors">Accept</button>
              <button onClick={onCounter} className="flex-1 text-xs font-bold py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors">Counter</button>
              <button onClick={onReject} className="flex-1 text-xs font-bold py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white transition-colors">Reject</button>
            </>
          )}
          {isMine && ['pending','accepted'].includes(trade.status) && (
            <button onClick={onCancel} className="flex-1 text-xs font-bold py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white transition-colors">Cancel Offer</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function DraftTradeCenter({
  myTeam,
  allTeams,
  draftId,
  eventColor1,
  onClose,
  embedded = false,
}: {
  myTeam: string;
  allTeams: string[];
  draftId: string;
  eventColor1?: string;
  onClose: () => void;
  /** When true, renders inline (e.g. draft room tab) instead of a full-screen modal overlay. */
  embedded?: boolean;
}) {
  const ec1 = eventColor1 || '#a4c810';

  // Tabs
  const [tab, setTab] = useState<'propose' | 'inbox' | 'sent' | 'history'>('inbox');

  // Trades
  const [trades, setTrades] = useState<DraftTrade[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(true);

  // Team assets cache
  const [assetsCache, setAssetsCache] = useState<Record<string, TeamAssets>>({});
  const [loadingAssets, setLoadingAssets] = useState<Record<string, boolean>>({});
  const approvedTradeCountRef = useRef(0);

  // Propose state
  const [partnerTeams, setPartnerTeams] = useState<string[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<SelectedAsset[]>([]);
  const [notes, setNotes] = useState('');
  const [counterOfId, setCounterOfId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [tradeSent, setTradeSent] = useState(false);

  // Team logos pre-computed
  const allTeamLogos = Object.fromEntries(allTeams.map(t => [t, getTeamLogoPath(t)]));

  // Fetch trades
  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`/api/draft/trade?action=get_team&team=${encodeURIComponent(myTeam)}&draftId=${draftId}`);
      const data = await res.json();
      const nextTrades = (data.trades as DraftTrade[]) || [];
      setTrades(nextTrades);
      const approvedCount = nextTrades.filter((t) => t.status === 'approved').length;
      if (approvedCount !== approvedTradeCountRef.current) {
        approvedTradeCountRef.current = approvedCount;
        // Invalidate cached team assets after newly approved trades so newly acquired players/picks show.
        setAssetsCache({});
      }
    } catch {}
    finally { setLoadingTrades(false); }
  }, [myTeam, draftId]);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  // Poll every 10s
  useEffect(() => {
    const id = setInterval(fetchTrades, 10000);
    return () => clearInterval(id);
  }, [fetchTrades]);

  // Fetch assets for a team
  const fetchAssets = useCallback(async (team: string) => {
    if (assetsCache[team] || loadingAssets[team]) return;
    setLoadingAssets(prev => ({ ...prev, [team]: true }));
    try {
      const res = await fetch(`/api/draft/trade?action=get_assets&team=${encodeURIComponent(team)}&draftId=${draftId}`);
      const data = await res.json();
      setAssetsCache(prev => ({ ...prev, [team]: data as TeamAssets }));
    } catch {}
    finally { setLoadingAssets(prev => ({ ...prev, [team]: false })); }
  }, [assetsCache, loadingAssets, draftId]);

  // When propose tab is opened, invalidate asset cache to force fresh pick/player data
  const prevTabRef = useRef(tab);
  useEffect(() => {
    if (tab === 'propose' && prevTabRef.current !== 'propose') {
      setAssetsCache({});
    }
    prevTabRef.current = tab;
  }, [tab]);

  // When propose tab is open, fetch assets for all teams in the trade
  useEffect(() => {
    if (tab !== 'propose') return;
    const teamsInTrade = [myTeam, ...partnerTeams];
    for (const t of teamsInTrade) fetchAssets(t);
  }, [tab, myTeam, partnerTeams, fetchAssets]);

  // Fetch assets when partner added
  useEffect(() => {
    for (const t of partnerTeams) fetchAssets(t);
  }, [partnerTeams, fetchAssets]);

  // Also pre-fetch my own assets
  useEffect(() => { fetchAssets(myTeam); }, [myTeam, fetchAssets]);

  // Toggle asset
  function handleSetToTeam(assetKey: string, fromTeam: string, newToTeam: string) {
    setSelectedAssets(prev => prev.map(a => {
      const key = a.kind === 'player' ? a.player.playerId
                 : a.kind === 'current_pick' ? String(a.pick.overall)
                 : a.fp.id;
      if (key === assetKey && a.fromTeam === fromTeam) return { ...a, toTeam: newToTeam };
      return a;
    }));
  }

  function toggleAsset(a: SelectedAsset) {
    const key = a.kind === 'player' ? a.player.playerId : a.kind === 'current_pick' ? String(a.pick.overall) : a.fp.id;
    setSelectedAssets(prev => {
      const existing = prev.findIndex(x =>
        (x.kind === 'player' && a.kind === 'player' && x.player.playerId === key && x.fromTeam === a.fromTeam) ||
        (x.kind === 'current_pick' && a.kind === 'current_pick' && String(x.pick.overall) === key && x.fromTeam === a.fromTeam) ||
        (x.kind === 'future_pick' && a.kind === 'future_pick' && x.fp.id === key && x.fromTeam === a.fromTeam)
      );
      if (existing >= 0) return prev.filter((_, i) => i !== existing);
      return [...prev, a];
    });
  }

  function addPartner(team: string) {
    if (partnerTeams.includes(team) || team === myTeam || partnerTeams.length >= 2) return;
    setPartnerTeams(p => [...p, team]);
  }
  function removePartner(team: string) {
    setPartnerTeams(p => p.filter(t => t !== team));
    setSelectedAssets(s => s.filter(a => a.fromTeam !== team && a.toTeam !== team));
  }

  function openCounter(trade: DraftTrade) {
    setCounterOfId(trade.id);
    setSelectedAssets([]);
    setNotes('');
    const otherTeams = trade.teams.filter(t => t !== myTeam);
    setPartnerTeams(otherTeams.slice(0, 2));
    setTab('propose');
  }

  async function submitTrade() {
    if (partnerTeams.length === 0) { setSubmitMsg('Select at least one partner team.'); return; }
    if (selectedAssets.length === 0) { setSubmitMsg('Add at least one asset to the trade.'); return; }
    setSubmitting(true); setSubmitMsg('');
    const teams = [myTeam, ...partnerTeams];
    const assets = selectedAssets.map(a => {
      if (a.kind === 'player') return { fromTeam: a.fromTeam, toTeam: a.toTeam, assetType: 'player' as const, playerId: a.player.playerId, playerName: a.player.playerName, playerPos: a.player.playerPos };
      if (a.kind === 'current_pick') return { fromTeam: a.fromTeam, toTeam: a.toTeam, assetType: 'current_pick' as const, pickOverall: a.pick.overall, pickRound: a.pick.round };
      return { fromTeam: a.fromTeam, toTeam: a.toTeam, assetType: 'future_pick' as const, pickYear: a.fp.year, pickRound: a.fp.round, pickOriginalTeam: a.fp.originalTeam };
    });
    try {
      const res = await fetch('/api/draft/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'propose', draftId, proposedBy: myTeam, teams, assets, notes: notes || null, counterOf: counterOfId }),
      });
      const data = await res.json();
      if (data.ok) {
        setSelectedAssets([]); setNotes(''); setCounterOfId(null); setPartnerTeams([]);
        await fetchTrades();
        setTradeSent(true);
        setTimeout(() => { setTradeSent(false); setTab('sent'); }, 3000);
      } else { setSubmitMsg(data.error || 'Failed to submit.'); }
    } catch { setSubmitMsg('Network error.'); }
    finally { setSubmitting(false); }
  }

  async function doAction(action: string, tradeId: string) {
    await fetch('/api/draft/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, draftId, tradeId, team: myTeam }),
    });
    await fetchTrades();
  }

  // Derived trade lists
  const sent    = trades.filter(t => ['pending','accepted'].includes(t.status));
  const history = trades.filter(t => ['rejected','countered','approved','cancelled'].includes(t.status));
  const displayInbox = trades.filter(t => t.status === 'pending' && t.teams.includes(myTeam) && !t.acceptedBy.includes(myTeam));

  const teamsInTrade = [myTeam, ...partnerTeams];
  const availablePartners = allTeams.filter(t => t !== myTeam && !partnerTeams.includes(t));

  return (
    <div
      className={
        embedded
          ? 'flex flex-col flex-1 min-h-0 max-h-[min(560px,72vh)] rounded-xl overflow-hidden border border-zinc-700 bg-[#0a0a0c]'
          : 'fixed inset-0 z-[200] flex flex-col'
      }
      style={embedded ? undefined : { background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(4px)' }}
    >

      {/* Trade Sent success overlay */}
      {tradeSent && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center" style={{ background: 'rgba(0,0,0,0.92)' }}>
          <div className="text-7xl mb-6 animate-bounce">🤝</div>
          <div className="text-4xl font-black text-white mb-2">Trade Offer Sent!</div>
          <div className="text-zinc-400 text-lg mb-6">All partners will be notified to accept or counter.</div>
          <div className="flex items-center gap-2 text-sm" style={{ color: ec1 }}>
            <span className="animate-spin inline-block">⟳</span>
            <span>Redirecting to Sent tab…</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800" style={{ background: '#0f0f12' }}>
        <div className="flex items-center gap-3">
          <span className="text-lg font-black text-white tracking-tight">Trade Center</span>
          <span className="text-xs text-zinc-400">— {myTeam}</span>
        </div>
        {!embedded && (
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white text-2xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors">×</button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-900/50">
        {([
          { id: 'inbox',   label: 'Inbox',   badge: displayInbox.length },
          { id: 'propose', label: counterOfId ? 'Counter' : 'Propose', badge: 0 },
          { id: 'sent',    label: 'Sent',    badge: sent.length },
          { id: 'history', label: 'History', badge: 0 },
        ] as const).map(({ id, label, badge }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold uppercase tracking-wider transition-colors relative
              ${tab === id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {label}
            {badge > 0 && <span className="w-4 h-4 rounded-full text-[10px] font-black text-black flex items-center justify-center" style={{ background: ec1 }}>{badge}</span>}
            {tab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: ec1 }} />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── INBOX ── */}
        {tab === 'inbox' && (
          <div className="p-4 space-y-3 max-w-3xl mx-auto">
            {loadingTrades && <div className="text-zinc-500 text-sm text-center py-8">Loading trades…</div>}
            {!loadingTrades && displayInbox.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">📭</div>
                <div className="text-zinc-400 font-bold">No pending trade offers</div>
                <div className="text-zinc-600 text-sm mt-1">Propose a trade to get started</div>
              </div>
            )}
            {displayInbox.map(trade => (
              <TradeCard key={trade.id} trade={trade} myTeam={myTeam} allTeamLogos={allTeamLogos}
                onAccept={() => doAction('accept', trade.id)}
                onReject={() => doAction('reject', trade.id)}
                onCounter={() => openCounter(trade)}
                onCancel={() => doAction('cancel', trade.id)}
              />
            ))}
          </div>
        )}

        {/* ── PROPOSE ── */}
        {tab === 'propose' && (
          <div className="p-4 space-y-4 max-w-4xl mx-auto">
            {counterOfId && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm" style={{ background: '#8b5cf622', border: '1px solid #8b5cf644' }}>
                <span className="text-purple-400 font-bold">↩ Countering trade</span>
                <button onClick={() => setCounterOfId(null)} className="ml-auto text-zinc-500 hover:text-white text-xs">Clear counter</button>
              </div>
            )}

            {/* Partner selection */}
            <div>
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-2">Trading Partners {partnerTeams.length < 2 && <span className="text-zinc-600 normal-case">(up to 2 for 3-team trade)</span>}</div>
              <div className="flex flex-wrap gap-2">
                {partnerTeams.map(t => (
                  <div key={t} className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-full pl-2 pr-1 py-1">
                    <img src={getTeamLogoPath(t)} alt={t} className="w-5 h-5 object-contain" />
                    <span className="text-white text-xs font-bold">{t}</span>
                    <button onClick={() => removePartner(t)} className="text-zinc-500 hover:text-red-400 font-black text-sm w-5 h-5 flex items-center justify-center rounded-full hover:bg-red-400/10">×</button>
                  </div>
                ))}
                {partnerTeams.length < 2 && (
                  <select className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-full px-3 py-1 cursor-pointer"
                    value="" onChange={e => { if (e.target.value) addPartner(e.target.value); }}>
                    <option value="">+ Add team…</option>
                    {availablePartners.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* Asset pickers */}
            {partnerTeams.length > 0 && (
              <div className={`grid gap-4 ${teamsInTrade.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {teamsInTrade.map(team => {
                  const others = teamsInTrade.filter(t => t !== team);
                  const assets = assetsCache[team] || { rosterPlayers: [], futurePicks: [], currentPicks: [] };
                  const loading = loadingAssets[team];
                  return loading ? (
                    <div key={team} className="rounded-xl border border-zinc-700 p-4 text-center text-zinc-500 text-xs">Loading assets…</div>
                  ) : (
                    <TeamAssetPicker key={team} team={team} assets={assets} selectedAssets={selectedAssets}
                      otherTeams={others} onToggle={toggleAsset} onSetToTeam={handleSetToTeam} disabled={submitting} />
                  );
                })}
              </div>
            )}

            {/* Summary */}
            {selectedAssets.length > 0 && partnerTeams.length > 0 && (
              <div className="rounded-xl border border-zinc-700 p-3 bg-zinc-900/50">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wide mb-2">Trade Summary</div>
                <TradeSummary teams={teamsInTrade} assets={selectedAssets} myTeam={myTeam} allTeamLogos={allTeamLogos} />
              </div>
            )}

            {/* Notes + Submit */}
            {partnerTeams.length > 0 && (
              <div className="space-y-3">
                <textarea
                  value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Optional message to trading partners…"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
                  rows={2}
                />
                {submitMsg && (
                  <div className={`text-sm font-bold px-3 py-2 rounded-lg ${submitMsg.includes('sent') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {submitMsg}
                  </div>
                )}
                <button onClick={submitTrade} disabled={submitting || partnerTeams.length === 0 || selectedAssets.length === 0}
                  className="w-full py-2.5 rounded-xl font-black text-black text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
                  style={{ background: ec1 }}>
                  {submitting ? 'Sending…' : counterOfId ? 'Send Counter Offer' : 'Send Trade Offer'}
                </button>
              </div>
            )}

            {partnerTeams.length === 0 && (
              <div className="text-center py-10">
                <div className="text-4xl mb-3">🤝</div>
                <div className="text-zinc-400 font-bold">Select a trading partner above to start</div>
              </div>
            )}
          </div>
        )}

        {/* ── SENT ── */}
        {tab === 'sent' && (
          <div className="p-4 space-y-3 max-w-3xl mx-auto">
            {loadingTrades && <div className="text-zinc-500 text-sm text-center py-8">Loading…</div>}
            {!loadingTrades && sent.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">📤</div>
                <div className="text-zinc-400 font-bold">No active outgoing offers</div>
              </div>
            )}
            {sent.map(trade => (
              <TradeCard key={trade.id} trade={trade} myTeam={myTeam} allTeamLogos={allTeamLogos}
                onAccept={() => doAction('accept', trade.id)}
                onReject={() => doAction('reject', trade.id)}
                onCounter={() => openCounter(trade)}
                onCancel={() => doAction('cancel', trade.id)}
              />
            ))}
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === 'history' && (
          <div className="p-4 space-y-3 max-w-3xl mx-auto">
            {loadingTrades && <div className="text-zinc-500 text-sm text-center py-8">Loading…</div>}
            {!loadingTrades && history.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">📋</div>
                <div className="text-zinc-400 font-bold">No completed or rejected trades yet</div>
              </div>
            )}
            {history.map(trade => (
              <TradeCard key={trade.id} trade={trade} myTeam={myTeam} allTeamLogos={allTeamLogos} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
