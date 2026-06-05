import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0A0D18",
        panel: "#121622",
        ink: "#F5EDE0",
        ink2: "#B6AEA3",
        ink3: "#847E75",
        amber: "#D4A340",
        cedar: "#7A9B6E",
        rust: "#C16B4F",
      },
      fontFamily: {
        serif: ["Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
