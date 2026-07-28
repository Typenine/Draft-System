'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { Dancing_Script } from 'next/font/google';

const dancingScript = Dancing_Script({ subsets: ['latin'], weight: ['700'] });

interface Props {
  roundNumber: number;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  onComplete?: () => void;
}

export default function StartOfRoundAnimation({ roundNumber, eventLogoUrl, eventColor1, onComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const ec = eventColor1 || '#bf9944';

  useEffect(() => {
    if (tlRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const watermark  = el.querySelector<HTMLElement>('.sor-watermark');
    const logo       = el.querySelector<HTMLElement>('.sor-logo');
    const divider    = el.querySelector<HTMLElement>('.sor-divider');
    const roundLabel = el.querySelector<HTMLElement>('.sor-round');
    const beginLabel = el.querySelector<HTMLElement>('.sor-begin');
    const wipeL      = el.querySelector<HTMLElement>('.sor-wipe-l');
    const wipeR      = el.querySelector<HTMLElement>('.sor-wipe-r');

    gsap.set(el, { autoAlpha: 0 });
    if (watermark)  gsap.set(watermark,  { autoAlpha: 0, scale: 0.88, y: -20 });
    if (logo)       gsap.set(logo,       { autoAlpha: 0, scale: 0.6 });
    if (divider)    gsap.set(divider,    { scaleX: 0, transformOrigin: 'center center' });
    if (roundLabel) gsap.set(roundLabel, { autoAlpha: 0, scale: 1.28 });
    if (beginLabel) gsap.set(beginLabel, { autoAlpha: 0, y: 28 });
    // Wipes start closed over the entire screen; will retract outward
    if (wipeL) gsap.set(wipeL, { scaleX: 1, transformOrigin: 'left center' });
    if (wipeR) gsap.set(wipeR, { scaleX: 1, transformOrigin: 'right center' });

    const tl = gsap.timeline({ onComplete: () => onComplete?.() });
    tlRef.current = tl;

    // Container in
    tl.to(el, { autoAlpha: 1, duration: 0.35, ease: 'power2.out' });
    // Wipes retract outward — dramatic reveal
    if (wipeL) tl.to(wipeL, { scaleX: 0, duration: 0.6, ease: 'power2.inOut' }, '-=0.1');
    if (wipeR) tl.to(wipeR, { scaleX: 0, duration: 0.6, ease: 'power2.inOut' }, '<');
    // Watermark drifts into place
    tl.to(watermark, { autoAlpha: 0.08, scale: 1, y: 0, duration: 1.8, ease: 'power2.out' }, '-=0.45');
    // Logo
    if (logo) tl.to(logo, { autoAlpha: 1, scale: 1, duration: 0.7, ease: 'back.out(1.6)' }, '-=1.4');
    // Divider
    if (divider) tl.to(divider, { scaleX: 1, duration: 0.52, ease: 'power3.inOut' }, '-=0.5');
    // Round label scales into place
    if (roundLabel) tl.to(roundLabel, { autoAlpha: 1, scale: 1, duration: 0.7, ease: 'back.out(1.4)' }, '-=0.42');
    // Begin label rises
    if (beginLabel) tl.to(beginLabel, { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power3.out' }, '-=0.45');
    // Hold
    tl.to({}, { duration: 3.5 });
    // Fade out
    tl.to(el, { autoAlpha: 0, duration: 0.6, ease: 'power2.in' });

    return () => { tlRef.current?.kill(); tlRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9997] overflow-hidden"
      style={{ background: '#060810' }}
    >
      {/* Steel grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: [
          `repeating-linear-gradient(45deg,transparent 0,transparent 46px,${ec}14 46px,${ec}14 48px)`,
          `repeating-linear-gradient(-45deg,transparent 0,transparent 46px,${ec}14 46px,${ec}14 48px)`,
        ].join(','),
      }} />
      {/* Glow */}
      <div className="absolute inset-0" style={{
        background: `radial-gradient(ellipse 70% 60% at 50% 50%, ${ec}1c 0%, transparent 68%)`,
      }} />

      {/* Dramatic split wipes — start covering screen, retract outward on open */}
      <div
        className="sor-wipe-l absolute inset-y-0 left-0"
        style={{
          width: '51%',
          background: `linear-gradient(90deg, #be161e 0%, ${ec}bb 100%)`,
          zIndex: 20,
        }}
      />
      <div
        className="sor-wipe-r absolute inset-y-0 right-0"
        style={{
          width: '51%',
          background: `linear-gradient(270deg, #be161e 0%, ${ec}bb 100%)`,
          zIndex: 20,
        }}
      />

      {/* Pittsburgh 26 script watermark */}
      <div
        className="sor-watermark absolute inset-0 flex items-center justify-center select-none pointer-events-none"
        style={{ overflow: 'hidden' }}
      >
        <span style={{
          fontFamily: dancingScript.style.fontFamily,
          fontWeight: 700,
          fontSize: 'clamp(6rem, 18vw, 16rem)',
          color: ec,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}>
          Pittsburgh 26
        </span>
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6" style={{ zIndex: 10 }}>
        {eventLogoUrl && (
          <img
            src={eventLogoUrl}
            alt=""
            className="sor-logo object-contain"
            style={{ width: 'clamp(80px,11vw,140px)', height: 'clamp(80px,11vw,140px)' }}
          />
        )}
        <div
          className="sor-divider rounded-full"
          style={{
            width: 'clamp(160px,26vw,320px)',
            height: '3px',
            background: `linear-gradient(90deg, transparent, ${ec}, transparent)`,
          }}
        />
        <div
          className="sor-round font-black uppercase text-white text-center leading-none"
          style={{
            fontFamily: '"Impact", "Arial Black", sans-serif',
            fontSize: 'clamp(4rem,13vw,11rem)',
            letterSpacing: '0.05em',
            textShadow: `0 4px 32px rgba(0,0,0,0.9), 0 0 70px ${ec}55`,
            WebkitTextStroke: `2px ${ec}55`,
            paintOrder: 'stroke fill',
          }}
        >
          Round {roundNumber}
        </div>
        <div
          className="sor-begin font-black uppercase text-center"
          style={{
            fontFamily: '"Impact", "Arial Black", sans-serif',
            fontSize: 'clamp(1.6rem,4.5vw,3.8rem)',
            letterSpacing: '0.3em',
            color: ec,
            textShadow: `0 0 40px ${ec}99, 0 2px 16px rgba(0,0,0,0.8)`,
          }}
        >
          Now Beginning
        </div>
      </div>
    </div>
  );
}
