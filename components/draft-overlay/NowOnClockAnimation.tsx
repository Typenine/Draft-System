'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { getTeamLogoPath } from '@/lib/utils/team-utils';

interface NowOnClockAnimationProps {
  team: {
    name: string;
    colors: [string, string, string | null];
  };
  pickNumber: number;
  round: number;
  pickInRound: number;
  onComplete?: () => void;
  /** Draft branding from DB (e.g. city / event title). Shown in subline with year when set. */
  eventName?: string | null;
  /** Draft year — paired with eventName for sublines like "Pittsburgh 2026". */
  eventYear?: number | null;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  /**
   * `infoBar` — only fills the draft info bar region so the board/grid stays visible.
   * `broadcast` — full-screen lower-third (legacy / room fallback).
   */
  layout?: 'broadcast' | 'infoBar';
}

const HOLD_SEC = 7;
const HOLD_INFOBAR_SEC = 5;

/** Fluid type for long franchise names — full name visible, wraps instead of clipping. */
function nocTeamNameFontSize(name: string): string {
  const len = name.length;
  if (len > 26) return 'clamp(1.15rem, 2.8vw + 0.4rem, 2.35rem)';
  if (len > 18) return 'clamp(1.45rem, 3.6vw + 0.35rem, 3.1rem)';
  if (len > 12) return 'clamp(1.75rem, 4.2vw + 0.3rem, 3.75rem)';
  return 'clamp(2rem, 5vw + 0.25rem, 4.5rem)';
}

/** Info bar row: large type but capped so two lines + subline fit ~180px strip. */
function nocInfoBarTeamNameFontSize(name: string): string {
  const len = name.length;
  if (len > 26) return 'clamp(1rem, 2.5vw + 0.45rem, 1.5rem)';
  if (len > 20) return 'clamp(1.15rem, 2.85vw + 0.45rem, 1.7rem)';
  if (len > 14) return 'clamp(1.3rem, 3.2vw + 0.45rem, 1.95rem)';
  if (len > 10) return 'clamp(1.45rem, 3.6vw + 0.4rem, 2.2rem)';
  return 'clamp(1.6rem, 4vw + 0.4rem, 2.45rem)';
}

/** Subline: prefer draft branding; otherwise overall pick # (this animation’s pickNumber is upcoming overall). */
function buildSubline(
  eventName: string | null | undefined,
  eventYear: number | null | undefined,
  overallPick: number,
): string {
  const name = eventName?.trim() || '';
  const year = eventYear != null && Number.isFinite(eventYear) ? Math.trunc(eventYear) : null;
  if (name && year != null) return `Next selection · ${name} ${year}`;
  if (name) return `Next selection · ${name}`;
  if (year != null) return `Next selection · ${year} draft`;
  return `Next selection · Pick #${overallPick}`;
}

export default function NowOnClockAnimation({
  team,
  pickNumber,
  round,
  pickInRound,
  onComplete,
  eventName,
  eventYear,
  eventLogoUrl,
  eventColor1,
  layout = 'broadcast',
}: NowOnClockAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surgeLayerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const hasStartedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const container = containerRef.current;
    if (!container) return;

    if (layout === 'infoBar') {
      const root = container.querySelector<HTMLElement>('.noc-ib-root');
      if (!root) return;

      const brand = container.querySelector<HTMLElement>('.noc-ib-brand');
      const headline = container.querySelector<HTMLElement>('.noc-ib-headline');
      const logoW = container.querySelector<HTMLElement>('.noc-ib-logo-wrap');
      const teamE = container.querySelector<HTMLElement>('.noc-ib-team');
      const meta = container.querySelector<HTMLElement>('.noc-ib-meta');
      const sub = container.querySelector<HTMLElement>('.noc-ib-sub');
      const live = container.querySelector<HTMLElement>('.noc-ib-live');

      gsap.set(root, { opacity: 0, y: 14 });
      const mainBits = [live, brand, headline, logoW, teamE, meta].filter(Boolean) as HTMLElement[];
      gsap.set(mainBits, { opacity: 0, y: 8 });
      if (sub) gsap.set(sub, { opacity: 0, y: 8 });

      const tl = gsap.timeline({
        onComplete: () => {
          onCompleteRef.current?.();
        },
      });
      timelineRef.current = tl;

      tl.to(root, { opacity: 1, y: 0, duration: 0.38, ease: 'power2.out' });
      tl.to(mainBits, { opacity: 1, y: 0, duration: 0.42, stagger: 0.045, ease: 'power2.out' }, '-=0.12');
      if (sub) tl.to(sub, { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out' }, '-=0.22');

      let livePulse: gsap.core.Tween | null = null;
      tl.add(() => {
        if (live) {
          livePulse = gsap.to(live, {
            opacity: 0.35,
            duration: 0.5,
            ease: 'sine.inOut',
            repeat: -1,
            yoyo: true,
          });
        }
      });

      tl.to({}, { duration: HOLD_INFOBAR_SEC });

      tl.add(() => {
        livePulse?.kill();
        livePulse = null;
      });

      tl.to(container, { opacity: 0, duration: 0.55, ease: 'power2.inOut' });

      return () => {
        livePulse?.kill();
        timelineRef.current?.kill();
        timelineRef.current = null;
      };
    }

    const ambient = container.querySelector<HTMLElement>('.noc-ambient');
    const ltWrap = container.querySelector<HTMLElement>('.noc-lt-wrap');
    const accent = container.querySelector<HTMLElement>('.noc-accent');
    const liveDot = container.querySelector<HTMLElement>('.noc-live-dot');
    const liveLabel = container.querySelector<HTMLElement>('.noc-live-label');
    const headline = container.querySelector<HTMLElement>('.noc-headline');
    const subline = container.querySelector<HTMLElement>('.noc-subline');
    const logoFrame = container.querySelector<HTMLElement>('.noc-logo-frame');
    const logoImg = container.querySelector<HTMLElement>('.noc-logo-img');
    const teamName = container.querySelector<HTMLElement>('.noc-team-name');
    const chyron = container.querySelector<HTMLElement>('.noc-chyron');
    const shine = container.querySelector<HTMLElement>('.noc-shine');
    const metaCols = container.querySelectorAll<HTMLElement>('.noc-meta-col');
    const draftBrandLogo = container.querySelector<HTMLElement>('.noc-draft-logo');

    if (!ambient || !ltWrap || !accent || !headline || !chyron) return;

    gsap.set(ambient, { opacity: 0 });
    gsap.set(ltWrap, { yPercent: 100, opacity: 1 });
    gsap.set(accent, { scaleY: 0, transformOrigin: '50% 100%' });
    gsap.set([liveDot, liveLabel], { opacity: 0, x: -12 });
    gsap.set(headline, { opacity: 0, y: 18 });
    if (subline) gsap.set(subline, { opacity: 0 });
    if (logoFrame) gsap.set(logoFrame, { opacity: 0, scale: 0.92 });
    if (logoImg) gsap.set(logoImg, { opacity: 0, scale: 0.88 });
    if (teamName) gsap.set(teamName, { opacity: 0, y: 14 });
    gsap.set(chyron, { opacity: 0, y: 10 });
    if (shine) gsap.set(shine, { xPercent: -120, opacity: 0.9 });
    metaCols.forEach((el) => gsap.set(el, { opacity: 0, y: 12 }));
    if (draftBrandLogo) gsap.set(draftBrandLogo, { opacity: 0, scale: 0.88 });

    const tl = gsap.timeline({
      onComplete: () => {
        onCompleteRef.current?.();
      },
    });
    timelineRef.current = tl;

    tl.to(ambient, { opacity: 1, duration: 0.35, ease: 'power2.out' });
    tl.to(ltWrap, { yPercent: 0, duration: 0.72, ease: 'power3.out' }, '-=0.08');
    tl.to(accent, { scaleY: 1, duration: 0.55, ease: 'power2.inOut' }, '-=0.5');
    tl.to([liveDot, liveLabel], { opacity: 1, x: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out' }, '-=0.25');
    if (draftBrandLogo) {
      tl.to(draftBrandLogo, { opacity: 1, scale: 1, duration: 0.48, ease: 'back.out(1.25)' }, '-=0.2');
    }
    tl.to(headline, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, draftBrandLogo ? '-=0.35' : '-=0.2');
    if (subline) tl.to(subline, { opacity: 1, duration: 0.35, ease: 'power2.out' }, '-=0.25');
    if (logoFrame) tl.to(logoFrame, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.35)' }, '-=0.2');
    if (logoImg) tl.to(logoImg, { opacity: 1, scale: 1, duration: 0.45, ease: 'power2.out' }, '-=0.35');
    if (teamName) tl.to(teamName, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, '-=0.35');
    tl.to(chyron, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, '-=0.2');
    tl.to(metaCols, { opacity: 1, y: 0, duration: 0.4, stagger: 0.07, ease: 'power2.out' }, '-=0.25');

    if (shine) {
      tl.to(shine, { xPercent: 140, duration: 1.15, ease: 'power2.inOut' }, '-=0.5');
    }

    let livePulse: gsap.core.Tween | null = null;
    tl.add(() => {
      if (liveDot) {
        gsap.set(liveDot, { opacity: 1 });
        livePulse = gsap.to(liveDot, {
          opacity: 0.35,
          duration: 0.55,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
        });
      }
    });

    tl.to({}, { duration: HOLD_SEC });

    tl.add(() => {
      livePulse?.kill();
      livePulse = null;
    });

    tl.to(container, { opacity: 0, duration: 0.85, ease: 'power2.inOut' });

    return () => {
      livePulse?.kill();
      timelineRef.current?.kill();
      timelineRef.current = null;
    };
  }, [layout]);

  const c1 = team.colors[0];
  const c2 = team.colors[1] || team.colors[0];
  const ec = eventColor1 || c1;
  const logo = getTeamLogoPath(team.name);
  const barTopLine = `linear-gradient(90deg, transparent 0%, ${ec} 15%, ${ec} 85%, transparent 100%)`;
  const sublineText = buildSubline(eventName, eventYear, pickNumber);

  useLayoutEffect(() => {
    if (layout !== 'infoBar' || !surgeLayerRef.current) return;
    const el = surgeLayerRef.current;
    gsap.killTweensOf(el);
    const tween = gsap.fromTo(
      el,
      { xPercent: -80 },
      { xPercent: 180, duration: 3.6, ease: 'none', repeat: -1 },
    );
    return () => {
      tween.kill();
    };
  }, [layout, c1, team.name]);

  if (layout === 'infoBar') {
    return (
      <div
        ref={containerRef}
        className="absolute inset-0 z-[30] flex flex-row pointer-events-none overflow-hidden rounded"
      >
        <div
          className="noc-ib-root relative flex flex-row w-full h-full min-h-0 bg-black overflow-hidden"
          style={{
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05)`,
          }}
        >
          {/* Primary color surge across black banner */}
          <div
            ref={surgeLayerRef}
            className="pointer-events-none absolute inset-y-0 left-0 w-[min(72%,420px)] z-0 opacity-[0.38]"
            aria-hidden
            style={{
              background: `linear-gradient(90deg, transparent 0%, ${c1}00 8%, ${c1}bb 45%, ${c1}ff 50%, ${c1}bb 55%, ${c1}00 92%, transparent 100%)`,
              filter: 'blur(0.75px)',
            }}
          />
          <div
            className="noc-ib-accent shrink-0 w-2 sm:w-2.5 self-stretch relative z-[1]"
            style={{
              background: `linear-gradient(180deg, ${c2} 0%, ${c2}dd 45%, #0a0a0a 100%)`,
              boxShadow: `2px 0 14px ${c2}66`,
            }}
          />
          <div className="flex-1 flex flex-col justify-center min-w-0 px-3 sm:px-4 py-2 gap-1 relative z-[2]">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <span
                className="noc-ib-live w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full shrink-0"
                style={{ background: '#f43f5e', boxShadow: '0 0 14px #f43f5e' }}
              />
              {eventLogoUrl ? (
                <img
                  src={eventLogoUrl}
                  alt=""
                  className="noc-ib-brand object-contain shrink-0 drop-shadow-lg"
                  style={{
                    width: 'clamp(40px, 9vw, 56px)',
                    height: 'clamp(40px, 9vw, 56px)',
                  }}
                />
              ) : null}
              <span
                className="noc-ib-headline font-black text-white uppercase tracking-tight shrink-0 leading-none"
                style={{ fontSize: 'clamp(0.95rem, 2.6vw + 0.4rem, 1.55rem)' }}
              >
                On the clock
              </span>
              {logo ? (
                <div
                  className="noc-ib-logo-wrap rounded-lg overflow-hidden border-2 border-white/15 shrink-0 flex items-center justify-center"
                  style={{
                    width: 'clamp(44px, 10vw, 64px)',
                    height: 'clamp(44px, 10vw, 64px)',
                    background: `linear-gradient(145deg, ${c1}33 0%, #0d0d0d 100%)`,
                  }}
                >
                  <img src={logo} alt="" className="noc-ib-logo object-contain w-[82%] h-[82%]" />
                </div>
              ) : null}
              <span
                className="noc-ib-team font-black text-white uppercase min-w-0 flex-1 leading-[1.08] break-words [overflow-wrap:anywhere]"
                style={{
                  fontSize: nocInfoBarTeamNameFontSize(team.name),
                  textShadow: `0 0 18px ${c1}55`,
                }}
              >
                {team.name}
              </span>
              <span className="noc-ib-meta flex flex-col items-end sm:flex-row sm:items-baseline gap-0.5 sm:gap-2 shrink-0 font-black leading-none tabular-nums">
                <span style={{ color: ec, fontSize: 'clamp(0.72rem, 1.65vw + 0.35rem, 1rem)' }}>
                  Round {round}
                </span>
                <span style={{ color: c1, fontSize: 'clamp(0.78rem, 1.75vw + 0.38rem, 1.08rem)' }}>
                  Pick {pickInRound}
                </span>
                <span className="text-white/35 font-bold text-[clamp(0.58rem,1.2vw,0.72rem)] mt-0.5 sm:mt-0 sm:ml-1">
                  #{pickNumber}
                </span>
              </span>
            </div>
            <p
              className="noc-ib-sub text-white/45 font-bold uppercase tracking-wider leading-snug line-clamp-2 sm:line-clamp-1"
              style={{ fontSize: 'clamp(0.62rem, 1.35vw + 0.3rem, 0.82rem)' }}
            >
              {sublineText}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] pointer-events-none overflow-hidden"
      style={{ background: '#020203' }}
    >
      {/* Upper field — vignette + faint grid (broadcast booth) */}
      <div
        className="noc-ambient absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 85% 65% at 50% 35%, ${c1}14 0%, transparent 55%),
            linear-gradient(180deg, #0a0b10 0%, #050508 45%, #020203 100%)
          `,
          boxShadow: `inset 0 -120px 100px -40px rgba(0,0,0,0.85)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)`,
          backgroundSize: '100% 4px',
        }}
      />

      {/* Lower third — slides up */}
      <div
        className="noc-lt-wrap absolute left-0 right-0 bottom-0 flex"
        style={{
          minHeight: 'min(34vh, 320px)',
          maxHeight: '42vh',
        }}
      >
        <div
          className="noc-accent shrink-0 w-2 sm:w-3 self-stretch"
          style={{
            background: `linear-gradient(180deg, ${c1} 0%, ${c2} 100%)`,
            boxShadow: `4px 0 24px ${c1}55`,
          }}
        />

        <div
          className="flex-1 flex flex-col min-w-0 relative"
          style={{
            background: `linear-gradient(180deg, rgba(12,13,20,0.97) 0%, rgba(6,7,11,0.99) 100%)`,
            boxShadow: `0 -12px 48px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)`,
          }}
        >
          {/* Top accent (broadcast bar) */}
          <div
            className="absolute top-0 left-0 right-0 h-0.5 pointer-events-none opacity-90"
            style={{ background: barTopLine }}
          />
          <div
            className="absolute top-0.5 left-0 right-0 h-px pointer-events-none"
            style={{ background: `linear-gradient(90deg, transparent, ${ec}66, transparent)` }}
          />

          <div className="flex-1 flex flex-col justify-end px-4 sm:px-8 pb-5 pt-6 min-w-0 gap-4">
            {/* LIVE + headline row */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-5">
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="noc-live-dot w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: '#f43f5e', boxShadow: '0 0 12px #f43f5e' }}
                />
                <span
                  className="noc-live-label font-black uppercase tracking-[0.2em] text-white/95"
                  style={{ fontSize: 'clamp(0.65rem, 1.1vw, 0.8rem)' }}
                >
                  Live
                </span>
              </div>
              <div className="h-4 w-px bg-white/15 shrink-0 hidden sm:block" />
              {eventLogoUrl ? (
                <img
                  src={eventLogoUrl}
                  alt=""
                  className="noc-draft-logo object-contain shrink-0 drop-shadow-lg"
                  style={{
                    width: 'clamp(40px, 7vw, 56px)',
                    height: 'clamp(40px, 7vw, 56px)',
                  }}
                />
              ) : null}
              <h1
                className="noc-headline font-black uppercase tracking-[0.12em] text-white leading-none"
                style={{
                  fontSize: 'clamp(1.35rem, 3.2vw, 2.4rem)',
                  textShadow: `0 2px 24px rgba(0,0,0,0.95), 0 0 40px ${ec}33`,
                }}
              >
                On the clock
              </h1>
            </div>

            <p
              className="noc-subline text-white/50 font-semibold uppercase tracking-widest max-w-[min(96vw,900px)] break-words leading-snug"
              style={{ fontSize: 'clamp(0.6rem, 1vw, 0.72rem)' }}
            >
              {sublineText}
            </p>

            {/* Logo + team lockup */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-8 min-w-0">
              {logo && (
                <div
                  className="noc-logo-frame rounded-xl overflow-hidden shrink-0 border-2 flex items-center justify-center"
                  style={{
                    width: 'clamp(88px, 14vw, 132px)',
                    height: 'clamp(88px, 14vw, 132px)',
                    borderColor: c2,
                    background: `linear-gradient(145deg, ${c1}33 0%, rgba(0,0,0,0.5) 100%)`,
                    boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08) inset`,
                  }}
                >
                  <img
                    src={logo}
                    alt=""
                    className="noc-logo-img object-contain w-[82%] h-[82%] drop-shadow-lg"
                  />
                </div>
              )}
              <div
                className="noc-team-name font-black text-white uppercase min-w-0 max-w-full break-words leading-tight"
                style={{
                  fontSize: nocTeamNameFontSize(team.name),
                  textShadow: `0 3px 28px rgba(0,0,0,0.95), 0 0 48px ${c1}44`,
                  WebkitTextStroke: `1px ${c2}99`,
                }}
              >
                {team.name}
              </div>
            </div>

            {/* Chyron strip */}
            <div
              className="noc-chyron relative rounded-lg overflow-hidden"
              style={{
                background: `linear-gradient(90deg, rgba(0,0,0,0.55) 0%, ${c1}22 50%, rgba(0,0,0,0.55) 100%)`,
                border: `1px solid ${c1}55`,
              }}
            >
              <div
                className="noc-shine pointer-events-none absolute inset-y-0 w-1/3 z-10"
                style={{
                  background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)`,
                }}
              />
              <div className="relative z-20 flex flex-wrap justify-between sm:justify-start gap-y-3 gap-x-6 sm:gap-x-12 px-4 py-3 sm:px-6 sm:py-3.5">
                {[
                  { label: 'Round', value: round },
                  { label: 'Pick', value: pickInRound },
                  { label: 'Overall', value: pickNumber },
                ].map(({ label, value }) => (
                  <div key={label} className="noc-meta-col flex items-baseline gap-3">
                    <span
                      className="font-bold uppercase tracking-widest text-white/45 shrink-0"
                      style={{ fontSize: 'clamp(0.58rem, 0.95vw, 0.7rem)' }}
                    >
                      {label}
                    </span>
                    <span
                      className="font-black tabular-nums text-white"
                      style={{
                        fontSize: 'clamp(1.75rem, 4vw, 2.75rem)',
                        lineHeight: 1,
                        textShadow: `0 0 24px ${c1}99`,
                        color: '#fff',
                      }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
