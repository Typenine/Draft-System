import Link from 'next/link';
import { AnchorHTMLAttributes } from 'react';

export type LinkButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
};

export default function LinkButton({
  href,
  children,
  className,
  variant = 'secondary',
  size = 'md',
  fullWidth,
  ...props
}: LinkButtonProps) {
  const base = 'btn focus-visible:ring-2 ring-[var(--focus)] ring-offset-2 ring-offset-[var(--surface)] gap-2';
  const sizes: Record<NonNullable<LinkButtonProps['size']>, string> = {
    sm: 'text-sm px-2.5 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2',
  };
  const variants: Record<NonNullable<LinkButtonProps['variant']>, string> = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'pill pill-hover text-[var(--text)]',
    danger: 'bg-[var(--danger)] text-on-brand hover:opacity-90',
  };
  const classes = [base, sizes[size], variants[variant], fullWidth && 'w-full', className]
    .filter(Boolean)
    .join(' ');
  return (
    <Link href={href} className={classes} {...props}>
      {children}
    </Link>
  );
}
