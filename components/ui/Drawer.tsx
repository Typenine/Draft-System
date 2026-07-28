"use client";

import { ReactNode, useEffect, useRef } from "react";

export function Drawer({
  open,
  onClose,
  side = "right",
  title,
  children,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleIdRef = useRef<string>(`drawer-title-${Math.random().toString(36).slice(2)}`);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
      if (e.key === "Tab") {
        const root = panelRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;
  const sideMargin = side === "right" ? "ml-auto" : "mr-auto";

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 flex">
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleIdRef.current : undefined}
            tabIndex={-1}
            style={{ width }}
            className={[
              "evw-surface border border-[var(--border)] h-full shadow-[var(--shadow-soft)] outline-none",
              "transform transition-transform duration-200",
              sideMargin,
            ].join(" ")}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h3 id={titleIdRef.current} className="text-base font-semibold text-[var(--text)]">
                  {title}
                </h3>
              </div>
            )}
            <div className="p-4 h-full overflow-y-auto">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Drawer;
