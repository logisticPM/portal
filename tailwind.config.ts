import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm editorial "ledger" palette — light, paper-toned, earthy accents.
        bg: "#EFE7D5", // parchment desk
        panel: "#FBF7EF", // bright paper card (lighter than bg → cards lift)
        ink: "#2B2620", // warm near-black text
        ink2: "#6B6254", // secondary
        ink3: "#998E7B", // muted
        line: "#E0D5C0", // warm hairline
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
