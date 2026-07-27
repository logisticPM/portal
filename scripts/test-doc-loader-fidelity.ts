// Some PDFs embed fonts whose glyphs have no Unicode mapping. pdf-parse then
// emits a NUL where the character belongs — measured on the TMX RAP, where
// every "fi" ligature became a NUL byte ("its \u0000rst Reconciliation Action
// Plan"). Claude SILENTLY REPAIRS this, returning "first", so the quote reads
// verbatim but does not match the source bytes.
//
// The existing validator already catches that: the repaired quote fails
// quote_not_found, and isClean() fails on any issue. What this gate adds is
// LEGIBILITY — damage rendered visibly as U+FFFD, plus one document-level
// issue so a reviewer knows the source text is damaged rather than the model
// hallucinating.
// Run: npx tsx scripts/test-doc-loader-fidelity.ts
import { scanFidelity } from "../src/lib/rap/doc-loader/textlayer";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

const NUL = String.fromCharCode(0);

const clean = scanFidelity("[p.1]\nits first Reconciliation Action Plan");
check("clean text is not flagged", clean.fidelityDamaged === false);
check("clean text is unchanged", clean.text === "[p.1]\nits first Reconciliation Action Plan");
check("clean text records no offsets", clean.damagedOffsets.length === 0);

const damaged = scanFidelity(`[p.1]\nits ${NUL}rst Reconciliation Action Plan`);
check("NUL byte flags damage", damaged.fidelityDamaged === true);
check("NUL is replaced with U+FFFD so it is visible", damaged.text.includes("�") && !damaged.text.includes(NUL));
check("offset recorded", damaged.damagedOffsets.length === 1 && damaged.damagedOffsets[0] === 10, JSON.stringify(damaged.damagedOffsets));

const multi = scanFidelity(`a${NUL}b${NUL}c`);
check("multiple NULs all recorded", multi.damagedOffsets.length === 2, JSON.stringify(multi.damagedOffsets));

const existing = scanFidelity("already � damaged");
check("pre-existing U+FFFD counts as damage", existing.fidelityDamaged === true);

// Newlines and tabs are structure, not damage — the [p.N] format depends on them.
const structural = scanFidelity("[p.1]\nline\ttab\r\nend");
check("newlines and tabs are not damage", structural.fidelityDamaged === false, JSON.stringify(structural.damagedOffsets));

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
