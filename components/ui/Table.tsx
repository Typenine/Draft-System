import { HTMLAttributes, TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from "react";

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={[
        "w-full text-left border-collapse [&_th]:text-[var(--muted)] [&_th]:font-medium [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide",
        "[&_th,td]:px-3 [&_th,td]:py-2",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={["border-b border-[var(--border)]", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={["[&_tr]:border-b [&_tr]:border-[var(--border)]", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={[
        "hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={["text-[var(--muted)]", className].filter(Boolean).join(" ")} {...props} />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={["text-[var(--text)]", className].filter(Boolean).join(" ")} {...props} />;
}

export default Table;
