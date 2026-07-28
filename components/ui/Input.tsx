import { forwardRef, InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  fullWidth?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = "md", invalid, fullWidth = true, ...props }, ref) => {
    const base =
      "block rounded-[var(--radius-input,0.5rem)] border bg-[var(--surface)] text-[var(--text)] placeholder-[var(--muted)] shadow-[var(--shadow-soft)] focus-visible:ring-2 ring-[var(--focus)] ring-offset-2 ring-offset-[var(--surface)] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";
    const sizes: Record<"sm" | "md" | "lg", string> = {
      sm: "text-sm px-2.5 py-1.5",
      md: "text-sm px-3 py-2",
      lg: "text-base px-3.5 py-2.5",
    };
    const sizeKey: keyof typeof sizes = ((size ?? "md") as "sm" | "md" | "lg");

    return (
      <input
        ref={ref}
        className={[
          base,
          sizes[sizeKey],
          invalid ? "border-[var(--danger)]" : "border-[var(--border)]",
          fullWidth && "w-full",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={invalid || undefined}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export default Input;
