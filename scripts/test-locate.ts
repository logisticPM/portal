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

process.exit(fail ? 1 : 0);
