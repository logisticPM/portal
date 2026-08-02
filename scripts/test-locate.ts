// Unit tests for the BDA quote-locate step. Run: npx tsx scripts/test-locate.ts
import { searchTermsFor } from "../src/lib/rap/locate";
import { normalizeForQuoteMatch } from "../src/lib/rap/validate";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const norm = (xs: string[]) => xs.map(normalizeForQuoteMatch);

// --- searchTermsFor ---
check("non-date value → [value]", JSON.stringify(searchTermsFor("TMX Group")) === JSON.stringify(["TMX Group"]));

check(
  "free-text timeline is not treated as a date",
  JSON.stringify(searchTermsFor("over a horizon of up to 10 years")) === JSON.stringify(["over a horizon of up to 10 years"]),
);

const ymd = norm(searchTermsFor("2025-09-25"));
check("YYYY-MM-DD includes ISO", ymd.includes(normalizeForQuoteMatch("2025-09-25")));
check("YYYY-MM-DD includes 'September 25, 2025'", ymd.includes(normalizeForQuoteMatch("September 25, 2025")));
check("YYYY-MM-DD includes '25 September 2025'", ymd.includes(normalizeForQuoteMatch("25 September 2025")));
check("YYYY-MM-DD includes 'Sep 25, 2025'", ymd.includes(normalizeForQuoteMatch("Sep 25, 2025")));
check("YYYY-MM-DD includes 'Sept 25, 2025'", ymd.includes(normalizeForQuoteMatch("Sept 25, 2025")));

const ym = norm(searchTermsFor("2025-09"));
check("YYYY-MM includes 'September 2025'", ym.includes(normalizeForQuoteMatch("September 2025")));
check("YYYY-MM includes 'Sep 2025'", ym.includes(normalizeForQuoteMatch("Sep 2025")));

check("bare YYYY → [] (too weak to cite)", searchTermsFor("2025").length === 0);

const single = norm(searchTermsFor("2025-09-05"));
check("single-digit day is un-padded → 'September 5, 2025'", single.includes(normalizeForQuoteMatch("September 5, 2025")));

const deduped = searchTermsFor("2025-05-01"); // May: full name === 3-letter abbrev
check("terms are de-duplicated by normalized form", new Set(norm(deduped)).size === deduped.length);

import { locateQuotes } from "../src/lib/rap/locate";
import { quoteOccursIn } from "../src/lib/rap/validate";
import { buildTextFromPages } from "../src/lib/rap/doc-loader/textlayer";
import type { ExtractedRap, Grounded } from "../src/lib/rap/types";

// Grounded<string> builder; page defaults to null (as BDA leaves most fields).
const g = (value: string | null, page: number | null = null): Grounded<string> => ({
  value,
  quote: null,
  page,
  confidence: 0.6,
  flagged: false,
});

// Minimal ExtractedRap. Only the fields under test carry real values; the rest
// are structurally valid placeholders. `as unknown as ExtractedRap` mirrors the
// pattern in scripts/test-rap-dataclass.ts.
function rap(over: Partial<ExtractedRap>): ExtractedRap {
  return {
    orgName: g(null), sector: g("other") as any, jurisdiction: g("CA") as any,
    rapTitle: g(null), publicationDate: g(null),
    periodCovered: { value: null, quote: null, page: null, confidence: 0.6, flagged: false },
    frameworkRefs: { value: null, quote: null, page: null, confidence: 0.6, flagged: false } as any,
    pillars: [], governanceBody: g(null), reviewCycle: g(null),
    rapType: g("reflect") as any, pairLevel: g("committed") as any, endorsementStatus: g(null),
    commitments: [], sectorFields: {}, extras: [],
    ...over,
  } as unknown as ExtractedRap;
}

// pages[i] is page i's paragraph list (0-indexed page, no [p.N] markers).
const pages: string[][] = [
  ["Cover — Reconciliation Action Plan"],                        // p.1
  ["Our organization, TMX Group, is committed to reconciliation."], // p.2
  ["This RAP was published September 25, 2025 following board approval."], // p.3
  ["Support increased capital flows to First Nations, Inuit, and Métis businesses and communities, and to advance economic reconciliation across every region in which we operate over the coming years as measured annually. Progress will be reported to the board and community partners each year."], // p.4 (long, >MAX_QUOTE_CHARS)
];
const source = buildTextFromPages(pages);

// orgName located on p.2
{
  const out = locateQuotes(rap({ orgName: g("TMX Group") }), pages);
  check("orgName located: page", out.orgName.page === 2);
  check("orgName located: quote is the containing paragraph", out.orgName.quote === "Our organization, TMX Group, is committed to reconciliation.");
  check("orgName recovered quote passes quoteOccursIn", out.orgName.quote != null && quoteOccursIn(out.orgName.quote, source));
}

// ISO publicationDate matched via a date variant on p.3
{
  const out = locateQuotes(rap({ publicationDate: g("2025-09-25") }), pages);
  check("ISO date located via variant: page", out.publicationDate.page === 3);
  check("ISO date located: quote passes quoteOccursIn", out.publicationDate.quote != null && quoteOccursIn(out.publicationDate.quote, source));
}

// Value absent → untouched
{
  const out = locateQuotes(rap({ orgName: g("Nonexistent Corp") }), pages);
  check("absent value → quote stays null", out.orgName.quote === null);
  check("absent value → page unchanged", out.orgName.page === null);
}

// Canonical enum skipped even if the words appear
{
  const withSector = rap({ sector: { ...g("finance"), value: "finance" } as any });
  const out = locateQuotes(withSector, pages);
  check("canonical enum field is never located", out.sector.quote === null);
}

// Long paragraph → quote capped with … and still passes quoteOccursIn
{
  const out = locateQuotes(rap({
    commitments: [{
      pillarRaw: g("Opportunities"), pillarNormalized: null,
      action: g("Support increased capital flows to First Nations, Inuit, and Métis businesses and communities, and to advance economic reconciliation across every region in which we operate over the coming years as measured annually. Progress will be reported to the board and community partners each year."),
      deliverable: g(null), timeline: g(null), owner: g(null), metric: g(null),
      commitmentType: g("other") as any,
    }] as any,
  }), pages);
  const q = out.commitments[0].action.quote;
  check("long action located on p.4", out.commitments[0].action.page === 4);
  check("long action quote capped at MAX_QUOTE_CHARS+ellipsis", q != null && q.length <= 241 && q.endsWith("…"));
  check("capped quote still passes quoteOccursIn", q != null && quoteOccursIn(q, source));
}

// Geometry page preferred when the value is on it (value appears on 2 pages)
{
  const multi: string[][] = [
    ["Foreword by TMX Group leadership."],   // p.1
    ["Details about TMX Group operations."],  // p.2
  ];
  const out = locateQuotes(rap({ orgName: g("TMX Group", 2) }), multi); // geometry says p.2
  check("geometry page preferred when term is on it", out.orgName.page === 2);
  const outNoGeom = locateQuotes(rap({ orgName: g("TMX Group") }), multi);
  check("no geometry → first occurrence", outNoGeom.orgName.page === 1);
}

// Already-quoted field is not overwritten
{
  const pre: Grounded<string> = { value: "TMX Group", quote: "pre-existing", page: 9, confidence: 0.6, flagged: false };
  const out = locateQuotes(rap({ orgName: pre }), pages);
  check("already-quoted field untouched", out.orgName.quote === "pre-existing" && out.orgName.page === 9);
}

// bare-year publicationDate is skipped (no citation) even though 2025 appears
{
  const out = locateQuotes(rap({ publicationDate: g("2025") }), pages);
  check("bare-year value → not located", out.publicationDate.quote === null && out.publicationDate.page === null);
}

// Weak, low-entropy values are not located (would match unrelated text) —
// the field stays uncited (quote AND page null).
{
  const out = locateQuotes(rap({ orgName: g("CEO") }), [["The CEO opened the report."]]);
  check("weak alpha value 'CEO' not located", out.orgName.quote === null && out.orgName.page === null);
}
{
  const out = locateQuotes(rap({ orgName: g("5%") }), [["Revenue rose 5% this year."]]);
  check("weak numeric value '5%' not located", out.orgName.quote === null && out.orgName.page === null);
}

process.exit(fail ? 1 : 0);
