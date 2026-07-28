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

export default function EndOfRoundAnimation({ roundNumber, eventLogoUrl, eventColor1, onComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const ec = eventColor1 || '#bf9944';

  useEffect(() => {
    if (tlRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const watermark    = el.querySelector<HTMLElement>('.eor-watermark');
    const logo         = el.querySelector<HTMLElement>('.eor-logo');
    const divider      = el.querySelector<HTMLElement>('.eor-divider');
    const roundLabel   = el.querySelector<HTMLElement>('.eor-round');
    const completeLabel = el.querySelector<HTMLElement>('.eor-complete');

    gsap.set(el, { autoAlpha: 0 });
    if (watermark)     gsap.set(watermark,     { autoAlpha: 0, scale: 0.88, y: 20 });
    if (logo)          gsap.set(logo,          { autoAlpha: 0, scale: 0.65 });
    if (divider)       gsap.set(divider,       { scaleX: 0, transformOrigin: 'center center' });
    if (roundLabel)    gsap.set(roundLabel,    { autoAlpha: 0, y: -55 });
    if (completeLabel) gsap.set(completeLabel, { autoAlpha: 0, y: 40 });

    const tl = gsap.timeline({ onComplete: () => onComplete?.() });
    tlRef.current = tl;

    // Fade in bg
    tl.to(el, { autoAlpha: 1, duration: 0.55, ease: 'power2.out' });
    // Watermark rises
    tl.to(watermark, { autoAlpha: 0.08, scale: 1, y: 0, duration: 2.0, ease: 'power2.out' }, '-=0.3');
    // Logo
    if (logo) tl.to(logo, { autoAlpha: 1, scale: 1, duration: 0.7, ease: 'back.out(1.5)' }, '-=1.6');
    // Divider expands
    if (divider) tl.to(divider, { scaleX: 1, duration: 0.55, ease: 'power3.inOut' }, '-=0.5');
    // Round label falls from above
    if (roundLabel) tl.to(roundLabel, { autoAlpha: 1, y: 0, duration: 0.75, ease: 'power3.out' }, '-=0.45');
    // Complete rises from below
    if (completeLabel) tl.to(completeLabel, { autoAlpha: 1, y: 0, duration: 0.65, ease: 'power3.out' }, '-=0.5');
    // Hold
    tl.to({}, { duration: 3.5 });
    // Fade out
    tl.to(el, { autoAlpha: 0, duration: 0.7, ease: 'power2.inOut' });

    return () => { tlRef.current?.kill(); tlRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9997] overflow-hidden pointer-events-none"
      style={{ background: '#060810' }}
    >
      {/* Pittsburgh steel grid texture */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: [
          `repeating-linear-gradient(45deg,transparent 0,transparent 46px,${ec}14 46px,${ec}14 48px)`,
          `repeating-linear-gradient(-45deg,transparent 0,transparent 46px,${ec}14 46px,${ec}14 48px)`,
        ].join(','),
      }} />
      {/* Radial glow center */}
      <div className="absolute inset-0" style={{
        background: `radial-gradient(ellipse 70% 60% at 50% 50%, ${ec}1a 0%, transparent 68%)`,
      }} />
      {/* Bottom furnace glow */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none" style={{
        background: `linear-gradient(to top, #be161e0d 0%, transparent 100%)`,
      }} />

      {/* Pittsburgh 26 script watermark */}
      <div
        className="eor-watermark absolute inset-0 flex items-center justify-center select-none pointer-events-none"
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
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6">
        {eventLogoUrl && (
          <img
            src={eventLogoUrl}
            alt=""
            className="eor-logo object-contain"
            style={{ width: 'clamp(80px,11vw,140px)', height: 'clamp(80px,11vw,140px)' }}
          />
        )}
        <div
          className="eor-divider rounded-full"
          style={{
            width: 'clamp(160px,26vw,320px)',
            height: '3px',
            background: `linear-gradient(90deg, transparent, ${ec}, transparent)`,
          }}
        />
        <div
          className="eor-round font-black uppercase text-white text-center leading-none"
          style={{
            fontFamily: '"Impact", "Arial Black", sans-serif',
            fontSize: 'clamp(4rem,13vw,11rem)',
            letterSpacing: '0.05em',
            textShadow: `0 4px 32px rgba(0,0,0,0.9), 0 0 60px ${ec}44`,
            WebkitTextStroke: `2px ${ec}55`,
            paintOrder: 'stroke fill',
          }}
        >
          Round {roundNumber}
        </div>
        <div
          className="eor-complete font-black uppercase text-center"
          style={{
            fontFamily: '"Impact", "Arial Black", sans-serif',
            fontSize: 'clamp(1.8rem,5.5vw,4.5rem)',
            letterSpacing: '0.22em',
            color: ec,
            textShadow: `0 0 40px ${ec}88, 0 2px 16px rgba(0,0,0,0.8)`,
          }}
        >
          Complete
        </div>
      </div>
    </div>
  );
}
