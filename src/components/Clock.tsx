'use client';

import { useEffect, useState } from 'react';

export function Clock({ deadline, status, fallback }: { deadline: string | null; status?: string; fallback: number }) {
  const [seconds, setSeconds] = useState(fallback);

  useEffect(() => {
    const update = () => {
      if (!deadline || status !== 'LIVE') {
        setSeconds(fallback);
        return;
      }
      setSeconds(Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadline, fallback, status]);

  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remaining = (seconds % 60).toString().padStart(2, '0');
  return <span className={seconds <= 10 && status === 'LIVE' ? 'clock clock-danger' : 'clock'}>{minutes}:{remaining}</span>;
}
