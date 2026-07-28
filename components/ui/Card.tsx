import { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "evw-surface border border-[var(--border)] rounded-[var(--radius-card)] shadow-[var(--shadow-soft)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["px-4 py-3 border-b border-[var(--border)]", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={["text-base font-semibold text-[var(--text)]", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["p-4", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["px-4 py-3 border-t border-[var(--border)]", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export default Card;
