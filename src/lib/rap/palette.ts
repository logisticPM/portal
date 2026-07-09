// ===========================================================================
// Color-blind-safe themes for the exploratory dashboard. The client flagged the
// default earthy greens/browns as hard to tell apart (they fail for red-green
// color blindness — deuteranopia/protanopia — the most common form). Each theme
// below is a published color-blind-safe categorical palette:
//   • Okabe–Ito  — the de-facto standard for accessible categorical color
//   • Tol Muted  — Paul Tol's muted set; earthy but still CB-safe (keeps brand feel)
//   • IBM        — IBM Carbon's cool CB-safe set
// Color is never the ONLY signal here (every cell/legend/node is also labelled),
// but the palette itself is now distinguishable. Text-on-fill contrast is chosen
// per fill via textOn() so light swatches (e.g. yellow) stay readable.
// ===========================================================================
export interface Theme {
  key: string;
  label: string;
  note: string;
  categorical: string[]; // distinct hues for nominal dimensions (sector, org, type…)
  status: Record<"committed" | "in_progress" | "reported" | "confirmed" | "stalled", string>; // ordinal progress ramp (CB-safe, no red/green pair)
  accentHex: string; // sequential base (heatmap) + page accent
}

export const THEMES: Theme[] = [
  {
    key: "okabe",
    label: "Okabe–Ito",
    note: "Accessibility standard for categorical color",
    categorical: [
      "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00",
      "#CC79A7", "#661100", "#999999", "#117733", "#882255", "#44AA99",
    ],
    status: { committed: "#999999", in_progress: "#56B4E9", reported: "#E69F00", confirmed: "#009E73", stalled: "#CC79A7" },
    accentHex: "#0072B2",
  },
  {
    key: "tol",
    label: "Tol Muted (earthy)",
    note: "Color-blind-safe but keeps the warm, earthy feel",
    categorical: [
      "#332288", "#88CCEE", "#44AA99", "#117733", "#999933", "#DDCC77",
      "#CC6677", "#882255", "#AA4499", "#661100", "#6699CC", "#888888",
    ],
    status: { committed: "#BBBBBB", in_progress: "#88CCEE", reported: "#DDCC77", confirmed: "#117733", stalled: "#882255" },
    accentHex: "#44AA99",
  },
  {
    key: "ibm",
    label: "IBM (cool)",
    note: "IBM Carbon's cool color-blind-safe set",
    categorical: [
      "#648FFF", "#DC267F", "#FFB000", "#785EF0", "#FE6100", "#009E73",
      "#1192E8", "#9F1853", "#005D5D", "#B28600", "#6929C4", "#8A3800",
    ],
    status: { committed: "#8D8D8D", in_progress: "#648FFF", reported: "#FFB000", confirmed: "#009E73", stalled: "#DC267F" },
    accentHex: "#648FFF",
  },
];

export const DEFAULT_THEME = THEMES[0];

// stable hash so a given key always maps to the same palette slot
export function hashIdx(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

// WCAG relative luminance
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const ch = (i: number) => {
    const x = parseInt(c.slice(i, i + 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

const INK = "#232A2E", PAPER = "#FFFFFF";
const L_INK = luminance(INK), L_PAPER = luminance(PAPER);
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Pick whichever text color (dark ink vs light paper) has the higher contrast
// ratio against the given fill — optimal legibility on any swatch.
export function textOn(hex: string | null | undefined): string {
  if (!hex || hex[0] !== "#" || hex.length < 7) return INK; // guard against non-hex / missing input
  const L = luminance(hex);
  return contrast(L, L_INK) >= contrast(L, L_PAPER) ? INK : PAPER;
}

export function hexToRgba(hex: string, a: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
