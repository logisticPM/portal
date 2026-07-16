// Run: npx tsx scripts/test-rap-chunk.ts
import { chunkDocument, splitInHalf } from "../src/lib/rap/chunk";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const para = (n: number) => `Commitment ${n}. Action: do thing ${n}.\nDeliverable: report ${n}.`;
const doc = Array.from({ length: 30 }, (_, i) => para(i + 1)).join("\n\n");

const chunks = chunkDocument(doc, 400);
check("splits a long document into several chunks", chunks.length > 1);
check("chunks are indexed in document order", chunks.every((c, i) => c.index === i));

// THE load-bearing property: no overlap, nothing lost. If this fails, commitments
// are being duplicated or dropped.
check(
  "concatenating chunks reproduces the source exactly (no overlap, no loss)",
  chunks.map((c) => c.text).join("\n\n").replace(/\s+/g, " ").trim() ===
    doc.replace(/\s+/g, " ").trim(),
);
check("every commitment paragraph survives somewhere",
  Array.from({ length: 30 }, (_, i) => i + 1).every((n) =>
    chunks.some((c) => c.text.includes(`Commitment ${n}.`))));
check("respects the target size (allowing one paragraph of overshoot)",
  chunks.every((c) => c.text.length <= 400 * 2));

// A document under target is one chunk — do not fragment small RAPs.
const small = chunkDocument(para(1), 400);
check("a small document stays a single chunk", small.length === 1);
check("an empty document yields no chunks", chunkDocument("", 400).length === 0);

// Recursive split, for a chunk that still truncates.
const big = chunkDocument(doc, 100000)[0];
const halves = splitInHalf(big);
check("splitInHalf returns two halves", halves !== null && halves.length === 2);
check(
  "halves reproduce the chunk (no loss)",
  halves !== null &&
    halves.map((h) => h.text).join("\n\n").replace(/\s+/g, " ").trim() ===
      big.text.replace(/\s+/g, " ").trim(),
);
check("an unsplittable single-line chunk returns null (caller must fail loudly)",
  splitInHalf({ text: "oneline", index: 0 }) === null);

process.exit(fail ? 1 : 0);
