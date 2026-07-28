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

// ===========================================================================
// PAGE MARKERS MUST NOT BREAK A REAL QUOTE.
//
// The loaders prefix every paragraph with "[p.N]". A quote that legitimately
// spans a paragraph or page boundary therefore has a marker sitting inside it
// in the document and nowhere in the model's quote — and normalisation turns
// "[p.6]" into the tokens "p 6", so the substring check used to fail on quotes
// the model had reproduced perfectly.
//
// Measured on the live Hydro-Québec extraction (job 754decee, ca stage,
// 2026-07-28): 3 of its 5 quote_not_found flags were this bug, not the model.
// The quotes below are the REAL ones from that run.
// ===========================================================================
const SPANNING_SOURCE = [
  "[p.3]\nWe are also committed to ensuring continuous, two-way communication between Hydro-Québec and Indigenous communities. This open communication will help establish a common understanding of our challenges",
  "[p.4]\nand on that basis, drive sustainable solutions through open communication.",
].join("\n\n");

// Exactly the quote that flagged as commitments[1].deliverable on the live run.
const SPANNING_QUOTE =
  "This open communication will help establish a common understanding of our challenges and on that basis, drive sustainable solutions through open communication.";

check(
  "a real quote spanning a page marker is NOT flagged",
  issuesFor(rap(g("x", SPANNING_QUOTE)), SPANNING_SOURCE).length === 0,
);

// The same span with a marker inside it must still be found when the model
// quotes only ONE side of the boundary — the ordinary case, previously fine.
check(
  "a quote wholly inside one paragraph still passes",
  issuesFor(rap(g("x", "This open communication will help establish a common understanding")), SPANNING_SOURCE).length === 0,
);

// THE REGRESSION THAT MATTERS: stripping markers must not let a fabrication in.
// This welds the tail of p.3 onto an invented clause; it crosses the same
// boundary as the passing case above, so only the WORDS distinguish them.
check(
  "stripping markers does NOT admit a fabrication across the same boundary",
  issuesFor(
    rap(g("x", "This open communication will help establish a common understanding of our shareholders and on that basis, increase quarterly dividends.")),
    SPANNING_SOURCE,
  ).length === 1,
);

// A marker must not be quotable as if it were prose.
check(
  "the marker text itself is not matchable",
  issuesFor(rap(g("x", "p.4 and on that basis")), SPANNING_SOURCE).length === 1,
);

// --- the two live flags that were CORRECT must stay correct ----------------
// Both are from the same Hydro-Québec run. If a future loosening of this rule
// silences these, it has gone too far.
const DRIFT_SOURCE =
  "[p.4]\nHydro-Québec launched its Action Plan 2035 – Towards a Decarbonized and Prosperous Québec in November 2023. The plan centres around five priorities, one of which is to seek closer collaboration with Indigenous communities.";

check(
  "a quote that drifts mid-span is still caught (live `sector` flag)",
  issuesFor(
    rap(g("energy", "Hydro-Québec launched its Action Plan 2035 – Towards a Decarbonized and Prosperous Québec in November 2023. The plan sets a target of net-zero emissions across all operations.")),
    DRIFT_SOURCE,
  ).length === 1,
);

check(
  "an elided quote whose SECOND fragment is absent is still caught (live `frameworkRefs` flag)",
  issuesFor(
    rap(g("undrip", "Hydro-Québec launched its Action Plan 2035 … we have work to build on our activities in recent decades as a centre of expertise.")),
    DRIFT_SOURCE,
  ).length === 1,
);

check(
  "an elided quote whose fragments are BOTH present still passes",
  issuesFor(
    rap(g("undrip", "Hydro-Québec launched its Action Plan 2035 … seek closer collaboration with Indigenous communities")),
    DRIFT_SOURCE,
  ).length === 0,
);

process.exit(fail ? 1 : 0);
