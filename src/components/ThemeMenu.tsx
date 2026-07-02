"use client";

// Appearance switcher: three color modes (light / dark / accessible). "Accessible"
// is a colorblind-safe palette (Okabe-Ito) — the label stays neutral on purpose.
// Each mode toggles a class on <html> (light = none, dark = .dark, cb = .cb); the
// palette itself lives in globals.css. Choice persists in localStorage.
import { useEffect, useRef, useState } from "react";

type Mode = "light" | "dark" | "cb";
export const THEME_KEY = "portal-theme";

// label + a small preview swatch (bg + the three accent hues for that mode).
const MODES: { id: Mode; label: string; bg: string; dots: string[] }[] = [
  { id: "light", label: "Light", bg: "#EFE7D5", dots: ["#A06A12", "#4C6A40", "#A6452B"] },
  { id: "dark", label: "Dark", bg: "#181613", dots: ["#E2A84A", "#8FB276", "#D2785A"] },
  { id: "cb", label: "Accessible", bg: "#EFE7D5", dots: ["#E69F00", "#0072B2", "#D55E00"] },
];

function apply(mode: Mode) {
  const el = document.documentElement;
  el.classList.remove("dark", "cb");
  if (mode === "dark") el.classList.add("dark");
  else if (mode === "cb") el.classList.add("cb");
}

export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("light");
  const ref = useRef<HTMLDivElement>(null);

  // The no-flash script already applied the class; sync UI state on mount.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(THEME_KEY) || "null");
      const m = s?.mode;
      setMode(m === "dark" || m === "cb" ? m : "light");
    } catch {
      /* ignore */
    }
  }, []);

  // Close on outside click / Escape.
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

  function choose(next: Mode) {
    setMode(next);
    localStorage.setItem(THEME_KEY, JSON.stringify({ mode: next }));
    apply(next);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30"
      >
        <span aria-hidden>◐</span> Change mode
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-44 z-50 bg-panel border border-line rounded-lg shadow-card p-1.5 text-ink"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              role="menuitemradio"
              aria-checked={m.id === mode}
              onClick={() => choose(m.id)}
              className={`w-full flex items-center gap-2.5 rounded px-2 py-1.5 text-sm text-left ${
                m.id === mode ? "bg-amber/10 text-amber" : "text-ink2 hover:bg-ink/5 hover:text-ink"
              }`}
            >
              <span
                className="flex h-5 w-8 shrink-0 items-center justify-center gap-0.5 rounded border border-ink/10"
                style={{ background: m.bg }}
              >
                {m.dots.map((c, i) => (
                  <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                ))}
              </span>
              <span className="flex-1">{m.label}</span>
              {m.id === mode && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
