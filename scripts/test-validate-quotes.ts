// F3: requireQuote only ever checked `quote === null`. It never verified that the
// quote actually appears in the document, so a FABRICATED quote passed the gate
// that exists to catch fabrication.
//
// This is not hypothetical. The chunk-boundary spike (docs/rap-extraction-findings.md
// §4a) measured an arm where the model welded fragments from two interleaved
// columns into a verbatim-looking span that appears nowhere in the document —
// 21 of 32 quotes were fabricated that way, and ALL 21 passed validation.
//
// Run: npx tsx scripts/test-validate-quotes.ts
import { validateAndFlag } from "../src/lib/rap/validate";
import type { ExtractedRap, Grounded } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const g = <T>(value: T, quote: string | null): Grounded<T> =>
  ({ value, quote, page: 1, confidence: 0.99, flagged: false }) as Grounded<T>;

const rap = (orgName: Grounded<any>): ExtractedRap =>
  ({
    orgName,
    sector: g(null, null),
    jurisdiction: g(null, null),
    rapTitle: g(null, null),
    publicationDate: g(null, null),
    periodCovered: g(null, null),
    frameworkRefs: g(null, null),
    pillars: g(null, null),
    governanceBody: g(null, null),
    reviewCycle: g(null, null),
    rapType: g(null, null),
    pairLevel: g(null, null),
    endorsementStatus: g(null, null),
    commitments: [],
    sectorFields: {},
    extras: [],
  }) as unknown as ExtractedRap;

// The real p5 text, as buildTextFromLayoutBlocks emits it (page markers, one
// paragraph per list item).
const SOURCE = [
  "[p.5]\nReshape our relationship with Indigenous Peoples",
  "[p.5]\nFoster an inclusive and equitable organizational culture that values Indigenous histories, teachings and identities",
  "[p.5]\nChampion the return of thriving Indigenous economies and communities",
].join("\n\n");

const issuesFor = (r: ExtractedRap, sourceText?: string) =>
  validateAndFlag(r, { requireQuote: true, sourceText }).issues.filter((i) => i.rule === "quote_not_found");

// A real quote passes.
const real = rap(g("Bank of Canada", "Champion the return of thriving Indigenous economies and communities"));
check("a verbatim quote present in the source passes", issuesFor(real, SOURCE).length === 0);
check("  ...and is not flagged", !validateAndFlag(real, { requireQuote: true, sourceText: SOURCE }).extracted.orgName.flagged);

// THE case this exists for — a real fabrication observed live in the spike:
// two unrelated p5 bullets welded into one plausible-looking span.
const WELDED = "Reshape our relationship with Indigenous Peoples that values Indigenous histories, teachings and identities";
const fabricated = rap(g("Bank of Canada", WELDED));
check("a FABRICATED quote (two bullets welded together) is caught", issuesFor(fabricated, SOURCE).length === 1);
check(
  "  ...and the field is flagged",
  validateAndFlag(fabricated, { requireQuote: true, sourceText: SOURCE }).extracted.orgName.flagged,
);

// Tolerances. The chunker trims and rejoins paragraphs, and OCR punctuation
// drifts (curly vs straight apostrophes), so the check must compare on words —
// a fabrication differs in WORDS, not whitespace.
const wsDrift = rap(g("x", "Champion   the return\nof thriving Indigenous economies\n  and communities"));
check("whitespace drift (the chunker trims/rejoins) does not false-positive", issuesFor(wsDrift, SOURCE).length === 0);

const punctDrift = rap(g("x", "Champion the return of thriving Indigenous economies, and communities."));
check("punctuation/case drift does not false-positive", issuesFor(punctDrift, SOURCE).length === 0);

// Back-compat: the check is opt-in via sourceText.
check("no sourceText ⇒ check skipped (existing callers unaffected)", issuesFor(fabricated).length === 0);
check(
  "requireQuote=false ⇒ check skipped (the BDA path grounds by confidence, not quotes)",
  validateAndFlag(fabricated, { requireQuote: false, sourceText: SOURCE }).issues.filter(
    (i) => i.rule === "quote_not_found",
  ).length === 0,
);

// A null quote is still the existing no_quote rule's job, not this one.
const noQuote = rap(g("Bank of Canada", null));
check("a null quote is still no_quote, not quote_not_found", issuesFor(noQuote, SOURCE).length === 0);
check(
  "  ...and still raises no_quote",
  validateAndFlag(noQuote, { requireQuote: true, sourceText: SOURCE }).issues.some((i) => i.rule === "no_quote"),
);

// Honest elision vs silent weld — the distinction the gate has to make.
// A multi-valued field (pillars, frameworkRefs) has no single verbatim span, so
// the model marks the join with "…". That is provenance, not fabrication.
// Observed live: `pillars` quoted "Reshape our relationship… Foster an inclusive…".
const elided = rap(g(["a", "b"], "Reshape our relationship with Indigenous Peoples … Champion the return of thriving Indigenous economies and communities"));
check("an ELIDED quote whose fragments all occur passes (honest multi-span provenance)", issuesFor(elided, SOURCE).length === 0);
check("  ...'...' works as well as '…'", issuesFor(rap(g(["a"], "Reshape our relationship with Indigenous Peoples ... Champion the return of thriving")), SOURCE).length === 0);
check(
  "an elided quote with a FABRICATED fragment is still caught",
  issuesFor(rap(g(["a"], "Reshape our relationship with Indigenous Peoples … we pledge to end all inequity by Tuesday")), SOURCE).length === 1,
);
check(
  "a SILENT weld (no ellipsis) is still caught — it implies contiguity that doesn't exist",
  issuesFor(fabricated, SOURCE).length === 1,
);

// A null value with a null quote asserts nothing.
const empty = rap(g(null, null));
check("a null value with no quote raises nothing", validateAndFlag(empty, { requireQuote: true, sourceText: SOURCE }).issues.length === 0);

// Commitment quotes are checked too, not just header fields.
const withCommit = {
  ...rap(g(null, null)),
  commitments: [
    {
      pillarRaw: g("x", "Reshape our relationship with Indigenous Peoples"),
      pillarNormalized: null,
      action: g("y", WELDED), // fabricated
      deliverable: g(null, null),
      timeline: g(null, null),
      owner: g(null, null),
      metric: g(null, null),
      commitmentType: g(null, null),
    },
  ],
} as unknown as ExtractedRap;
const commitIssues = issuesFor(withCommit, SOURCE);
check("a fabricated quote inside a commitment is caught", commitIssues.length === 1);
check("  ...and reports its path", commitIssues[0]?.path === "commitments[0].action");

process.exit(fail ? 1 : 0);
