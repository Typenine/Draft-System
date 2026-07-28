import { HTMLAttributes, ReactNode } from "react";

// Minimal tooltip that leverages the native title attribute for accessibility and simplicity.
export default function Tooltip({
  content,
  children,
  className,
  ...props
}: {
  content: string;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span title={content} className={className} {...props}>
      {children}
    </span>
  );
}
