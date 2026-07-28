'use client';

/* eslint-disable @next/next/no-img-element -- Using <img> for GSAP animations that need direct DOM access */

import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { getTeamLogoPath } from '@/lib/utils/team-utils';

interface DraftPickAnimationProps {
  player: {
    name: string;
    position: string;
    team?: string;
    college?: string;
    imageUrl?: string;
  };
  fantasyTeam: {
    name: string;
    colors: [string, string, string | null];
    logoPath: string | null;
  };
  pickNumber: number;
  round: number;
  pickInRound: number;
  onComplete?: () => void;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
}

function toOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Full-bleed text reveal — lots of horizontal space. */
function pickAnimPlayerNameFontSize(name: string): string {
  const len = name.length;
  if (len > 28) return 'clamp(1rem, 2.2vw + 0.55rem, 2rem)';
  if (len > 22) return 'clamp(1.2rem, 2.8vw + 0.55rem, 2.65rem)';
  // 15–22 chars (e.g. "Fernando Mendoza") — avoid oversized type on wrap
  if (len > 14) return 'clamp(1.35rem, 3.2vw + 0.5rem, 3.35rem)';
  if (len > 10) return 'clamp(1.55rem, 3.8vw + 0.45rem, 4.1rem)';
  return 'clamp(2rem, 4.5vw + 0.35rem, 5.5rem)';
}

/**
 * Player card name column shares width with the headshot and sits inside a rounded,
 * overflow-hidden card — keep a lower cap so two-line names are not clipped.
 */
function pickAnimPlayerNameFontSizeCard(name: string): string {
  const len = name.length;
  if (len > 26) return 'clamp(0.95rem, 1.85vw + 0.55rem, 1.85rem)';
  if (len > 20) return 'clamp(1.05rem, 2.05vw + 0.6rem, 2.1rem)';
  if (len > 14) return 'clamp(1.15rem, 2.35vw + 0.65rem, 2.45rem)';
  if (len > 10) return 'clamp(1.25rem, 2.65vw + 0.65rem, 2.85rem)';
  return 'clamp(1.35rem, 3vw + 0.7rem, 3.25rem)';
}

function pickAnimFantasyTeamNameFontSize(name: string): string {
  const len = name.length;
  // Keep caps modest — WebKit text stroke adds invisible overflow that clips inside overflow-hidden roots.
  if (len > 22) return 'clamp(1rem, 2.8vw + 0.4rem, 2.5rem)';
  if (len > 16) return 'clamp(1.2rem, 3.5vw + 0.45rem, 3.25rem)';
  if (len > 10) return 'clamp(1.5rem, 4.5vw + 0.5rem, 4rem)';
  return 'clamp(1.85rem, 5.5vw + 0.55rem, 5rem)';
}

export default function DraftPickAnimation({
  player,
  fantasyTeam,
  pickNumber,
  round,
  pickInRound,
  onComplete,
  eventLogoUrl,
  eventColor1,
}: DraftPickAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    if (timelineRef.current) return;

    const container = containerRef.current;
    if (!container) return;

    // Scoped DOM queries — guaranteed to find elements within this instance only
    const teamIntro    = container.querySelector<HTMLElement>('.gsap-team-intro');
    const teamNameBg   = container.querySelector<HTMLElement>('.gsap-team-name-bg');
    const teamLogo     = container.querySelector<HTMLElement>('.gsap-team-logo');
    const teamNameText = container.querySelector<HTMLElement>('.gsap-team-name-text');
    const wipe         = container.querySelector<HTMLElement>('.gsap-transition-wipe');
    const draftCard    = container.querySelector<HTMLElement>('.gsap-draft-card');
    const draftOrdinal  = container.querySelector<HTMLElement>('.gsap-draft-ordinal');
    const draftOverall  = container.querySelector<HTMLElement>('.gsap-draft-overall');
    const textReveal    = container.querySelector<HTMLElement>('.gsap-text-reveal');
    const revealName    = container.querySelector<HTMLElement>('.gsap-reveal-name');
    const revealDetails = container.querySelector<HTMLElement>('.gsap-reveal-details');
    const playerCard      = container.querySelector<HTMLElement>('.gsap-player-card');
    const playerDets      = container.querySelector<HTMLElement>('.gsap-player-details');
    const playerName      = container.querySelector<HTMLElement>('.gsap-player-name');
    const pickInfo        = container.querySelector<HTMLElement>('.gsap-pick-info');
    const pickStats       = pickInfo ? pickInfo.querySelectorAll<HTMLElement>('.gsap-pick-stat') : [];
    const eventLogoFeat   = container.querySelector<HTMLElement>('.gsap-event-logo-feat');
    const eventLogoInner  = container.querySelector<HTMLElement>('.gsap-event-logo-inner');
    const eventLogoCorner = container.querySelector<HTMLElement>('.gsap-event-logo-corner');
    const bridgeIntro = container.querySelector<HTMLElement>('.gsap-bridge-intro');
    const cables      = Array.from(container.querySelectorAll<HTMLElement>('.gsap-cable'));
    const rivets      = Array.from(container.querySelectorAll<HTMLElement>('.gsap-rivet'));
    const teamLetters = Array.from(container.querySelectorAll<HTMLElement>('.gsap-team-name-letter'));

    if (!teamIntro || !wipe || !draftCard || !textReveal || !playerCard) {
      console.error('[DraftPickAnimation] Missing critical DOM elements — aborting');
      return;
    }
    if (eventLogoFeat)   gsap.set(eventLogoFeat,   { opacity: 0, force3D: true });
    if (eventLogoInner)  gsap.set(eventLogoInner,  { scale: 1.75, y: 0, rotation: 0, force3D: true });
    if (eventLogoCorner) gsap.set(eventLogoCorner, { opacity: 0, force3D: true });
    if (bridgeIntro) gsap.set(bridgeIntro, { opacity: 0, force3D: true });
    cables.forEach(c => gsap.set(c, { scaleX: 0, transformOrigin: 'left center', force3D: true }));
    rivets.forEach(r => gsap.set(r, { opacity: 0, scale: 0, force3D: true }));
    teamLetters.forEach(l => gsap.set(l, { opacity: 0, y: -18, scale: 1.2, force3D: true }));

    // ── INITIAL STATES ───────────────────────────────────────────────────────
    // Full-screen layers: opacity only (no scale — scaling viewport = slow repaint)
    // Small elements: scale + opacity allowed (compositor handles them cheaply)
    gsap.set(teamIntro,    { opacity: 0, force3D: true });
    gsap.set(teamNameBg,   { opacity: 0, force3D: true });
    gsap.set(teamNameText, { opacity: 0, force3D: true });
    if (teamLogo) gsap.set(teamLogo, { opacity: 0, scale: 0.8, force3D: true });
    gsap.set(wipe,         { scaleX: 0, transformOrigin: 'left center', force3D: true });
    gsap.set(draftCard,    { opacity: 0, force3D: true });
    if (draftOrdinal)  gsap.set(draftOrdinal,  { opacity: 0, y: -30, force3D: true });
    if (draftOverall)  gsap.set(draftOverall,  { opacity: 0, y: 30, force3D: true });
    gsap.set(textReveal,   { opacity: 0, force3D: true });
    if (revealName)    gsap.set(revealName,    { opacity: 0, y: 36, force3D: true });
    if (revealDetails) gsap.set(revealDetails, { opacity: 0, y: 24, force3D: true });
    gsap.set(playerCard,   { opacity: 0, x: -60, y: 10, rotation: -1.5, force3D: true });
    if (playerDets) gsap.set(playerDets, { opacity: 0, y: 20, force3D: true });
    if (playerName) gsap.set(playerName, { opacity: 0, y: 20, force3D: true });
    if (pickInfo)   gsap.set(pickInfo,   { opacity: 0, y: 20, force3D: true });
    pickStats.forEach((el) => gsap.set(el, { opacity: 0, y: 14, force3D: true }));

    // ── TIMELINE (~10s total) ─────────────────────────────────────────────────
    const tl = gsap.timeline({
      onComplete: () => {
        onComplete?.();
      },
    });
    timelineRef.current = tl;

    // BRIDGE PHASE: Pittsburgh steel — cables draw across, rivets punch in
    if (bridgeIntro) {
      tl.to(bridgeIntro, { opacity: 1, duration: 0.35, ease: 'power2.out', force3D: true });
      if (cables.length) tl.to(cables, { scaleX: 1, duration: 0.4, stagger: 0.1, ease: 'power2.inOut', force3D: true }, '-=0.15');
      if (rivets.length) tl.to(rivets, { opacity: 1, scale: 1, duration: 0.22, stagger: 0.07, ease: 'back.out(3)', force3D: true }, '-=0.6');
      tl.to({}, { duration: 0.35 });
    }

    // PHASE 0: Featured event logo moment — slam-in entrance, cinematic hold, punch-out
    if (eventLogoFeat) {
      // Background fades in first
      tl.to(eventLogoFeat, { opacity: 1, duration: 0.4, ease: 'power2.out', force3D: true });
      // Slam-in: drop hard past rest (overshoot to 0.9), then spring back to 1.0
      if (eventLogoInner) tl.to(eventLogoInner, { scale: 0.9, duration: 0.28, ease: 'power4.out', force3D: true }, '-=0.15');
      if (eventLogoInner) tl.to(eventLogoInner, { scale: 1, duration: 0.22, ease: 'power2.out', force3D: true });
      // Cinematic hold: slow pull-focus zoom + rotation drift + upward float
      if (eventLogoInner) tl.to(eventLogoInner, { scale: 1.14, rotation: 3, y: -12, duration: 5.1, ease: 'power1.inOut', force3D: true });
      // Punch out: burst to large scale while background fades
      if (eventLogoInner) tl.to(eventLogoInner, { scale: 1.45, rotation: 3.5, duration: 0.22, ease: 'power3.in', force3D: true });
      tl.to(eventLogoFeat, { opacity: 0, duration: 0.2, ease: 'power2.in', force3D: true }, '-=0.15');
    }

    // PHASE 1: Team intro (0–2.5s)
    tl.to(teamIntro,   { opacity: 1, duration: 0.5, ease: 'power2.out', force3D: true });
    tl.to(teamNameBg,  { opacity: 1, duration: 0.7, ease: 'sine.inOut', force3D: true }, '-=0.2');
    if (teamLogo) tl.to(teamLogo, { opacity: 0.35, scale: 1, duration: 0.8, ease: 'power2.out', force3D: true }, '-=0.5');
    tl.set(teamNameText, { opacity: 1 }, '-=0.5');
    if (teamLetters.length) {
      tl.to(teamLetters, { opacity: 1, y: 0, scale: 1, duration: 0.12, stagger: 0.04, ease: 'back.out(2.5)', force3D: true }, '-=0.45');
    } else {
      tl.to(teamNameText, { opacity: 1, duration: 0.7, ease: 'power3.out', force3D: true }, '-=0.45');
    }
    tl.to({}, { duration: 0.9 }); // hold

    // PHASE 2: Color wipe clears team intro (2.5–3.1s)
    tl.to(wipe,      { scaleX: 1, duration: 0.55, ease: 'power2.inOut', force3D: true });
    tl.to(teamIntro, { opacity: 0, duration: 0.25, ease: 'power1.in', force3D: true }, '-=0.25');
    if (bridgeIntro) tl.to(bridgeIntro, { opacity: 0, duration: 0.35, ease: 'power1.in', force3D: true }, '<');

    // PHASE 3: Draft card in as wipe retracts (3.1–5.1s)
    tl.to(draftCard, { opacity: 1, duration: 0.4, ease: 'power2.out', force3D: true }, '-=0.1');
    tl.to(wipe,      { scaleX: 0, transformOrigin: 'right center', duration: 0.5, ease: 'power2.inOut', force3D: true }, '-=0.3');
    if (draftOrdinal) tl.to(draftOrdinal, { opacity: 1, y: 0, duration: 0.5,  ease: 'power2.out', force3D: true }, '-=0.2');
    if (draftOverall) tl.to(draftOverall, { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', force3D: true }, '-=0.35');
    tl.to({}, { duration: 0.9 }); // hold

    // PHASE 4: Ordinal card out
    tl.to(draftCard, { opacity: 0, duration: 0.35, ease: 'power2.in', force3D: true });

    // PHASE 5: Text reveal — name + details before card (5.5–7.3s)
    tl.to(textReveal,   { opacity: 1, duration: 0.4,  ease: 'power2.out', force3D: true }, '-=0.1');
    if (revealName)    tl.to(revealName,    { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out', force3D: true }, '-=0.25');
    if (revealDetails) tl.to(revealDetails, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', force3D: true }, '-=0.3');
    tl.to({}, { duration: 1.0 }); // hold on text

    // PHASE 6: Player card sweeps in over text (7.3–9.0s)
    tl.to(textReveal, { opacity: 0, duration: 0.3, ease: 'power1.in', force3D: true });
    tl.to(playerCard, { opacity: 1, x: 0, y: 0, rotation: 0, duration: 0.7, ease: 'power3.out', force3D: true }, '-=0.15');
    if (playerDets)      tl.to(playerDets,      { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', force3D: true }, '-=0.25');
    if (playerName)      tl.to(playerName,      { opacity: 1, y: 0, duration: 0.42, ease: 'power3.out', force3D: true }, '-=0.28');
    if (pickInfo) {
      tl.to(pickInfo, { opacity: 1, y: 0, duration: 0.38, ease: 'power2.out', force3D: true }, '-=0.28');
      if (pickStats.length) {
        tl.to(pickStats, { opacity: 1, y: 0, duration: 0.36, stagger: 0.07, ease: 'power2.out', force3D: true }, '-=0.22');
      }
    }
    // Corner watermark fades in on the broadcast hold frame
    if (eventLogoCorner) tl.to(eventLogoCorner, { opacity: 0.55, duration: 0.5, ease: 'power2.out', force3D: true }, '-=0.2');

    // PHASE 7: Broadcast hold (9.0–16.5s — extra 1.5s for TV readability)
    tl.to({}, { duration: 7.5 });

    // PHASE 8: Exit
    tl.to(container, { opacity: 0, duration: 0.8, ease: 'power2.inOut', force3D: true });

    return () => {
      const tl = timelineRef.current;
      if (tl) {
        tl.kill();
        timelineRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const c1 = fantasyTeam.colors[0];
  const c2 = fantasyTeam.colors[1] || fantasyTeam.colors[0];
  const ec = eventColor1 || '#a4c810';
  const teamLogo = getTeamLogoPath(fantasyTeam.name);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] pointer-events-none overflow-hidden"
      style={{ backgroundColor: '#0a0a0a', willChange: 'opacity' }}
    >
      {/* ── BRIDGE INTRO: Pittsburgh steel assembly ── */}
      <div className="gsap-bridge-intro absolute inset-0" style={{ willChange: 'opacity' }}>
        <div className="absolute inset-0" style={{ background: '#060809' }} />
        {/* Faint furnace glow — mill light on the horizon */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none" style={{
          background: 'linear-gradient(to top, rgba(180,80,0,0.07) 0%, transparent 100%)',
        }} />
        {/* X-lattice truss pattern */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: [
            'repeating-linear-gradient(45deg,transparent 0,transparent 46px,rgba(90,105,115,0.18) 46px,rgba(90,105,115,0.18) 48px)',
            'repeating-linear-gradient(-45deg,transparent 0,transparent 46px,rgba(90,105,115,0.18) 46px,rgba(90,105,115,0.18) 48px)',
          ].join(','),
        }} />
        {/* Horizontal girder lines */}
        {([8, 22, 38, 50, 62, 78, 92] as number[]).map((top, i) => (
          <div key={i} className="gsap-cable absolute left-0 right-0" style={{
            top: `${top}%`,
            height: i === 3 ? '2px' : '1px',
            background: i === 3
              ? 'linear-gradient(90deg,#3a3a3a 0%,#888 25%,#bbb 50%,#888 75%,#3a3a3a 100%)'
              : 'linear-gradient(90deg,#1c1c1c 0%,#4a4a4a 30%,#5a5a5a 50%,#4a4a4a 70%,#1c1c1c 100%)',
            willChange: 'transform',
          }} />
        ))}
        {/* Corner rivets */}
        {(['top-6 left-6', 'top-6 right-6', 'bottom-6 left-6', 'bottom-6 right-6'] as string[]).map((pos, i) => (
          <div key={i} className={`gsap-rivet absolute ${pos} w-5 h-5 rounded-full`} style={{
            background: 'radial-gradient(circle at 35% 35%,#c0c0c0 0%,#666 45%,#1a1a1a 100%)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.9),inset 0 1px 0 rgba(255,255,255,0.15)',
            willChange: 'opacity,transform',
          }} />
        ))}
      </div>

      {/* ── PHASE 1: Team Intro ── */}
      <div
        className="gsap-team-intro absolute inset-0"
        style={{ willChange: 'opacity' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 50% 50%, ${c1}22 0%, #0d0d0d 70%)` }}
        />
        <div
          className="gsap-team-name-bg absolute inset-0"
          style={{ willChange: 'opacity' }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='320' height='160' xmlns='http://www.w3.org/2000/svg'%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Arial Black,sans-serif' font-size='28' font-weight='900' fill='${encodeURIComponent(c2.replace('#', '%23'))}' fill-opacity='0.09' transform='rotate(-12 160 80)'%3E${encodeURIComponent(fantasyTeam.name.toUpperCase())}%3C%2Ftext%3E%3C%2Fsvg%3E")`,
              backgroundSize: '320px 160px',
            }}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          {teamLogo && (
            <img
              src={teamLogo}
              alt=""
              className="gsap-team-logo w-80 h-80 object-contain"
              style={{ willChange: 'transform, opacity' }}
            />
          )}
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-4 sm:px-10">
          <div
            className="gsap-team-name-text text-center font-black text-white uppercase max-w-[min(94vw,1100px)] mx-auto break-words hyphens-auto"
            style={{
              fontFamily: 'Impact, "Arial Black", sans-serif',
              fontSize: pickAnimFantasyTeamNameFontSize(fantasyTeam.name),
              letterSpacing: '0.06em',
              lineHeight: 1.08,
              padding: '0.12em 0.28em',
              boxDecorationBreak: 'clone',
              WebkitBoxDecorationBreak: 'clone',
              textShadow: `0 4px 24px rgba(0,0,0,0.95), 0 0 60px ${c1}55`,
              WebkitTextStroke: `min(0.06em, 2.5px) ${c2}`,
              paintOrder: 'stroke fill',
              willChange: 'transform, opacity',
            }}
          >
            {fantasyTeam.name.split('').map((char, i) => (
              <span
                key={i}
                className="gsap-team-name-letter"
                style={{ display: 'inline-block', whiteSpace: 'pre' }}
              >
                {char}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── PHASE 2: Color wipe ── */}
      <div
        className="gsap-transition-wipe absolute inset-0"
        style={{
          background: `linear-gradient(90deg, ${c1} 0%, ${c2} 100%)`,
          willChange: 'transform',
        }}
      />

      {/* ── PHASE 3: Draft card ── */}
      <div
        className="gsap-draft-card absolute inset-0 flex flex-col items-center justify-center"
        style={{ willChange: 'opacity' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 50% 40%, ${c1}33 0%, #0d0d0d 65%)` }}
        />
        <div className="relative z-10 flex flex-col items-center select-none">
          <div
            className="gsap-draft-ordinal font-black"
            style={{
              fontSize: 'clamp(7rem, 18vw, 16rem)',
              letterSpacing: '-0.02em',
              lineHeight: 0.9,
              color: c1,
              textShadow: `0 4px 32px rgba(0,0,0,0.85)`,
              WebkitTextStroke: `2px ${c2}`,
              willChange: 'transform, opacity',
            }}
          >
            {toOrdinal(pickNumber)}
          </div>
          <div
            className="gsap-draft-overall font-black uppercase"
            style={{
              fontSize: 'clamp(1.75rem, 4vw, 3.5rem)',
              letterSpacing: '0.25em',
              color: '#d0d0d0',
              textShadow: '0 2px 12px rgba(0,0,0,0.9)',
              willChange: 'transform, opacity',
            }}
          >
            Overall Pick
          </div>
        </div>
      </div>

      {/* ── PHASE 4b: Featured event logo moment — Pittsburgh industrial background ── */}
      {eventLogoUrl && (
        <div
          className="gsap-event-logo-feat absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ willChange: 'opacity' }}
        >
          {/* Industrial dark base + event color radial glow */}
          <div className="absolute inset-0" style={{
            background: `radial-gradient(ellipse 65% 55% at 50% 50%, ${ec}2e 0%, #020406 72%)`,
          }} />
          {/* Bridge truss X-lattice */}
          <div className="absolute inset-0" style={{
            backgroundImage: `repeating-linear-gradient(45deg, transparent 0, transparent 30px, ${ec}20 30px, ${ec}20 32px), repeating-linear-gradient(-45deg, transparent 0, transparent 30px, ${ec}20 30px, ${ec}20 32px)`,
          }} />
          {/* Horizontal girder bands */}
          <div className="absolute inset-0" style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent 0, transparent 63px, ${ec}18 63px, ${ec}18 65px)`,
          }} />
          {/* Industrial spotlight beam rising from below center */}
          <div className="absolute inset-0" style={{
            background: `linear-gradient(to top, ${ec}22 0%, ${ec}0d 38%, transparent 58%)`,
            clipPath: 'polygon(32% 100%, 68% 100%, 78% 0%, 22% 0%)',
          }} />
          {/* Logo — cinematic element animated independently */}
          <img
            src={eventLogoUrl}
            alt=""
            className="gsap-event-logo-inner relative z-10 object-contain"
            style={{ width: 'clamp(150px, 24vw, 220px)', height: 'clamp(150px, 24vw, 220px)', willChange: 'transform' }}
          />
        </div>
      )}

      {/* ── PHASE 5: Text reveal ── */}
      <div
        className="gsap-text-reveal absolute inset-0 flex flex-col items-center justify-center"
        style={{ willChange: 'opacity' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 50% 45%, ${c1}2a 0%, #0d0d0d 65%)` }}
        />
        <div className="relative z-10 text-center px-4 sm:px-8 select-none max-w-[min(96vw,1400px)] mx-auto">
          <div
            className="gsap-reveal-name font-black text-white uppercase leading-tight break-words"
            style={{
              fontSize: pickAnimPlayerNameFontSize(player.name),
              letterSpacing: '-0.01em',
              textShadow: `0 2px 8px rgba(0,0,0,1), 0 4px 24px rgba(0,0,0,0.95), 0 0 60px ${c1}44`,
              WebkitTextStroke: '1.5px rgba(0,0,0,0.5)',
              paintOrder: 'stroke fill',
              willChange: 'transform, opacity',
            }}
          >
            {player.name}
          </div>
          <div
            className="gsap-reveal-details mt-5 sm:mt-6 flex items-center justify-center gap-3 sm:gap-4 flex-wrap px-1"
            style={{ willChange: 'transform, opacity' }}
          >
            <span
              className="inline-block font-black text-xl sm:text-2xl px-4 sm:px-5 py-1.5 rounded-lg shrink-0"
              style={{ background: c1, color: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.4)' }}
            >
              {player.position}
            </span>
            {player.college && (
              <span className="text-white/75 text-base sm:text-lg font-bold uppercase tracking-wider max-w-[min(90vw,720px)] break-words leading-snug">
                {player.college}
              </span>
            )}
            {player.team && (
              <span className="text-white/75 text-base sm:text-lg font-bold uppercase tracking-wider max-w-[min(90vw,480px)] break-words leading-snug">
                {player.team}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── PHASE 6: Player card ── */}
      <div
        className="gsap-player-card absolute inset-0 flex items-center justify-center"
        style={{ willChange: 'transform, opacity' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 50% 50%, ${c1}28 0%, #0d0d0d 70%)` }}
        />
        <div
          className="relative z-10 rounded-2xl overflow-hidden"
          style={{
            width: 'min(1100px, 96vw)',
            background: `linear-gradient(135deg, ${c1}ee 0%, ${c2}ee 100%)`,
            boxShadow: `0 24px 80px rgba(0,0,0,0.7), 0 0 60px ${c1}44`,
          }}
        >
          <div className="flex items-stretch" style={{ minHeight: 'min(560px, 76vh)' }}>
            <div className="w-3 flex-shrink-0" style={{ background: c2 }} />
            <div
              className="flex-shrink-0 flex items-center justify-center py-3 pl-2 pr-1 sm:py-4"
              style={{ width: 'min(400px, 38vw)', background: `${c1}88` }}
            >
              <div
                className="w-full max-h-[min(520px,72vh)]"
                style={{ aspectRatio: '4 / 5' }}
              >
                {player.imageUrl ? (
                  <img
                    src={player.imageUrl}
                    alt={player.name}
                    className="w-full h-full object-contain"
                    style={{ objectPosition: 'center top' }}
                  />
                ) : teamLogo ? (
                  <img
                    src={teamLogo}
                    alt={fantasyTeam.name}
                    className="w-full h-full max-w-[200px] max-h-[200px] m-auto object-contain"
                  />
                ) : null}
              </div>
            </div>
            <div className="flex-1 flex flex-col justify-center px-5 sm:px-10 py-6 sm:py-8 min-w-0 relative">
              {/* Fantasy team logo — embossed into bottom-right of card */}
              {teamLogo && (
                <img
                  src={teamLogo}
                  alt=""
                  className="absolute bottom-0 right-0 object-contain pointer-events-none"
                  style={{
                    width: 'min(340px, 34vw)',
                    height: 'min(340px, 34vw)',
                    opacity: 0.22,
                    filter: 'grayscale(1) brightness(1.6) contrast(0.55)',
                    mixBlendMode: 'soft-light',
                  }}
                />
              )}
              <div
                className="gsap-player-details mb-4 sm:mb-5 flex flex-wrap items-center gap-x-4 gap-y-2"
                style={{ willChange: 'transform, opacity' }}
              >
                <span
                  className="inline-block font-black text-2xl sm:text-3xl px-4 sm:px-6 py-2 rounded-lg shrink-0"
                  style={{ background: '#fff', color: c1, boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
                >
                  {player.position}
                </span>
                {player.college && (
                  <span className="text-white/80 text-base sm:text-lg font-bold uppercase tracking-wider break-words leading-snug max-w-full">
                    {player.college}
                  </span>
                )}
                {player.team && (
                  <span className="text-white/80 text-base sm:text-lg font-bold uppercase tracking-wider break-words leading-snug max-w-full">
                    {player.team}
                  </span>
                )}
              </div>
              <div
                className="gsap-player-name mb-4 sm:mb-5 max-w-full min-w-0"
                style={{ willChange: 'transform, opacity' }}
              >
                <h1
                  className="font-black text-white uppercase [overflow-wrap:anywhere]"
                  style={{
                    fontSize: pickAnimPlayerNameFontSizeCard(player.name),
                    lineHeight: 1.12,
                    textShadow: '0 2px 6px rgba(0,0,0,1), 0 4px 20px rgba(0,0,0,0.95), 0 8px 40px rgba(0,0,0,0.8)',
                    letterSpacing: '0.02em',
                    WebkitTextStroke: '1px rgba(0,0,0,0.6)',
                    paintOrder: 'stroke fill',
                  }}
                >
                  {player.name}
                </h1>
              </div>
              <div
                className="gsap-pick-info flex flex-wrap gap-x-6 gap-y-3 sm:gap-8"
                style={{ willChange: 'transform, opacity' }}
              >
                {[
                  { label: 'ROUND', value: round },
                  { label: 'PICK', value: pickInRound },
                  { label: 'OVERALL', value: pickNumber },
                ].map(({ label, value }) => (
                  <div key={label} className="gsap-pick-stat text-center">
                    <div className="text-white/70 text-sm font-bold tracking-widest mb-1">{label}</div>
                    <div
                      className="font-black text-white"
                      style={{ fontSize: '4rem', textShadow: '0 2px 8px rgba(0,0,0,0.8)', lineHeight: 1 }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Corner watermark: event logo on player card phase ── */}
      {eventLogoUrl && (
        <img
          src={eventLogoUrl}
          alt=""
          className="gsap-event-logo-corner absolute bottom-6 right-8 object-contain pointer-events-none"
          style={{ width: '56px', height: '56px', willChange: 'opacity' }}
        />
      )}
    </div>
  );
}
