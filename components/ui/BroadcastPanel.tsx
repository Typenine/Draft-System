'use client';

import { useState, type HTMLAttributes, type ReactNode } from 'react';
import Image from 'next/image';
import { getTeamLogoPath } from '@/lib/utils/team-utils';
import { PANEL } from '@/lib/ui/broadcast-styles';

export {
  PANEL,
  teamAccent,
  broadcastLabelClass,
  broadcastFieldClass,
  broadcastFieldStyle,
  broadcastScrollBoxClass,
  broadcastScrollBoxStyle,
  broadcastMutedTextStyle,
  broadcastFaintTextStyle,
  broadcastBodyTextStyle,
  broadcastChipButtonClass,
} from '@/lib/ui/broadcast-styles';

const DEFAULT_ACCENT = '#9CA3AF';

export function BroadcastTeamLogo({
  team,
  accent,
  size = 'md',
}: {
  team: string;
  accent: string;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = useState(false);
  const logo = getTeamLogoPath(team);
  const outer = size === 'sm' ? 'h-9 w-9' : 'h-12 w-12';
  const inner = size === 'sm' ? 'h-7 w-7' : 'h-10 w-10';
  const px = size === 'sm' ? 36 : 48;
  return (
    <div
      className={`relative flex ${outer} shrink-0 items-center justify-center overflow-hidden rounded-full`}
      style={{
        background: PANEL.tintMedium,
        boxShadow: `inset 0 0 0 1px ${PANEL.tintStronger}, 0 0 0 2px ${accent}33`,
      }}
      aria-hidden="true"
    >
      {failed ? (
        <span className={`${size === 'sm' ? 'text-sm' : 'text-lg'} font-extrabold`} style={{ color: accent }}>
          {team.charAt(0).toUpperCase()}
        </span>
      ) : (
        <Image
          src={logo}
          alt=""
          width={px}
          height={px}
          sizes={`${px}px`}
          loading="lazy"
          className={`${inner} object-contain`}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function BroadcastAccentBadge({
  accent,
  children,
  className,
}: {
  accent: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        'inline-flex h-5 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-bold uppercase tracking-wide',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        color: accent,
        background: `${accent}1f`,
        boxShadow: `inset 0 0 0 1px ${accent}40`,
      }}
    >
      {children}
    </span>
  );
}

export function BroadcastSectionLabel({ accent, children }: { accent: string; children: ReactNode }) {
  return (
    <div
      className="text-[10px] font-bold uppercase tracking-[0.22em] mb-2"
      style={{ color: accent }}
    >
      {children}
    </div>
  );
}

type BroadcastPanelProps = {
  accent?: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
} & Pick<HTMLAttributes<HTMLElement>, 'id'>;

export function BroadcastPanel({
  accent = DEFAULT_ACCENT,
  title,
  meta,
  children,
  className,
  bodyClassName,
  id,
}: BroadcastPanelProps) {
  return (
    <article
      id={id}
      className={[
        'overflow-hidden rounded-2xl transition-shadow duration-200',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        background: PANEL.card,
        boxShadow: `inset 0 0 0 1px ${PANEL.border}, ${PANEL.shadow}`,
      }}
    >
      <div className="h-[3px] w-full" style={{ background: accent }} aria-hidden="true" />
      <div
        className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6"
        style={{ background: PANEL.headerBg, borderBottom: `1px solid ${PANEL.hairline}` }}
      >
        <span
          className="text-[11px] font-extrabold uppercase tracking-[0.3em]"
          style={{ color: PANEL.text }}
        >
          {title}
        </span>
        {meta ? (
          <div className="text-xs font-semibold tabular-nums" style={{ color: PANEL.muted }}>
            {meta}
          </div>
        ) : null}
      </div>
      <div className={['px-5 py-4 sm:px-6', bodyClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
    </article>
  );
}

export function BroadcastSubmitButton({
  accent,
  children,
  disabled,
  type = 'submit',
  onClick,
}: {
  accent: string;
  children: ReactNode;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="rounded px-4 py-2 text-sm font-bold uppercase tracking-wider transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
      style={{
        color: PANEL.text,
        background: `${accent}33`,
        boxShadow: `inset 0 0 0 1px ${accent}66`,
      }}
    >
      {children}
    </button>
  );
}
