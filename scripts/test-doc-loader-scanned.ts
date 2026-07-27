// A scanned PDF has no text layer, so this loader returns (almost) nothing.
// Without a gate that produces a CONFIDENT EMPTY extraction — the exact
// "silently dropped commitments" failure the pipeline exists to prevent.
// The existing guard in pipeline.bedrock only catches exactly-empty text, so a
// scan carrying a stray glyph or a page-number artifact slips past it.
//
// Per the design decision (spec, Gate 2): fail in-region rather than falling
// back to BDA in us-east-1. A silent cross-border fallback is precisely what
// the residency architecture exists to prevent.
//
// assertHasTextLayer applies three checks: an absolute total-chars floor, a
// document-wide average-chars-per-page floor, and a per-page COVERAGE floor
// (the share of pages that individually carry meaningful text). The coverage
// check exists because the average alone is satisfied by a single
// content-rich page (a cover, a title page) even when every other page is a
// blank scanned image — see "a 20-page doc with one rich page..." below for
// the case that slips through without it.
// Run: npx tsx scripts/test-doc-loader-scanned.ts
import { assertHasTextLayer } from "../src/lib/rap/doc-loader/textlayer";
import { ScannedDocumentError } from "../src/lib/rap/doc-loader/types";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}
function throwsScanned(fn: () => void): boolean {
  try { fn(); return false; } catch (e) { return e instanceof ScannedDocumentError; }
}

check("empty text is rejected", throwsScanned(() => assertHasTextLayer("", Array(5).fill([]), "scan.pdf")));
check("whitespace-only text is rejected", throwsScanned(() => assertHasTextLayer("   \n\n  ", Array(3).fill([]), "scan.pdf")));
check(
  "a stray glyph on a 10-page doc is rejected",
  throwsScanned(() => assertHasTextLayer("[p.1]\n7", [["7"], [], [], [], [], [], [], [], [], []], "scan.pdf")),
);

// 17 pages x ~1,300 chars is the real Bank of Canada RAP shape.
const realPages: string[][] = Array.from({ length: 17 }, () => ["word ".repeat(260)]);
const realDoc = realPages.map((paras, i) => `[p.${i + 1}]\n${paras[0]}`).join("\n\n");
check("a real 17-page RAP passes", !throwsScanned(() => assertHasTextLayer(realDoc, realPages, "boc.pdf")));

// A short but genuine one-page document must not be mistaken for a scan.
check(
  "a genuine short 1-page doc passes",
  !throwsScanned(() => assertHasTextLayer(`[p.1]\n${"word ".repeat(60)}`, [["word ".repeat(60)]], "short.pdf")),
);

// Just under the floor.
check("under the absolute floor is rejected", throwsScanned(() => assertHasTextLayer("[p.1]\nshort", [["short"]], "tiny.pdf")));

let msg = "";
try { assertHasTextLayer("", Array(4).fill([]), "mystery.pdf"); } catch (e) { msg = (e as Error).message; }
check("message names the file and says scanned", msg.includes("mystery.pdf") && /scan/i.test(msg), msg);
check("message tells the user what to do", /text-based PDF/i.test(msg), msg);

// --- Per-page coverage: a document-wide average is not enough ---------

// Reviewer-verified failure mode: a 20-page document where page 1 carries
// ~1,000 real characters (a plausible cover page) and pages 2-20 are pure
// scanned images. total=1000 (>=200), perPage average=1000/20=50 (not <50)
// — both of the older floors pass this outright. Only per-page coverage
// (1 of 20 pages carries real text) catches it.
const sparsePages: string[][] = [["x".repeat(1000)], ...Array.from({ length: 19 }, () => [] as string[])];
const sparseText = `[p.1]\n${"x".repeat(1000)}`; // pages 2-20 are truly empty and emit nothing, same as buildTextFromPages would.
check(
  "a 20-page doc with one rich page and 19 blank pages is rejected",
  throwsScanned(() => assertHasTextLayer(sparseText, sparsePages, "mostly-scanned.pdf")),
);

// The flip side: a genuine document with one sparse or image-only page
// (a divider, a full-page figure) among many real ones must still pass —
// coverage is a proportion, not a strict per-page minimum.
const mostlyRealPages: string[][] = Array.from({ length: 17 }, (_, i) => (i === 8 ? [] : ["word ".repeat(260)]));
const mostlyRealText = mostlyRealPages
  .map((paras, i) => (paras.length === 0 ? "" : `[p.${i + 1}]\n${paras[0]}`))
  .filter((s) => s !== "")
  .join("\n\n");
check(
  "a document with one sparse/blank page among many real ones passes",
  !throwsScanned(() => assertHasTextLayer(mostlyRealText, mostlyRealPages, "mostly-real.pdf")),
);

// Degenerate: zero pages must resolve via the ordinary total-chars floor,
// not divide-by-zero or crash on the coverage math.
check("a zero-page document is rejected without crashing", throwsScanned(() => assertHasTextLayer("", [], "empty.pdf")));

// --- Marker stripping must be load-bearing, not just present -----------

// This input is built so that ONLY the marker-stripping line stands between
// it and a false pass: 60 marker-only lines (no real body) total well past
// MIN_TOTAL_CHARS and MIN_CHARS_PER_PAGE if left unstripped, and the paired
// `pages` array independently clears the coverage floor. So if the
// `.replace(/^\[p\.[^\]]*\]$/gm, "")` line were deleted, every one of the
// three checks would pass and this would NOT throw — proving the stripping
// (not the coverage check) is what catches it.
const markerOnlyText = Array.from({ length: 60 }, (_, i) => `[p.${(i % 5) + 1}]`).join("\n");
const coveredPages: string[][] = Array.from({ length: 5 }, () => ["word ".repeat(60)]);
check(
  "marker-only text is rejected even though the per-page arrays show real coverage",
  throwsScanned(() => assertHasTextLayer(markerOnlyText, coveredPages, "marker-only.pdf")),
);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
