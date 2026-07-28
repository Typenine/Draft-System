'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { getTeamLogoPath } from '@/lib/utils/team-utils';
import { getTeamColors } from '@/lib/constants/team-colors';
import { DRAFT_TRADE_ALERT_AUDIO_SRC } from '@/components/draft-overlay/draft-display-utils';

export type TradeAnimAsset = {
  fromTeam: string;
  toTeam: string;
  assetType: 'player' | 'current_pick' | 'future_pick';
  playerName?: string | null;
  playerPos?: string | null;
  pickOverall?: number | null;
  pickYear?: number | null;
  pickRound?: number | null;
  pickOriginalTeam?: string | null;
};

interface DraftTradeAnimationProps {
  teams: string[];
  assets: TradeAnimAsset[];
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  picksPerRound?: number;
  onComplete?: () => void;
}

const POS_COLORS: Record<string, string> = { QB:'#ef4444', RB:'#22c55e', WR:'#3b82f6', TE:'#f97316', K:'#a855f7', DEF:'#6b7280' };
const TRADE_ALERT_LEAD_IN_MS = 3000;

type TradeAudioWindow = Window & {
  __tradeAlertAudioAt?: number;
  __evwTradeAudioCtx?: AudioContext;
  __evwTradeAudioUnlocked?: boolean;
};

function shouldPlayTradeAlertLeadIn() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  return path.startsWith('/draft/overlay') || path.startsWith('/draft/room/team') || path.startsWith('/admin/draft');
}

function getTradeAudioContext() {
  if (typeof window === 'undefined') return null;
  const w = window as TradeAudioWindow;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!w.__evwTradeAudioCtx) w.__evwTradeAudioCtx = new AudioCtx();
  return w.__evwTradeAudioCtx;
}

function playSyntheticTickerSound() {
  const ctx = getTradeAudioContext();
  if (!ctx) return;

  try {
    void ctx.resume();
    const now = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.32, now + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
    master.connect(ctx.destination);

    [880, 1175, 1568, 1175].forEach((freq, idx) => {
      const start = now + idx * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.55, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.14);
    });
  } catch {
    // If the browser blocks Web Audio too, the visual trade alert still runs.
  }
}

async function playTradeAlertSound() {
  if (typeof window === 'undefined') return;
  const w = window as TradeAudioWindow;
  if (w.__tradeAlertAudioAt && Date.now() - w.__tradeAlertAudioAt < 2500) return;
  w.__tradeAlertAudioAt = Date.now();

  try {
    const audio = new Audio(DRAFT_TRADE_ALERT_AUDIO_SRC);
    audio.preload = 'auto';
    audio.volume = 1;
    await audio.play();
    window.setTimeout(() => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }, 10_000);
    return;
  } catch {
    // Autoplay can still be blocked on a display with no prior user gesture.
  }

  playSyntheticTickerSound();
}

function AcquiredAsset({ asset, ec1, picksPerRound = 12 }: { asset: TradeAnimAsset; ec1: string; picksPerRound?: number }) {
  const fromLogo = getTeamLogoPath(asset.fromTeam);

  const pickInRound = asset.pickOverall != null
    ? ((asset.pickOverall - 1) % picksPerRound) + 1
    : null;

  const name =
    asset.assetType === 'player' ? (asset.playerName || '—') :
    asset.assetType === 'current_pick'
      ? `Rd ${asset.pickRound ?? '?'} · Pk ${pickInRound ?? '?'} · Overall #${asset.pickOverall}`
      : `${asset.pickYear ?? '?'} · Rd ${asset.pickRound ?? '?'} Pick`;

  const sub =
    asset.assetType === 'future_pick' && asset.pickOriginalTeam && asset.pickOriginalTeam !== asset.fromTeam
      ? `via ${asset.pickOriginalTeam}` : null;

  return (
    <div className="gtrade-asset-row flex items-center gap-5 rounded-2xl px-6 py-4" style={{
      background: 'rgba(0,0,0,0.65)',
      border: '1px solid rgba(255,255,255,0.18)',
    }}>
      {/* Position badge or pick icon, large enough to read at TV distance */}
      {asset.assetType === 'player' && asset.playerPos ? (
        <span className="font-black px-4 py-2 rounded-xl flex-shrink-0 text-white"
          style={{ background: POS_COLORS[asset.playerPos] || '#555', fontSize: 'clamp(1.2rem,2.2vw,1.8rem)', minWidth: '68px', textAlign: 'center', lineHeight: 1.3, boxShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
          {asset.playerPos}
        </span>
      ) : asset.assetType === 'current_pick' ? (
        <span className="font-black flex-shrink-0" style={{ color: ec1, fontSize: 'clamp(2.4rem,4vw,3.4rem)', lineHeight: 1, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.8))' }}>⦿</span>
      ) : (
        <span className="font-black flex-shrink-0 text-sky-400" style={{ fontSize: 'clamp(2.4rem,4vw,3.4rem)', lineHeight: 1, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.8))' }}>◈</span>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-black text-white leading-tight" style={{
          fontSize: 'clamp(1.8rem,3.8vw,3.2rem)',
          overflowWrap: 'break-word',
          textShadow: '0 2px 8px rgba(0,0,0,1), 0 4px 20px rgba(0,0,0,0.8)',
          WebkitTextStroke: '1px rgba(0,0,0,0.4)',
          paintOrder: 'stroke fill',
        }}>{name}</div>
        {sub && <div className="text-white/65 font-semibold mt-1" style={{ fontSize: 'clamp(1rem,1.6vw,1.3rem)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>{sub}</div>}
        <div className="flex items-center gap-2 mt-2">
          {fromLogo && <img src={fromLogo} alt={asset.fromTeam} className="object-contain flex-shrink-0" style={{ width: '22px', height: '22px', opacity: 0.85 }} />}
          <span className="font-bold text-white/75" style={{ fontSize: 'clamp(0.95rem,1.5vw,1.15rem)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>from {asset.fromTeam}</span>
        </div>
      </div>
    </div>
  );
}

export default function DraftTradeAnimation({ teams, assets, eventLogoUrl, eventColor1, picksPerRound = 12, onComplete }: DraftTradeAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const onCompleteRef = useRef(onComplete);
  const useAudioLeadInRef = useRef(false);
  const [leadInDone, setLeadInDone] = useState(false);
  onCompleteRef.current = onComplete;
  const ec1 = eventColor1 || '#a4c810';

  useEffect(() => {
    const useAudioLeadIn = shouldPlayTradeAlertLeadIn();
    useAudioLeadInRef.current = useAudioLeadIn;
    if (!useAudioLeadIn) {
      setLeadInDone(true);
      return;
    }
    void playTradeAlertSound();
    const timer = window.setTimeout(() => setLeadInDone(true), TRADE_ALERT_LEAD_IN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!leadInDone) return;
    if (timelineRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const logoPhase    = container.querySelector<HTMLElement>('.gtrade-logo');
    const alertPhase   = container.querySelector<HTMLElement>('.gtrade-alert');
    const alertText    = container.querySelector<HTMLElement>('.gtrade-alert-text');
    const alertLine    = container.querySelector<HTMLElement>('.gtrade-alert-line');
    const teamsPhase   = container.querySelector<HTMLElement>('.gtrade-teams');
    const teamPanels   = Array.from(container.querySelectorAll<HTMLElement>('.gtrade-team-panel'));
    const tradeIcon    = container.querySelector<HTMLElement>('.gtrade-icon');
    const detailsPhase = container.querySelector<HTMLElement>('.gtrade-details');
    const detailsCard  = container.querySelector<HTMLElement>('.gtrade-card');
    const assetRows    = container.querySelectorAll<HTMLElement>('.gtrade-asset-row');

    if (!logoPhase || !alertPhase || !teamsPhase || !detailsPhase) return;

    // ── Initial states ───────────────────────────────────────────────────────
    gsap.set([logoPhase, alertPhase, teamsPhase, detailsPhase], { autoAlpha: 0 });
    gsap.set(alertText,  { autoAlpha: 0, yPercent: 15, scale: 0.85 });
    gsap.set(alertLine,  { scaleX: 0, transformOrigin: 'center center' });
    // Alternate panels slide from left/right
    teamPanels.forEach((p, i) => gsap.set(p, { xPercent: i % 2 === 0 ? -100 : 100 }));
    if (tradeIcon) gsap.set(tradeIcon, { autoAlpha: 0, scale: 0 });
    gsap.set(detailsCard, { autoAlpha: 0, yPercent: 4 });
    assetRows.forEach((row) => gsap.set(row, { autoAlpha: 0, x: 18 }));

    const tl = gsap.timeline({ onComplete: () => onCompleteRef.current?.(), defaults: { ease: 'power2.out' } });
    timelineRef.current = tl;

    // ── Phase 0: Event Logo — 2.3s total ────────────────────────────────────
    tl.to(logoPhase, { autoAlpha: 1, duration: 0.55 })
      .to(logoPhase, { autoAlpha: 0, duration: 0.4, ease: 'power2.in' }, '+=1.35');

    // ── Phase 1: TRADE ALERT — 6.0s total ───────────────────────────────────
    tl.to(alertPhase, { autoAlpha: 1, duration: 0.4 })
      .to(alertText,  { autoAlpha: 1, yPercent: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)' }, '<0.1')
      .to(alertLine,  { scaleX: 1, duration: 0.5, ease: 'power2.inOut' }, '<0.2')
      .to(alertPhase, { autoAlpha: 0, duration: 0.4, ease: 'power2.in' }, '+=4.8');

    // ── Phase 2: Teams Split Screen — 5.0s total ────────────────────────────
    tl.to(teamsPhase, { autoAlpha: 1, duration: 0.3 });
    teamPanels.forEach((p, i) => {
      tl.to(p, { xPercent: 0, duration: 0.55, ease: 'power3.out' }, i === 0 ? '<0.05' : '<');
    });
    if (tradeIcon && teams.length === 2) {
      tl.to(tradeIcon, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'back.out(1.5)' }, '<0.2');
    }
    tl.to(teamsPhase, { autoAlpha: 0, duration: 0.45, ease: 'power2.in' }, '+=3.9');

    // ── Phase 3: Trade Details — 20.4s hold ─────────────────────────────────
    tl.to(detailsPhase, { autoAlpha: 1, duration: 0.5 })
      .to(detailsCard,  { autoAlpha: 1, yPercent: 0, duration: 0.62, ease: 'power3.out' }, '<0.1');
    if (assetRows.length) {
      tl.to(assetRows, { autoAlpha: 1, x: 0, duration: 0.4, stagger: 0.055, ease: 'power2.out' }, '-=0.35');
    }
    tl.to(container, { autoAlpha: 0, duration: 0.8, ease: 'power2.inOut' }, '+=20.4');

    return () => { timelineRef.current?.kill(); timelineRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadInDone]);

  const c1 = getTeamColors(teams[0] || '');
  const c2 = getTeamColors(teams[teams.length - 1] || '');
  const topBarGradient = teams.length >= 3
    ? `linear-gradient(90deg, ${teams.map((t, i) => {
        const pct = Math.round((i / (teams.length - 1)) * 100);
        return i % 2 === 0 ? `${getTeamColors(t).primary}cc ${pct}%` : `${ec1}99 ${pct}%`;
      }).join(', ')})`
    : `linear-gradient(90deg, ${c1.primary}cc 0%, ${ec1}99 50%, ${c2.primary}cc 100%)`;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 9999, backgroundColor: '#080810' }}
    >
      {!leadInDone && useAudioLeadInRef.current && (
        <div className="absolute inset-0 bg-[#080810]" aria-hidden />
      )}

      {leadInDone && (
        <>
          {/* ── PHASE 0: Event Logo ─────────────────────────────────────────── */}
          <div className="gtrade-logo absolute inset-0 flex items-center justify-center" style={{ willChange: 'opacity, visibility' }}>
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 50%, ${ec1}22 0%, #080810 70%)` }} />
            {eventLogoUrl ? (
              <img src={eventLogoUrl} alt="" className="relative z-10 object-contain"
                style={{ width: 'clamp(120px, 20vw, 200px)', height: 'clamp(120px, 20vw, 200px)' }} />
            ) : (
              <div className="relative z-10 font-black uppercase" style={{ fontSize: 'clamp(5rem, 12vw, 10rem)', color: ec1, letterSpacing: '0.1em' }}>
                TRADE
              </div>
            )}
          </div>

          {/* ── PHASE 1: TRADE ALERT ────────────────────────────────────────── */}
          <div className="gtrade-alert absolute inset-0 flex flex-col items-center justify-center gap-6" style={{ willChange: 'opacity, visibility' }}>
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 45%, ${ec1}30 0%, #080810 60%)` }} />
            <div className="relative z-10 flex flex-col items-center gap-6">
              {eventLogoUrl && (
                <img src={eventLogoUrl} alt="" className="object-contain opacity-90"
                  style={{ width: 'clamp(50px, 7vw, 70px)', height: 'clamp(50px, 7vw, 70px)' }} />
              )}
              <div
                className="gtrade-alert-text font-black text-center uppercase leading-none"
                style={{
                  fontSize: 'clamp(5rem, 13vw, 11rem)',
                  color: ec1,
                  textShadow: `0 0 80px ${ec1}77, 0 4px 20px rgba(0,0,0,0.9)`,
                  WebkitTextStroke: `2px ${ec1}99`,
                  letterSpacing: '0.08em',
                  willChange: 'transform, opacity',
                }}
              >
                TRADE<br />ALERT
              </div>
              <div
                className="gtrade-alert-line rounded-full"
                style={{ width: 'clamp(200px, 30vw, 360px)', height: '3px', background: `linear-gradient(90deg, transparent, ${ec1}, transparent)`, willChange: 'transform' }}
              />
            </div>
          </div>

          {/* ── PHASE 2: Teams Split Screen ─────────────────────────────────── */}
          <div className="gtrade-teams absolute inset-0 overflow-hidden" style={{ willChange: 'opacity, visibility' }}>
            {teams.map((t, idx) => {
              const tc = getTeamColors(t);
              const tLogo = getTeamLogoPath(t);
              const panelWidth = `${100 / teams.length}%`;
              const panelLeft = `${idx * (100 / teams.length)}%`;
              const angle = idx % 2 === 0 ? 135 : 225;
              return (
                <div key={t}
                  className="gtrade-team-panel absolute inset-y-0 flex flex-col items-center justify-center gap-6 overflow-hidden"
                  style={{
                    width: panelWidth, left: panelLeft,
                    background: `linear-gradient(${angle}deg, ${tc.primary}ff 0%, ${tc.secondary}dd 100%)`,
                    willChange: 'transform',
                    borderRight: idx < teams.length - 1 ? `2px solid rgba(0,0,0,0.4)` : 'none',
                  }}
                >
                  <div className="absolute inset-0 opacity-10 flex items-center justify-center">
                    <img src={tLogo} alt="" className="object-contain" style={{ width: '90%', height: '90%' }} />
                  </div>
                  <img src={tLogo} alt={t} className="relative z-10 object-contain drop-shadow-2xl"
                    style={{ width: 'clamp(80px, 12vw, 180px)', height: 'clamp(80px, 12vw, 180px)' }} />
                  <div className="relative z-10 font-black text-white text-center uppercase leading-tight px-4"
                    style={{ fontSize: 'clamp(1.5rem, 3.5vw, 3.2rem)', textShadow: '0 2px 8px rgba(0,0,0,1), 0 4px 24px rgba(0,0,0,0.9)', letterSpacing: '0.04em', WebkitTextStroke: '1px rgba(0,0,0,0.5)', paintOrder: 'stroke fill' }}>
                    {t}
                  </div>
                </div>
              );
            })}
            {/* Center icon, only for 2-team trades */}
            {teams.length === 2 && (
              <div className="gtrade-icon absolute inset-0 flex items-center justify-center" style={{ zIndex: 10, willChange: 'transform, opacity' }}>
                <div className="flex items-center justify-center rounded-full font-black"
                  style={{
                    width: 'clamp(60px, 8vw, 90px)', height: 'clamp(60px, 8vw, 90px)',
                    background: '#080810', border: `4px solid ${ec1}`,
                    color: ec1, fontSize: 'clamp(1.4rem, 3vw, 2.2rem)',
                    boxShadow: `0 0 40px ${ec1}88`,
                  }}>
                  ⟷
                </div>
              </div>
            )}
          </div>

          {/* ── PHASE 3: Trade Details, split-panel ACQUIRES view ─────────────── */}
          <div className="gtrade-details absolute inset-0 overflow-hidden" style={{ willChange: 'opacity, visibility' }}>
            <div className="gtrade-card absolute inset-0 flex flex-col" style={{ willChange: 'transform, opacity' }}>

              {/* Top bar */}
              <div className="flex items-center justify-center gap-4 flex-shrink-0 px-6 py-4"
                style={{ background: topBarGradient, borderBottom: `3px solid ${ec1}` }}>
                {eventLogoUrl && (
                  <img src={eventLogoUrl} alt="" className="object-contain flex-shrink-0"
                    style={{ width: 'clamp(28px,4vw,44px)', height: 'clamp(28px,4vw,44px)' }} />
                )}
                <span className="font-black uppercase text-white tracking-widest"
                  style={{ fontSize: 'clamp(1rem,2.5vw,1.6rem)', textShadow: '0 2px 12px rgba(0,0,0,0.7)' }}>TRADE COMPLETE</span>
              </div>

              {/* Team rows, stacked vertically, each full screen width */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {teams.map((t, idx) => {
                  const tc = getTeamColors(t);
                  const tLogo = getTeamLogoPath(t);
                  const acquired = assets.filter(a => a.toTeam === t);
                  return (
                    <div key={t} className="flex-1 flex flex-col overflow-hidden relative"
                      style={{
                        background: `linear-gradient(135deg, ${tc.primary}44 0%, ${tc.primary}18 55%, rgba(8,8,16,0.92) 100%)`,
                        borderTop: idx > 0 ? `2px solid ${ec1}33` : 'none',
                      }}
                    >
                      {/* Faint watermark, right-anchored so it does not compete with text */}
                      <div className="absolute inset-0 flex items-center justify-end pointer-events-none" style={{ opacity: 0.07 }}>
                        <img src={tLogo} alt="" className="object-contain" style={{ width: '40%', height: '90%' }} />
                      </div>
                      {/* Section header, compact left-border strip */}
                      <div className="relative z-10 flex items-center gap-4 px-8 py-3 flex-shrink-0"
                        style={{ borderLeft: `6px solid ${tc.primary}` }}>
                        <img src={tLogo} alt={t} className="object-contain flex-shrink-0"
                          style={{ width: 'clamp(44px,5vw,68px)', height: 'clamp(44px,5vw,68px)' }} />
                        <div>
                          <div className="font-black text-white uppercase leading-none"
                            style={{ fontSize: 'clamp(1.3rem,2.8vw,2.2rem)', letterSpacing: '0.05em', textShadow: '0 2px 10px rgba(0,0,0,1), 0 4px 20px rgba(0,0,0,0.8)', WebkitTextStroke: '0.5px rgba(0,0,0,0.5)', paintOrder: 'stroke fill' }}>{t}</div>
                          <div className="font-black uppercase tracking-widest mt-0.5"
                            style={{ color: tc.primary, fontSize: 'clamp(0.7rem,1.1vw,0.9rem)' }}>ACQUIRES</div>
                        </div>
                      </div>
                      {/* Assets, full width, vertically centered in remaining space */}
                      <div className="relative z-10 flex-1 flex flex-col justify-center gap-2.5 px-8 pb-4">
                        {acquired.length === 0 ? (
                          <div className="text-white/25 text-xl font-semibold">— nothing —</div>
                        ) : (
                          acquired.map((a, i) => <AcquiredAsset key={i} asset={a} ec1={ec1} picksPerRound={picksPerRound} />)
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </>
      )}
    </div>
  );
}
