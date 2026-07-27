// A scanned PDF has no text layer, so this loader returns (almost) nothing.
// Without a gate that produces a CONFIDENT EMPTY extraction — the exact
// "silently dropped commitments" failure the pipeline exists to prevent.
// The existing guard in pipeline.bedrock only catches exactly-empty text, so a
// scan carrying a stray glyph or a page-number artifact slips past it.
//
// Per the design decision (spec, Gate 2): fail in-region rather than falling
// back to BDA in us-east-1. A silent cross-border fallback is precisely what
// the residency architecture exists to prevent.
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

check("empty text is rejected", throwsScanned(() => assertHasTextLayer("", 5, "scan.pdf")));
check("whitespace-only text is rejected", throwsScanned(() => assertHasTextLayer("   \n\n  ", 3, "scan.pdf")));
check("a stray glyph on a 10-page doc is rejected", throwsScanned(() => assertHasTextLayer("[p.1]\n7", 10, "scan.pdf")));

// 17 pages x ~1,300 chars is the real Bank of Canada RAP shape.
const realDoc = Array.from({ length: 17 }, (_, i) => `[p.${i + 1}]\n${"word ".repeat(260)}`).join("\n\n");
check("a real 17-page RAP passes", !throwsScanned(() => assertHasTextLayer(realDoc, 17, "boc.pdf")));

// A short but genuine one-page document must not be mistaken for a scan.
check("a genuine short 1-page doc passes", !throwsScanned(() => assertHasTextLayer(`[p.1]\n${"word ".repeat(60)}`, 1, "short.pdf")));

// Just under the floor.
check("under the absolute floor is rejected", throwsScanned(() => assertHasTextLayer("[p.1]\nshort", 1, "tiny.pdf")));

let msg = "";
try { assertHasTextLayer("", 4, "mystery.pdf"); } catch (e) { msg = (e as Error).message; }
check("message names the file and says scanned", msg.includes("mystery.pdf") && /scan/i.test(msg), msg);
check("message tells the user what to do", /text-based PDF/i.test(msg), msg);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
