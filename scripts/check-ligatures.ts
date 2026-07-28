/**
 * Look for silent ligature loss in the text layer.
 *
 * The fidelity scanner catches control characters and U+FFFD. A dropped ligature
 * is neither: "Officer" simply arrives as "Ofcer", with no marker of any kind.
 * That is character loss the damage regex cannot see, so it needs its own check.
 *
 * Usage: npx tsx scripts/check-ligatures.ts <pdf> [...]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { extractPagesFromPdf, buildTextFromPages, scanFidelity } from "../src/lib/rap/doc-loader/textlayer";

// Words that only occur when an f-ligature (fi/fl/ff/ffi/ffl) has been dropped.
// Each is a real English word with the ligature removed, so a hit is evidence of
// loss rather than of unusual vocabulary.
// NOTE: every entry must be a NON-word once the ligature is gone. "identify" was
// in this list initially and fired on all seven documents — it is of course a
// real word, and the scar for "identified" is "identied".
const LIGATURE_SCARS = [
  "Ofcer", "ofcer", "ofce", "Ofce", "signicant", "benet", "benets", "conrm", "conrmed",
  "specic", "denition", "dene", "dened", "rst", "nancial", "nance", "condence",
  "identied", "qualied", "certied", "reected", "ow", "ows", "eld", "elds",
  "staff", "effort", "difference", "affordable",
];
// The three above with real spellings are controls: "staff"/"effort" contain "ff"
// and SHOULD be present intact. Their absence alongside scar words is corroboration.
const CONTROLS = new Set(["staff", "effort", "difference", "affordable"]);

async function main() {
  for (const file of process.argv.slice(2)) {
    const bytes = new Uint8Array(readFileSync(file));
    const pages = await extractPagesFromPdf(bytes);
    const raw = buildTextFromPages(pages);
    const fid = scanFidelity(raw);
    const text = fid.text;

    const scars: string[] = [];
    const controls: string[] = [];
    for (const w of LIGATURE_SCARS) {
      // Word-boundary match so "rst" does not fire inside "first".
      const n = (text.match(new RegExp(`\\b${w}\\b`, "g")) ?? []).length;
      if (n > 0) (CONTROLS.has(w) ? controls : scars).push(`${w}×${n}`);
    }

    // Direct evidence: does any real f-ligature codepoint survive in the output?
    const ligChars = (text.match(/[ﬀ-ﬆ]/g) ?? []).length;

    console.log(`\n=== ${basename(file)} ===`);
    console.log(`  damage-regex flags:   ${fid.fidelityDamaged ? `${fid.damagedOffsets.length} glyphs` : "clean"}`);
    console.log(`  U+FB00-06 ligatures:  ${ligChars}`);
    console.log(`  ligature SCARS:       ${scars.length ? scars.join(" ") : "none"}`);
    console.log(`  intact ff/ffi words:  ${controls.length ? controls.join(" ") : "none"}`);
    // Show the scars in context — a bare count is easy to misread, and this is
    // the check that tells us whether the loss is real or a bad word list.
    for (const m of text.matchAll(/\b(?:Ofcer|ofce|nancial|nance|rst|signicant|benet|specic|ows|eld)\b/g)) {
      const at = m.index ?? 0;
      console.log(`      "${text.slice(Math.max(0, at - 34), at + m[0].length + 26).replace(/\s+/g, " ")}"`);
    }
  }
}

main();
