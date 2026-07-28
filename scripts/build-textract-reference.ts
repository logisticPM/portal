/**
 * Distil cached Textract LAYOUT blocks into a committable reference fixture.
 *
 * WHY HASHES, NOT TEXT. The comparison only ever tests two things about a
 * sentence: does it appear, and where. Both work on an opaque key, so the
 * fixture stores the SHA-256 of each normalised sentence plus its page and
 * position — never the prose. That keeps a reference for five third-party
 * publications in a few hundred KB without reproducing their text in the repo,
 * and it makes the harness reproducible with no AWS call, no SSO session, and
 * no Textract spend.
 *
 * Regenerating a fixture needs an SSO session and costs a Textract run; using
 * one costs nothing.
 *
 * Usage: npx tsx scripts/build-textract-reference.ts <blocks.json> <out.json> <label>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildTextFromLayoutBlocks } from "../src/lib/rap/doc-loader";
import { referenceUnits, hashKey } from "./lib/reference-units";

const [blocksFile, out, label] = process.argv.slice(2);
if (!blocksFile || !out || !label) {
  console.error("usage: npx tsx scripts/build-textract-reference.ts <blocks.json> <out.json> <label>");
  process.exit(1);
}

const { blocks, pages, region } = JSON.parse(readFileSync(blocksFile, "utf8"));
const text = buildTextFromLayoutBlocks(blocks);
const units = referenceUnits(text).map((u, i) => ({ h: hashKey(u.key), page: u.page, i }));

writeFileSync(
  out,
  JSON.stringify(
    {
      label,
      engine: "textract-layout",
      region: region ?? "ca-central-1",
      pages,
      note: "h = sha256(normalised sentence). Text is deliberately not stored; see build-textract-reference.ts.",
      textSha256: createHash("sha256").update(text).digest("hex"),
      units,
    },
    null,
    1,
  ),
);
console.log(`${label}: ${units.length} reference sentences over ${pages} pages -> ${out}`);
