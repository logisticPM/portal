import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { EVAL_QUERIES } from "../src/lib/cases/validate/eval-queries";
import type { GoldQuery } from "../src/lib/cases/validate/retrieval";

const LAYERS = new Set(["known_item", "conceptual", "topical"]);

// every query has a valid layer + unique qid
const qids = new Set<string>();
for (const q of EVAL_QUERIES) {
  assert.ok(LAYERS.has(q.layer), `bad layer: ${q.layer}`);
  assert.ok(!qids.has(q.qid), `dup qid: ${q.qid}`);
  qids.add(q.qid);
}
assert.ok(EVAL_QUERIES.some((q) => q.layer === "known_item"), "has known_item");
assert.ok(EVAL_QUERIES.some((q) => q.layer === "conceptual"), "has conceptual");
assert.ok(EVAL_QUERIES.some((q) => q.layer === "topical"), "has topical");

(async () => {
  const text = await fs.readFile("docs/research/gold/cases-retrieval-gold.jsonl", "utf8");
  const gold = text.trim().split(/\n+/).filter(Boolean).map((l) => JSON.parse(l) as GoldQuery);

  // every gold line parses, its qid exists in EVAL_QUERIES, judgments are non-empty,
  // each caseId is a non-empty slug, and grades are 0/1/2. (Gold references real
  // corpus ids — slugified citations — not just the seed fixtures.)
  const qseen = new Set<string>();
  for (const g of gold) {
    assert.ok(qids.has(g.qid), `gold qid not in EVAL_QUERIES: ${g.qid}`);
    qseen.add(g.qid);
    assert.ok(g.judgments.length > 0, `gold ${g.qid} has no judgments`);
    for (const j of g.judgments) {
      assert.ok(typeof j.caseId === "string" && j.caseId.length > 0, `bad caseId in ${g.qid}`);
      assert.ok([0, 1, 2].includes(j.rel), `bad grade: ${j.rel}`);
    }
  }
  // every query is covered by the gold
  for (const q of EVAL_QUERIES) assert.ok(qseen.has(q.qid), `no gold for query ${q.qid}`);
  console.log(`✅ eval-queries + gold consistent (${EVAL_QUERIES.length} queries, ${gold.length} gold)`);
})().catch((e) => { console.error("❌ test failed:", e); process.exit(1); });
