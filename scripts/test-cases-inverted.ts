// Parity: the inverted-index BM25 must rank IDENTICALLY (score + order) to the
// reference Bm25 class — the published eval numbers depend on it.
import assert from "node:assert/strict";
import { Bm25, tokenize } from "../src/lib/cases/search/bm25";
import { buildInverted, scoreInverted } from "../src/lib/cases/search/inverted";

const DOCS = [
  { id: "a#meta", text: "Haida Nation v British Columbia duty to consult forestry tenure" },
  { id: "b#meta", text: "Tsilhqotin Nation aboriginal title declared over claim area" },
  { id: "c#chunk#1", text: "the duty to consult arises when the Crown has knowledge of the asserted right" },
  { id: "d#chunk#1", text: "the duty to consult arises when the Crown has knowledge of the asserted right" }, // tie with c
  { id: "e#chunk#2", text: "fisheries revenue sharing agreement between the nation and canada" },
];

const tokenized = DOCS.map((d) => ({ id: d.id, tokens: tokenize(d.text) }));
const reference = new Bm25(tokenized);
const inv = buildInverted(tokenized);

const QUERIES = [
  "duty to consult",
  "aboriginal title",
  "revenue sharing",
  "crown knowledge asserted",
  "consult consult duty",      // duplicate query terms (dedup path)
  "nonexistent zzz term",      // no hits
  "",                          // empty query
  "the",                       // stopword-ish, present in several docs
];

(async () => {
  for (const q of QUERIES) {
    const want = reference.search(tokenize(q));
    const got = scoreInverted(inv, tokenize(q));
    assert.deepEqual(
      got.map((r) => ({ id: r.id, score: r.score })),
      want.map((r) => ({ id: r.id, score: r.score })),
      `parity failed for query "${q}"`,
    );
  }
  // tie-break sanity: c and d have identical text → equal scores, id asc
  const tie = scoreInverted(inv, tokenize("duty to consult"));
  const ci = tie.findIndex((r) => r.id === "c#chunk#1");
  const di = tie.findIndex((r) => r.id === "d#chunk#1");
  assert.ok(ci >= 0 && di === ci + 1, "tied docs must sort id-asc adjacent");
  console.log("✅ inverted BM25 parity (scores + order, incl. ties)");
})().catch((e) => { console.error(e); process.exit(1); });
