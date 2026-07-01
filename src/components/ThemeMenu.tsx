"use client";

// Light/dark toggle. Clicking flips the mode, persists it to localStorage,
// and toggles the `dark` class on <html> (the palette lives in globals.css).
import { useEffect, useState } from "react";

type Mode = "light" | "dark";
export const THEME_KEY = "portal-theme";

export function ThemeMenu() {
  const [mode, setMode] = useState<Mode>("light");

  // The no-flash script already applied the class; sync UI state on mount.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(THEME_KEY) || "null");
      setMode(s?.mode === "dark" ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, []);

  function toggle() {
    const next: Mode = mode === "dark" ? "light" : "dark";
    setMode(next);
    localStorage.setItem(THEME_KEY, JSON.stringify({ mode: next }));
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  const isDark = mode === "dark";
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30"
    >
      <span aria-hidden>{isDark ? "☀" : "☾"}</span>
      {isDark ? "Light mode" : "Dark mode"}
    </button>
  );
}
