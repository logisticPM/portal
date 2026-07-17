// Regression test against REAL Textract LAYOUT output — the bug this guards
// against was invisible to synthetic fixtures for weeks.
//
// Run: npx tsx scripts/test-layout-real-ocr.ts
//
// Fixture: scripts/fixtures/textract-layout-p13-p15.json — the real Bank of
// Canada RAP's pages 13 and 15 (LAYOUT_* blocks + their LINE children, WORD
// blocks and Geometry stripped; buildTextFromLayoutBlocks reads neither).
// Those two pages carry every commitment in the document and are laid out in
// TWO COLUMNS, which is what broke the original pipeline: the old
// StartDocumentTextDetection path returned LINE blocks in page-wide reading
// order, interleaving the columns word-group by word-group —
//
//   Invest in the CBNII to share          ← left column
//   Continue to integrate Indigenous      ← right column, a DIFFERENT commitment
//   work and learn best practices in      ← left again
//
// — so only 3 of 22 commitments existed as contiguous text. See
// docs/rap-extraction-findings.md §4a. Textract LAYOUT resolves the columns;
// this test pins that it stays resolved.
//
// Gold: scripts/fixtures/gold-commitments-bankofcanada.json — the 22
// forward-looking "Some key actions:" commitments, 12 on p13 + 10 on p15,
// verified by hand and independently corroborated by BDA's 22 (§5).
import { readFileSync } from "node:fs";
import type { Block } from "@aws-sdk/client-textract";
import { buildTextFromLayoutBlocks } from "../src/lib/rap/pipeline.bedrock";
import { chunkDocument } from "../src/lib/rap/chunk";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const blocks: Block[] = JSON.parse(readFileSync("scripts/fixtures/textract-layout-p13-p15.json", "utf8"));
const gold: { page: number; action: string }[] = JSON.parse(
  readFileSync("scripts/fixtures/gold-commitments-bankofcanada.json", "utf8"),
);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const text = buildTextFromLayoutBlocks(blocks);
const normText = norm(text);

check("fixture actually contains the two-column commitment pages", blocks.length > 100);
check("builds non-empty text", text.length > 0);

// THE load-bearing property. On the old LINE-join path only 3/22 of these were
// contiguous; if this drops below 22 the columns are interleaving again.
const contiguous = gold.filter((g) => normText.includes(norm(g.action)));
check(
  `all ${gold.length} commitments survive OCR as contiguous text (column order resolved)`,
  contiguous.length === gold.length,
);
if (contiguous.length !== gold.length) {
  for (const g of gold.filter((x) => !normText.includes(norm(x.action)))) {
    console.log(`     MISSING/SPLIT: [p${g.page}] ${g.action.slice(0, 70)}`);
  }
}

// The dedupe: a LAYOUT_LIST's children ARE the top-level LAYOUT_TEXT blocks, so
// emitting both duplicates every commitment (measured: 33% of words double-owned).
const duplicated = gold.filter((g) => {
  const n = norm(g.action);
  let count = 0;
  let i = normText.indexOf(n);
  while (i !== -1) {
    count++;
    i = normText.indexOf(n, i + 1);
  }
  return count > 1;
});
check("no commitment is emitted twice (LAYOUT_LIST / LAYOUT_TEXT dedupe holds)", duplicated.length === 0);
for (const d of duplicated) console.log(`     DUPLICATED: ${d.action.slice(0, 70)}`);

// Page grounding: every commitment must sit under its OWN page's marker. This is
// what arm (b) got wrong (off-by-one: p12 for p13) while looking plausible.
const paragraphs = text.split("\n\n");
let rightPage = 0;
for (const g of gold) {
  const p = paragraphs.find((par) => norm(par).includes(norm(g.action)));
  if (p && new RegExp(`^\\[p\\.${g.page}\\]`).test(p)) rightPage++;
}
check(`every commitment carries its own correct [p.N] marker (${rightPage}/${gold.length})`, rightPage === gold.length);

// Noise stays out.
check("running boilerplate (LAYOUT_FOOTER / LAYOUT_PAGE_NUMBER) is dropped", !/Reconciliation Action Plan 2024-2027/.test(text));

// And the chunker must not cut a commitment apart downstream.
const chunks = chunkDocument(text);
const intact = gold.filter((g) => chunks.filter((c) => norm(c.text).includes(norm(g.action))).length === 1);
check(`all ${gold.length} commitments land whole in exactly one chunk`, intact.length === gold.length);

process.exit(fail ? 1 : 0);
