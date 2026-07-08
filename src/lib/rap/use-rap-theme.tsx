"use client";
// Shared color-blind-safe theme state for the RAP pages. Both /rap and
// /rap/explore read/write the same localStorage key, so the palette a user picks
// on one page carries to the other. See lib/rap/palette.ts for the themes.
import { useEffect, useState } from "react";
import { DEFAULT_THEME, THEMES } from "./palette";
import type { Theme } from "./palette";

const STORAGE_KEY = "rapPalette";

export function useRapTheme() {
  const [themeKey, setThemeKey] = useState(DEFAULT_THEME.key);
  // restore saved palette after mount (keeps SSR === first client render)
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((t) => t.key === saved)) setThemeKey(saved);
  }, []);
  const setTheme = (k: string) => {
    setThemeKey(k);
    localStorage.setItem(STORAGE_KEY, k);
  };
  const theme = THEMES.find((t) => t.key === themeKey) ?? DEFAULT_THEME;
  return { theme, themeKey, setTheme };
}

// Distinct, stable color per category by its position in a SORTED domain — same
// scheme on both pages, so a given sector/type gets the same color everywhere.
export function categoryColor(theme: Theme, sortedDomain: string[], key: string): string {
  const i = sortedDomain.indexOf(key);
  return theme.categorical[(i < 0 ? 0 : i) % theme.categorical.length];
}

export function PaletteSelect({ themeKey, setTheme, theme }: {
  themeKey: string; setTheme: (k: string) => void; theme: Theme;
}) {
  return (
    <div>
      <div className="text-ink3 text-xs uppercase tracking-widest mb-1">Palette · color-blind safe</div>
      <div className="flex items-center gap-2">
        <select value={themeKey} onChange={(e) => setTheme(e.target.value)}
          className="px-3 py-2 rounded border border-line bg-bg text-sm">
          {THEMES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <div className="flex gap-0.5">
          {theme.categorical.slice(0, 7).map((c) => (
            <span key={c} className="inline-block w-3 h-4 rounded-sm" style={{ background: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}
