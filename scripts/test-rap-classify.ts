// Run: npx tsx scripts/test-rap-classify.ts
import { deriveClassification, derivePillars } from "../src/lib/rap/classify";
import type { ExtractedCommitment, ExtractedRap, Grounded, Pillar } from "../src/lib/rap/types";

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

// --- derivePillars -------------------------------------------------------
// The document-level pillar set is DERIVED from the commitments, not extracted.
// It is a summary ("which canonical themes does this RAP touch?"), and a summary
// has no verbatim span to quote — asking the model for one forced it to weld
// several bullets together with an ellipsis, and to attach ONE page and ONE
// confidence to six independent claims (measured live: six pillars, page=5,
// though "education"/"community" come from p15). Each commitment already carries
// a grounded pillarRaw + a normalized pillarNormalized, and publish.ts builds the
// published row from c.pillarNormalized — so the commitments are the single
// source of truth and this is a projection of them.
const commit = (p: Pillar | null) => ({ pillarNormalized: p }) as unknown as ExtractedCommitment;

check("derives the union of the commitments' pillars", (() => {
  const out = derivePillars([commit("economy"), commit("employment")]);
  return out.length === 2 && out.includes("economy") && out.includes("employment");
})());
check("de-duplicates repeated pillars", derivePillars([commit("economy"), commit("economy")]).join() === "economy");
check("skips commitments with no normalized pillar", derivePillars([commit("economy"), commit(null)]).join() === "economy");
check("no commitments ⇒ empty, not null", derivePillars([]).length === 0);
check("all-null pillars ⇒ empty", derivePillars([commit(null), commit(null)]).length === 0);

// Canonical order, NOT commitment order: the same RAP must derive the same array
// whichever order the chunks came back in, or two runs aren't comparable.
check(
  "emits canonical order regardless of commitment order",
  derivePillars([commit("education"), commit("relationships"), commit("economy")]).join() ===
    derivePillars([commit("economy"), commit("education"), commit("relationships")]).join(),
);
check(
  "  ...and that order is the canonical PILLARS order",
  derivePillars([commit("education"), commit("relationships")]).join() === "relationships,education",
);

process.exit(fail ? 1 : 0);
