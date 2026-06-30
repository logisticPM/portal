import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Palette is driven by CSS variables (see globals.css) so it can be
        // re-themed at runtime (light/dark + a user-chosen bg + accent).
        // Vars hold "R G B" channels so Tailwind's /opacity modifiers still work.
        bg: "rgb(var(--bg) / <alpha-value>)", // page surface (user-editable)
        panel: "rgb(var(--panel) / <alpha-value>)", // lifted card surface
        ink: "rgb(var(--ink) / <alpha-value>)", // primary text
        ink2: "rgb(var(--ink2) / <alpha-value>)", // secondary
        ink3: "rgb(var(--ink3) / <alpha-value>)", // muted
        line: "rgb(var(--line) / <alpha-value>)", // hairline
        amber: "rgb(var(--amber) / <alpha-value>)", // accent (user-editable)
        cedar: "rgb(var(--cedar) / <alpha-value>)",
        rust: "rgb(var(--rust) / <alpha-value>)",
      },
      fontFamily: {
        serif: ["var(--font-display)", "Fraunces", "Georgia", "serif"],
        sans: ["var(--font-body)", "Hanken Grotesk", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(43,38,32,0.04), 0 10px 30px -16px rgba(43,38,32,0.18)",
      },
    },
  },
  plugins: [],
};

export default config;
