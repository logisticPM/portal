"use client";

// Runtime theme control. The header button toggles light/dark on click.
// A small swatch next to it opens the color customizer: two editable colors
// per mode (background + accent), persisted to localStorage and applied by
// overriding the --bg / --amber CSS variables. The rest of the palette
// derives from the mode defaults in globals.css.
import { useEffect, useRef, useState } from "react";

type Mode = "light" | "dark";
type Pair = { bg: string; accent: string };
export type Theme = { mode: Mode; light: Pair; dark: Pair };

// Must match the :root / .dark defaults in globals.css.
export const DEFAULT_THEME: Theme = {
  mode: "light",
  light: { bg: "#EFE7D5", accent: "#A06A12" },
  dark: { bg: "#221E18", accent: "#D99A3A" },
};

export const THEME_KEY = "portal-theme";

function hexToRgb(hex: string): string {
  let m = hex.replace("#", "");
  if (m.length === 3) m = m.split("").map((c) => c + c).join("");
  const n = parseInt(m, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Apply a theme to <html>: toggle dark, and set the active mode's two colors.
export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", t.mode === "dark");
  const c = t[t.mode];
  root.style.setProperty("--bg", hexToRgb(c.bg));
  root.style.setProperty("--amber", hexToRgb(c.accent));
}

export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const ref = useRef<HTMLDivElement>(null);

  // Read stored prefs for the UI (the no-flash script already applied them).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(THEME_KEY) || "null");
      if (s) {
        setTheme({
          mode: s.mode === "dark" ? "dark" : "light",
          light: { ...DEFAULT_THEME.light, ...s.light },
          dark: { ...DEFAULT_THEME.dark, ...s.dark },
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Close the color popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function commit(next: Theme) {
    setTheme(next);
    localStorage.setItem(THEME_KEY, JSON.stringify(next));
    applyTheme(next);
  }

  const isDark = theme.mode === "dark";
  const toggleMode = () => commit({ ...theme, mode: isDark ? "light" : "dark" });
  const setColor = (mode: Mode, key: keyof Pair, value: string) =>
    commit({ ...theme, [mode]: { ...theme[mode], [key]: value } });

  return (
    <div className="flex items-center gap-1.5">
      {/* one-click light/dark toggle */}
      <button
        onClick={toggleMode}
        className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30"
      >
        <span aria-hidden>{isDark ? "☀" : "☾"}</span>
        {isDark ? "Light mode" : "Dark mode"}
      </button>

      {/* color customizer */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Customize colors"
          className="flex h-[26px] w-[26px] items-center justify-center rounded border border-line hover:border-ink/30"
        >
          <span
            className="h-3.5 w-3.5 rounded-full border border-ink/10"
            style={{ background: theme[theme.mode].accent }}
          />
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-56 z-50 bg-panel border border-line rounded-lg shadow-card p-4 space-y-4 text-ink">
            {(["light", "dark"] as const).map((m) => (
              <div key={m} className="space-y-2">
                <div className="text-ink3 text-[10px] uppercase tracking-widest">{m} colors</div>
                <ColorRow
                  label="Background"
                  value={theme[m].bg}
                  onChange={(v) => setColor(m, "bg", v)}
                />
                <ColorRow
                  label="Accent"
                  value={theme[m].accent}
                  onChange={(v) => setColor(m, "accent", v)}
                />
              </div>
            ))}

            <button
              onClick={() => commit(DEFAULT_THEME)}
              className="text-ink3 underline text-xs hover:text-ink"
            >
              Reset to defaults
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink2">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-9 cursor-pointer rounded border border-line bg-transparent p-0"
      />
    </label>
  );
}
