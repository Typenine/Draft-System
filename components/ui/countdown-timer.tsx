'use client';

import { useEffect, useState } from 'react';
import { getTimeRemaining } from '@/lib/utils/countdown';
import {
  BroadcastPanel,
  PANEL,
  broadcastBodyTextStyle,
  broadcastFaintTextStyle,
  broadcastMutedTextStyle,
} from '@/components/ui/BroadcastPanel';

interface CountdownTimerProps {
  targetDate: Date | string;
  title: string;
  className?: string;
  emphasis?: boolean;
}

const COUNTDOWN_ACCENT = '#38bdf8';

function CountdownGrid({
  timeRemaining,
  emphasis,
}: {
  timeRemaining: ReturnType<typeof getTimeRemaining>;
  emphasis: boolean;
}) {
  const units = [
    { label: 'Days', value: timeRemaining.days },
    { label: 'Hours', value: timeRemaining.hours },
    { label: 'Minutes', value: timeRemaining.minutes },
    { label: 'Seconds', value: timeRemaining.seconds },
  ];

  return (
    <div className={`grid grid-cols-4 text-center ${emphasis ? 'gap-2 sm:gap-3' : 'gap-2'}`}>
      {units.map((unit) => (
        <div
          key={unit.label}
          className={`flex flex-col rounded-xl ${emphasis ? 'px-2 py-3 sm:px-3 sm:py-4' : 'px-2 py-2.5'}`}
          style={{
            background: PANEL.tint,
            boxShadow: `inset 0 0 0 1px ${PANEL.hairline}, inset 0 1px 0 ${PANEL.insetTop}`,
            borderTop: `2px solid ${COUNTDOWN_ACCENT}55`,
          }}
        >
          <span
            className={`${emphasis ? 'text-4xl sm:text-5xl font-extrabold' : 'text-3xl font-bold'} tabular-nums leading-none`}
            style={broadcastBodyTextStyle}
          >
            {String(unit.value).padStart(2, '0')}
          </span>
          <span
            className={`${emphasis ? 'mt-2 text-[11px] sm:text-xs tracking-wider' : 'mt-1.5 text-[10px] tracking-wider'} uppercase font-semibold`}
            style={broadcastFaintTextStyle}
          >
            {unit.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CountdownTimer({
  targetDate,
  title,
  className = '',
  emphasis = false,
}: CountdownTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState(getTimeRemaining(targetDate));
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const timer = setInterval(() => {
      setTimeRemaining(getTimeRemaining(targetDate));
    }, 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  const body = !isClient ? (
    <div className="text-center text-sm" style={broadcastMutedTextStyle}>
      Loading...
    </div>
  ) : timeRemaining.total <= 0 ? (
    <div
      className="rounded-xl py-4 text-center text-2xl font-extrabold uppercase tracking-wider"
      style={{
        ...broadcastBodyTextStyle,
        background: PANEL.tint,
        boxShadow: `inset 0 0 0 1px ${PANEL.hairline}`,
        borderTop: `2px solid ${COUNTDOWN_ACCENT}`,
      }}
    >
      Started!
    </div>
  ) : (
    <CountdownGrid timeRemaining={timeRemaining} emphasis={emphasis} />
  );

  return (
    <BroadcastPanel
      accent={COUNTDOWN_ACCENT}
      title={title}
      className={className}
      bodyClassName={emphasis ? '!py-5' : undefined}
    >
      {body}
    </BroadcastPanel>
  );
}
