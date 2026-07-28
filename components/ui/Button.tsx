import { ButtonHTMLAttributes, forwardRef } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", fullWidth, ...props }, ref) => {
    const base = "btn focus-visible:ring-2 ring-[var(--focus)] ring-offset-2 ring-offset-[var(--surface)] gap-2";
    const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
      sm: "text-sm px-2.5 py-1",
      md: "text-sm px-3 py-1.5",
      lg: "text-base px-4 py-2",
    };
    const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
      primary: "btn-primary",
      secondary: "btn-secondary",
      ghost: "pill pill-hover text-[var(--text)]",
      danger: "bg-[var(--danger)] text-on-brand hover:opacity-90",
    };

    return (
      <button
        ref={ref}
        className={[base, sizes[size], variants[variant], fullWidth && "w-full", className].filter(Boolean).join(" ")}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export default Button;
