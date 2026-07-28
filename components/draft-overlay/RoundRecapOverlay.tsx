'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { getTeamLogoPath } from '@/lib/utils/team-utils';
import { getTeamColors } from '@/lib/constants/team-colors';

interface Pick {
  overall: number;
  round: number;
  team: string;
  playerId: string;
  playerName?: string | null;
  playerPos?: string | null;
  playerNfl?: string | null;
  madeAt: string;
}

interface TradeAsset {
  fromTeam: string;
  toTeam: string;
  assetType: string;
  playerName?: string | null;
  playerPos?: string | null;
  pickOverall?: number | null;
  pickYear?: number | null;
  pickRound?: number | null;
}

interface Trade {
  id: string;
  teams: string[];
  notes?: string | null;
  assets: TradeAsset[];
  updatedAt?: string;
}

interface RoundRecapOverlayProps {
  roundNumber: number;
  nextRound: number;
  picks: Pick[];
  draftId: string;
  isAdmin: boolean;
  eventLogoUrl?: string | null;
  eventColor1?: string;
  onStartNextRound: () => void;
  /** 'fullscreen' (default) = fixed inset-0 overlay; 'inline' = normal-flow card that doesn't obscure the page */
  variant?: 'fullscreen' | 'inline';
}

const positionColors: Record<string, string> = {
  QB: '#C00000',
  RB: '#FFC000',
  WR: '#0070C0',
  TE: '#00B050',
  K: '#FF8C42',
  FB: '#9B5DE5',
};

export default function RoundRecapOverlay({
  roundNumber,
  nextRound,
  picks,
  draftId,
  isAdmin,
  eventLogoUrl,
  eventColor1 = '#a4c810',
  onStartNextRound,
  variant = 'fullscreen',
}: RoundRecapOverlayProps) {
  const isInline = variant === 'inline';
  const containerRef = useRef<HTMLDivElement>(null);
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    if (!draftId) return;
    fetch(`/api/draft/trade?action=list_approved&draftId=${encodeURIComponent(draftId)}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.trades) setTrades(data.trades); })
      .catch(() => {});
  }, [draftId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    gsap.fromTo(container, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' });
  }, []);

  // Deduplicate by overall pick number — prevents trade-related ghost entries from inflating count
  const dedupedPicks = picks.filter((p, i, arr) => arr.findIndex(x => x.overall === p.overall) === i);

  // Filter trades to only those that occurred during this round.
  // Primary signal: earliest pick in this round marks when the round began.
  // A trade "belongs to this round" if it was approved at/after that time,
  // OR if one of its assets is a current pick from this round (regardless of timestamp).
  const roundStartMs = dedupedPicks.length > 0
    ? Math.min(...dedupedPicks.map(p => new Date(p.madeAt).getTime()))
    : null;
  const roundTrades = roundStartMs != null
    ? trades.filter(t =>
        t.assets.some(a => a.assetType === 'current_pick' && a.pickRound === roundNumber) ||
        (t.updatedAt != null && new Date(t.updatedAt).getTime() >= roundStartMs)
      )
    : trades;

  const hasTrades = roundTrades.length > 0;

  return (
    <div
      ref={containerRef}
      className={isInline ? 'rounded-xl overflow-hidden' : 'fixed inset-0 z-[9999] flex flex-col'}
      style={{
        background: 'linear-gradient(160deg, #08090c 0%, #0e1117 60%, #0a0c10 100%)',
        willChange: 'opacity',
        ...(isInline ? { border: `1px solid ${eventColor1}44` } : {}),
      }}
    >
      {/* Top bar */}
      <div
        className={`flex items-center justify-between flex-shrink-0 ${isInline ? 'px-5 py-3' : 'px-10 py-6'}`}
        style={{ borderBottom: `${isInline ? 2 : 3}px solid ${eventColor1}` }}
      >
        <div className="flex items-center gap-5">
          {eventLogoUrl && (
            <img src={eventLogoUrl} alt="" className={isInline ? 'w-12 h-12' : 'w-16 h-16'} style={{ objectFit: 'contain', opacity: 0.9 }} />
          )}
          <div>
            <div
              className="font-black uppercase tracking-widest"
              style={{ fontSize: isInline ? '1.4rem' : 'clamp(1.8rem, 3.5vw, 4rem)', color: eventColor1, lineHeight: 1, textShadow: `0 0 20px ${eventColor1}66` }}
            >
              Round {roundNumber} Complete
            </div>
            <div className="text-zinc-400 font-bold tracking-wider mt-0.5" style={{ fontSize: isInline ? '0.875rem' : 'clamp(0.9rem, 1.5vw, 1.2rem)' }}>
              {dedupedPicks.length} picks made
            </div>
          </div>
        </div>
        <div className="text-right">
          {isAdmin ? (
            <button
              onClick={onStartNextRound}
              className="rounded-xl font-black uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
              style={{
                padding: isInline ? '0.75rem 2rem' : 'clamp(0.75rem,1.2vw,1.1rem) clamp(2rem,3.5vw,3.5rem)',
                fontSize: isInline ? '1.25rem' : 'clamp(1.2rem, 2.2vw, 2rem)',
                background: `linear-gradient(135deg, ${eventColor1} 0%, ${eventColor1}aa 100%)`,
                color: '#000',
                boxShadow: `0 4px 24px ${eventColor1}66`,
              }}
            >
              ▶ Start Round {nextRound}
            </button>
          ) : (
            <div className="text-zinc-400 font-bold animate-pulse" style={{ fontSize: isInline ? '0.875rem' : 'clamp(0.9rem, 1.5vw, 1.2rem)' }}>
              Waiting for Commissioner to start Round {nextRound}…
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className={isInline ? 'flex flex-wrap gap-4 p-4' : 'flex-1 flex gap-6 p-6 min-h-0 overflow-hidden'}>
        {/* Picks grid */}
        <div className={`flex flex-col min-w-0 ${hasTrades ? 'flex-[2]' : 'flex-1'}`}>
          <div className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">
            Round {roundNumber} Picks
          </div>
          <div className={`grid gap-2 content-start ${isInline ? '' : 'flex-1 overflow-y-auto'}`} style={{ gridTemplateColumns: isInline ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(auto-fill, minmax(clamp(200px, 16vw, 300px), 1fr))' }}>
            {dedupedPicks.map((pick, i) => {
              const colors = getTeamColors(pick.team);
              const logo = getTeamLogoPath(pick.team);
              const posColor = positionColors[pick.playerPos || ''] || '#666';
              return (
                <div
                  key={pick.overall}
                  className="rounded-lg overflow-hidden flex items-center gap-2"
                  style={{
                    padding: isInline ? '0.5rem 0.75rem' : 'clamp(0.5rem, 0.8vw, 0.9rem) clamp(0.75rem, 1vw, 1.1rem)',
                    background: `linear-gradient(135deg, ${colors.primary}22 0%, #1a1a1a 100%)`,
                    border: `1px solid ${colors.primary}44`,
                    animationDelay: `${i * 0.05}s`,
                  }}
                >
                  {/* Pick # */}
                  <div
                    className="font-black flex-shrink-0 text-center"
                    style={{ color: eventColor1, fontSize: isInline ? '0.75rem' : 'clamp(0.8rem, 1.2vw, 1rem)', minWidth: isInline ? '1.5rem' : 'clamp(1.5rem, 2vw, 2rem)' }}
                  >
                    {pick.overall}
                  </div>
                  {/* Team logo */}
                  {logo && (
                    <img src={logo} alt={pick.team} className={isInline ? 'w-7 h-7' : 'flex-shrink-0 object-contain'} style={isInline ? { objectFit: 'contain' } : { width: 'clamp(28px, 3.5vw, 48px)', height: 'clamp(28px, 3.5vw, 48px)' }} />
                  )}
                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-bold leading-tight truncate" style={{ fontSize: isInline ? '0.75rem' : 'clamp(0.8rem, 1.3vw, 1.05rem)' }}>
                      {pick.playerName || pick.playerId}
                    </div>
                    {pick.playerPos && (
                      <div
                        className="font-black inline-block px-1 rounded mt-0.5"
                        style={{ background: posColor, color: '#fff', fontSize: isInline ? '0.625rem' : 'clamp(0.65rem, 1vw, 0.8rem)' }}
                      >
                        {pick.playerPos}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Trades section */}
        {hasTrades && (
          <div className={`flex flex-col min-w-0 ${isInline ? 'flex-1' : 'flex flex-col flex-1'}`}>
            <div className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">
              Trades This Round
            </div>
            <div className="flex flex-col gap-3">
              {roundTrades.map((trade) => (
                <div
                  key={trade.id}
                  className="rounded-lg p-3"
                  style={{ background: '#1a1a22', border: '1px solid #333' }}
                >
                  {/* Team logos */}
                  <div className="flex items-center gap-2 mb-2">
                    {trade.teams.map((team) => {
                      const logo = getTeamLogoPath(team);
                      const colors = getTeamColors(team);
                      return (
                        <div
                          key={team}
                          className="flex items-center gap-1.5 px-2 py-1 rounded"
                          style={{ background: `${colors.primary}22`, border: `1px solid ${colors.primary}44` }}
                        >
                          {logo && <img src={logo} alt={team} className="w-5 h-5 object-contain" />}
                          <span className="text-[11px] font-bold text-white">{team}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Assets */}
                  <div className="space-y-1">
                    {trade.assets.map((asset, ai) => {
                      const arrow = '→';
                      // assetType can be 'player', 'current_pick', 'future_pick', or legacy 'pick'
                      const isPick = asset.assetType === 'current_pick' || asset.assetType === 'future_pick' || asset.assetType === 'pick';
                      const desc = isPick
                        ? asset.assetType === 'current_pick'
                          ? `Pick Rd ${asset.pickRound ?? '?'} (Overall #${asset.pickOverall ?? '?'})`
                          : `${asset.pickYear ?? '?'} Rd ${asset.pickRound ?? '?'} Pick`
                        : (asset.playerName || 'Unknown Player');
                      return (
                        <div key={ai} className="text-zinc-300 flex items-center gap-1 flex-wrap" style={{ fontSize: isInline ? '0.6875rem' : 'clamp(0.75rem, 1.1vw, 0.9rem)' }}>
                          <span className="font-bold text-white/70">{asset.fromTeam.split(' ').pop()}</span>
                          <span className="text-zinc-500">{arrow}</span>
                          <span className="font-bold text-white/70">{asset.toTeam.split(' ').pop()}</span>
                          <span className="text-zinc-400 ml-1">{desc}</span>
                          {asset.playerPos && (
                            <span
                              className="font-black px-1 rounded"
                              style={{ background: positionColors[asset.playerPos] || '#666', color: '#fff', fontSize: isInline ? '0.5625rem' : 'clamp(0.65rem, 0.9vw, 0.75rem)' }}
                            >
                              {asset.playerPos}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {trade.notes && (
                    <div className="mt-1 text-[10px] text-zinc-500 italic">{trade.notes}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* If no trades — footnote */}
        {!hasTrades && (
          <div className="flex-shrink-0 self-end text-zinc-600 text-xs italic">
            No trades this round
          </div>
        )}
      </div>

      {/* Bottom waiting bar */}
      <div
        className="flex-shrink-0 py-3 text-center font-bold uppercase tracking-widest text-sm"
        style={{ borderTop: `1px solid #333`, color: eventColor1 + '88' }}
      >
        {isAdmin ? 'Click ▶ Start Round to continue the draft' : `Waiting for Commissioner · Round ${nextRound} starts soon`}
      </div>
    </div>
  );
}
