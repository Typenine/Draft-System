import { LabelHTMLAttributes } from 'react';

export default function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={[ 'text-sm text-[var(--muted)]', className ].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
