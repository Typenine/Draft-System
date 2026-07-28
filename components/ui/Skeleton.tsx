import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Lightweight skeleton block using existing tokens.
 * - Uses animate-pulse for shimmer-like effect
 * - Defaults to subtle neutral fill via border color token
 */
export default function Skeleton({ className = '', ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={[
        'animate-pulse rounded-md bg-[var(--border)]',
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
