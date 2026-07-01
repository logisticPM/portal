import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { EVAL_QUERIES } from "../src/lib/cases/validate/eval-queries";
import type { GoldQuery } from "../src/lib/cases/validate/retrieval";

const LAYERS = new Set(["known_item", "conceptual", "topical"]);
const FIXTURE_IDS = new Set(["tsilhqotin-2014", "haida-2004", "calder-1973", "fort-mckay-2020"]);

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

  // every gold line parses, references a known fixture case, uses grades 0/1/2,
  // and its qid exists in EVAL_QUERIES
  for (const g of gold) {
    assert.ok(qids.has(g.qid), `gold qid not in EVAL_QUERIES: ${g.qid}`);
    assert.ok(g.judgments.length > 0, `gold ${g.qid} has no judgments`);
    for (const j of g.judgments) {
      assert.ok(FIXTURE_IDS.has(j.caseId), `unknown fixture case: ${j.caseId}`);
      assert.ok([0, 1, 2].includes(j.rel), `bad grade: ${j.rel}`);
    }
  }
  console.log(`✅ eval-queries + fixture gold consistent (${EVAL_QUERIES.length} queries, ${gold.length} gold)`);
})().catch((e) => { console.error("❌ test failed:", e); process.exit(1); });
