import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Clean, cool-neutral palette — light grey desk, white cards, earthy accents.
        bg: "#ECF0F3", // soft cool-grey desk (was warm parchment; client refresh)
        panel: "#FFFFFF", // white card (lifts clearly on the grey desk)
        ink: "#232A2E", // near-black text (slightly cooled to match)
        ink2: "#59606A", // secondary
        ink3: "#6E7681", // muted — darkened for readability on the lighter bg
        line: "#D8DEE6", // cool hairline
        amber: "#A06A12", // deepened for contrast on light
        cedar: "#4C6A40",
        rust: "#A6452B",
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
