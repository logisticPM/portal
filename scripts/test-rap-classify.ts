// Run: npx tsx scripts/test-rap-classify.ts
import { deriveClassification } from "../src/lib/rap/classify";
import type { ExtractedRap, Grounded } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const g = <T>(value: T, confidence: number): Grounded<T> =>
  ({ value, quote: value === null ? null : "q", page: 1, confidence }) as Grounded<T>;

// Only the three fields deriveClassification reads; the rest of ExtractedRap is
// irrelevant to it.
const rap = (j: any, s: any, r: any) => ({ jurisdiction: j, sector: s, rapType: r }) as unknown as ExtractedRap;

// A Canadian RAP has NO rapType: that field is the Australian
// reflect/innovate/stretch/elevate tier (types.ts:77 — "null when not an AU-style
// RAP"). Measured live on the real Bank of Canada RAP: rapType came back null with
// confidence 0, which dragged Math.min to 0 and made EVERY Canadian RAP score a
// classification confidence of 0.
const ca = deriveClassification(rap(g("CA", 0.99), g("finance", 0.9), g(null, 0)));
check("a Canadian RAP's null rapType does NOT zero the confidence", ca.confidence === 0.9);
check("  ...and rapType stays null", ca.rapType === null);
check("  ...and the other classification fields pass through", ca.jurisdiction === "CA" && ca.sector === "finance");

// An Australian RAP DOES have one, so it counts.
const au = deriveClassification(rap(g("AU", 0.99), g("finance", 0.9), g("stretch", 0.6)));
check("an Australian RAP's rapType still drags the confidence when present", au.confidence === 0.6);
check("  ...and rapType passes through", au.rapType === "stretch");

// The asymmetry that makes this correct: jurisdiction and sector FALL BACK to
// "other" — a fallback asserts something, so its low confidence must drag. rapType
// has no fallback; it stays null and therefore asserts nothing.
const noJur = deriveClassification(rap(g(null, 0), g("finance", 0.9), g(null, 0)));
check("a null jurisdiction DOES drag (it asserts 'other')", noJur.confidence === 0);
check("  ...and is reported as 'other'", noJur.jurisdiction === "other");

const noSector = deriveClassification(rap(g("CA", 0.99), g(null, 0), g(null, 0)));
check("a null sector DOES drag (it asserts 'other')", noSector.confidence === 0);
check("  ...and is reported as 'other'", noSector.sector === "other");

// The least-confident applicable signal still wins.
check(
  "confidence is the min of the APPLICABLE signals",
  deriveClassification(rap(g("CA", 0.4), g("finance", 0.9), g(null, 0))).confidence === 0.4,
);

process.exit(fail ? 1 : 0);
