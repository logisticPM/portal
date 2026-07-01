import assert from "node:assert/strict";
import { chunkText, TARGET_CHUNK_BYTES } from "../src/lib/cases/ingest/a2aj";

// short paragraph stays one chunk, untouched
const short = chunkText("A short paragraph about Aboriginal title.");
assert.equal(short.length, 1, "short → 1 chunk");
assert.equal(short[0].text, "A short paragraph about Aboriginal title.");

// a long single paragraph (no blank lines) is split into retrieval-sized pieces
const longPara = Array.from({ length: 400 }, (_, i) => `This is sentence number ${i}.`).join(" ");
assert.ok(Buffer.byteLength(longPara, "utf8") > TARGET_CHUNK_BYTES, "test input exceeds target");
const chunks = chunkText(longPara);
assert.ok(chunks.length > 1, "long paragraph splits into multiple chunks");
for (const c of chunks)
  assert.ok(Buffer.byteLength(c.text, "utf8") <= TARGET_CHUNK_BYTES + 64, "each chunk ~≤ target");

// paragraph boundaries (blank lines) still split first
const twoPara = chunkText("First paragraph.\n\nSecond paragraph.");
assert.equal(twoPara.length, 2, "blank-line paragraphs → 2 chunks");

// chunk ids are sequential para-N
assert.equal(chunks[0].paragraph, "para-1");
assert.equal(chunks[1].paragraph, "para-2");

console.log("✅ chunk tests passed");
