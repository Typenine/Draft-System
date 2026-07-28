import { HTMLAttributes, ReactNode } from "react";

export default function SectionHeader({
  title,
  subtitle,
  actions,
  className,
  ...props
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const rootClass = [
    "flex items-end justify-between gap-3 mb-6",
    className,
  ].filter(Boolean).join(" ");
  return (
    <div className={rootClass} {...props}>
      <div>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text)] flex items-center gap-3">
          <span className="inline-block w-1.5 h-6 rounded-full accent-stripe" />
          {title}
        </h2>
        {subtitle && <p className="text-sm text-[var(--muted)] mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
