"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";

/**
 * ThemeToggle switches html[data-theme] between 'dark' and 'light'.
 * - Respects system preference on first load (handled by pre-hydration script in layout.tsx)
 * - Persists to localStorage
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    // Read current theme from html attribute, fallback to dark
    try {
      const el = document.documentElement;
      const current = el.getAttribute("data-theme") || "dark";
      setTheme(current);
    } catch {}
  }, []);

  const toggle = () => {
    try {
      const el = document.documentElement;
      const next = (theme === "light" ? "dark" : "light") as "dark" | "light";
      el.setAttribute("data-theme", next);
      el.style.setProperty("color-scheme", next);
      localStorage.setItem("theme", next);
      setTheme(next);
    } catch {}
  };

  const label = theme === "light" ? "Switch to dark mode" : "Switch to light mode";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={label}
      role="switch"
      aria-checked={theme === "light"}
      title={label}
    >
      {theme === "light" ? (
        // Moon icon
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        // Sun icon
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      )}
      <span className="text-sm">{theme === "light" ? "Light" : "Dark"}</span>
    </Button>
  );
}
