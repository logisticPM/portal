// buildTextFromLayoutBlocks is the most load-bearing function on this branch —
// it turns raw Textract LAYOUT blocks into the "[p.N]"-marked paragraph text
// that chunkDocument, the header call, and every commitments call all depend
// on for correct page grounding. It had zero tests before this file. Fixtures
// are small hand-built synthetic Block[] — NOT the cached real-PDF dump (that
// is untracked and must not be depended on by a committed test).
// Run: npx tsx scripts/test-layout-text.ts
import type { Block } from "@aws-sdk/client-textract";
import { DEFAULT_TARGET_CHARS } from "../src/lib/rap/chunk";
import { buildTextFromLayoutBlocks } from "../src/lib/rap/pipeline.bedrock";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

function line(id: string, page: number, text: string): Block {
  return { Id: id, BlockType: "LINE", Page: page, Text: text };
}

function layout(id: string, blockType: NonNullable<Block["BlockType"]>, page: number, childIds: string[]): Block {
  return {
    Id: id,
    BlockType: blockType,
    Page: page,
    Relationships: [{ Type: "CHILD", Ids: childIds }],
  };
}

// ---------------------------------------------------------------------------
// (a) The load-bearing dedupe: a LAYOUT_LIST's CHILD ids are also top-level
// LAYOUT_TEXT blocks in the same array (real Textract shape). Each list item
// must be emitted EXACTLY ONCE — as the list's own paragraph, not duplicated
// when the same LAYOUT_TEXT block is encountered again at top level.
// ---------------------------------------------------------------------------
{
  const item1Line = line("line1", 1, "Commitment one: build the thing.");
  const item2Line = line("line2", 1, "Commitment two: ship the thing.");
  const item1Text = layout("item1", "LAYOUT_TEXT", 1, ["line1"]);
  const item2Text = layout("item2", "LAYOUT_TEXT", 1, ["line2"]);
  const list = layout("list1", "LAYOUT_LIST", 1, ["item1", "item2"]);

  // Order matters not at all here — top-level entries can appear before or
  // after the LAYOUT_LIST that also references them, as in real Textract output.
  const blocks: Block[] = [item1Text, item2Text, list, item1Line, item2Line];
  const out = buildTextFromLayoutBlocks(blocks);

  const count = (needle: string) => out.split(needle).length - 1;
  check("list item 1 text appears exactly once (no dedupe-miss duplication)", count("Commitment one: build the thing.") === 1);
  check("list item 2 text appears exactly once (no dedupe-miss duplication)", count("Commitment two: ship the thing.") === 1);
  check("list produces one paragraph per item (two blank-line-separated paragraphs)", out.trim().split(/\n\s*\n/).length === 2);
}

// ---------------------------------------------------------------------------
// (b) Noise types are dropped entirely: LAYOUT_HEADER / LAYOUT_FOOTER /
// LAYOUT_PAGE_NUMBER / LAYOUT_FIGURE never contribute text to the output.
// ---------------------------------------------------------------------------
{
  const blocks: Block[] = [
    layout("h1", "LAYOUT_HEADER", 2, ["hl1"]),
    line("hl1", 2, "NOISE_RUNNING_HEADER"),
    layout("f1", "LAYOUT_FOOTER", 2, ["fl1"]),
    line("fl1", 2, "NOISE_RUNNING_FOOTER"),
    layout("pn1", "LAYOUT_PAGE_NUMBER", 2, ["pnl1"]),
    line("pnl1", 2, "NOISE_PAGE_NUM_3"),
    layout("fig1", "LAYOUT_FIGURE", 2, ["figl1"]),
    line("figl1", 2, "NOISE_FIGURE_CAPTION"),
    layout("body1", "LAYOUT_TEXT", 2, ["bl1"]),
    line("bl1", 2, "REAL_BODY_TEXT"),
  ];
  const out = buildTextFromLayoutBlocks(blocks);

  check("LAYOUT_HEADER text is dropped", !out.includes("NOISE_RUNNING_HEADER"));
  check("LAYOUT_FOOTER text is dropped", !out.includes("NOISE_RUNNING_FOOTER"));
  check("LAYOUT_PAGE_NUMBER text is dropped", !out.includes("NOISE_PAGE_NUM_3"));
  check("LAYOUT_FIGURE text is dropped", !out.includes("NOISE_FIGURE_CAPTION"));
  check("real body text (non-noise) survives", out.includes("REAL_BODY_TEXT"));
}

// ---------------------------------------------------------------------------
// (c) Every emitted paragraph carries a "[p.N]" marker matching its block's Page.
// ---------------------------------------------------------------------------
{
  const blocks: Block[] = [
    layout("t1", "LAYOUT_TEXT", 5, ["l1"]),
    line("l1", 5, "Text on page five."),
    layout("t2", "LAYOUT_TEXT", 12, ["l2"]),
    line("l2", 12, "Text on page twelve."),
  ];
  const out = buildTextFromLayoutBlocks(blocks);
  const paragraphs = out.trim().split(/\n\s*\n/);

  check("two paragraphs emitted", paragraphs.length === 2);
  check("first paragraph marked [p.5]", paragraphs[0].startsWith("[p.5]\n") && paragraphs[0].includes("Text on page five."));
  check("second paragraph marked [p.12]", paragraphs[1].startsWith("[p.12]\n") && paragraphs[1].includes("Text on page twelve."));
}

// ---------------------------------------------------------------------------
// (d) A non-LAYOUT_TEXT, non-list type (e.g. LAYOUT_TABLE) IS emitted, not
// silently dropped — RAPs commonly table their commitments.
// ---------------------------------------------------------------------------
{
  const blocks: Block[] = [layout("tbl1", "LAYOUT_TABLE", 7, ["tl1"]), line("tl1", 7, "TABLE_CONTENT_XYZ")];
  const out = buildTextFromLayoutBlocks(blocks);
  check("LAYOUT_TABLE text is emitted", out.includes("TABLE_CONTENT_XYZ"));
  check("LAYOUT_TABLE paragraph carries its page marker", out.includes("[p.7]"));
}

// ---------------------------------------------------------------------------
// (e) Empty input -> "".
// ---------------------------------------------------------------------------
{
  check("empty blocks array yields empty string", buildTextFromLayoutBlocks([]) === "");
}

// ---------------------------------------------------------------------------
// (f) Oversized block: a single block whose text exceeds DEFAULT_TARGET_CHARS
// must be emitted as MULTIPLE paragraphs, each carrying its own "[p.N]"
// marker — never a marker-less orphaned piece (the exact fabrication mode
// this design exists to prevent; see the chunk-boundary comment in
// pipeline.bedrock.ts).
// ---------------------------------------------------------------------------
{
  // ~130 sentences of ~60 chars each => comfortably over the 6000-char
  // DEFAULT_TARGET_CHARS threshold.
  const sentence = (n: number) => `Sentence number ${n} in the oversized table block goes here.`;
  const bigText = Array.from({ length: 130 }, (_, i) => sentence(i + 1)).join(" ");
  check("fixture text actually exceeds DEFAULT_TARGET_CHARS", bigText.length > DEFAULT_TARGET_CHARS);

  const blocks: Block[] = [layout("big1", "LAYOUT_TABLE", 9, ["bl1"]), line("bl1", 9, bigText)];
  const out = buildTextFromLayoutBlocks(blocks);
  const paragraphs = out.trim().split(/\n\s*\n/).filter(Boolean);

  check("oversized block is split into more than one paragraph", paragraphs.length > 1);
  check("every piece of the oversized block carries a [p.9] marker", paragraphs.every((p) => p.startsWith("[p.9]\n")));
  check("no piece exceeds the target size", paragraphs.every((p) => p.length <= DEFAULT_TARGET_CHARS * 1.5));
  // Reassembling the pieces (stripping markers) must reproduce the source text
  // — the split must lose nothing, just like chunk.ts's own splitter.
  const reassembled = paragraphs.map((p) => p.replace(/^\[p\.9\]\n/, "")).join(" ");
  check(
    "concatenating the split pieces reproduces the source text (no loss)",
    reassembled.replace(/\s+/g, " ").trim() === bigText.replace(/\s+/g, " ").trim(),
  );
  check("sentence 1 survives somewhere", out.includes("Sentence number 1 in"));
  check("sentence 100 survives somewhere", out.includes("Sentence number 130 in"));
}

// ---------------------------------------------------------------------------
// (g) The marker must fit INSIDE the size budget, not on top of it. The
// pre-split above only prevents marker-less pieces if the emitted paragraph —
// "[p.N]\n" INCLUDED — stays within DEFAULT_TARGET_CHARS. Otherwise
// chunkDocument's own splitLargeParagraph re-splits the block and keeps the
// marker on the FIRST piece only, recreating the exact orphan this design
// exists to prevent.
//
// The fixture packs to the boundary deliberately: 200 sentences of exactly 59
// chars joined by single spaces make a greedy sentence packer land on 60k - 1.
// Against a 6000 target that is 5999, which +6 for "[p.1]\n" OVERSHOOTS at
// 6005; against 6000-6 it is 5939, which fits. Check (f)'s 1.5x tolerance
// above cannot see this.
// ---------------------------------------------------------------------------
{
  const packed = Array.from({ length: 200 }, (_, i) => `S${String(i + 1).padStart(3, "0")} ${"x".repeat(53)}.`).join(" ");
  const blocks: Block[] = [layout("pk", "LAYOUT_TABLE", 1, ["pkl"]), line("pkl", 1, packed)];
  const paragraphs = buildTextFromLayoutBlocks(blocks).trim().split(/\n\s*\n/).filter(Boolean);
  check("boundary-packed block splits into several marked paragraphs", paragraphs.length > 1);
  check(
    "no paragraph exceeds the target ONCE THE [p.N] MARKER IS COUNTED",
    paragraphs.every((p) => p.startsWith("[p.1]\n") && p.length <= DEFAULT_TARGET_CHARS),
  );
}

process.exit(fail ? 1 : 0);
