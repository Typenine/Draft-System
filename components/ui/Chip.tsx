import { ButtonHTMLAttributes, forwardRef } from "react";

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  variant?: "neutral" | "accent" | "outline";
  size?: "sm" | "md";
};

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected, variant = "neutral", size = "md", ...props }, ref) => {
    const sizes = {
      sm: "text-xs px-2 py-1",
      md: "text-sm px-3 py-1.5",
    } as const;

    const classes = [
      "inline-flex items-center gap-1 rounded-full border transition-colors pill",
      size === "sm" ? sizes.sm : sizes.md,
      variant === "accent" ? (selected ? "pill-active" : "pill-hover text-[var(--muted)]") : undefined,
      variant === "neutral"
        ? selected
          ? "evw-surface border-[var(--border)]"
          : "pill-hover text-[var(--muted)] border-transparent"
        : undefined,
      variant === "outline" ? "border-[var(--border)] text-[var(--text)]" : undefined,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return <button ref={ref} className={classes} {...props} />;
  }
);

Chip.displayName = "Chip";

export default Chip;
