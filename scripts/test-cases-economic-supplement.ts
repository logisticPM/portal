// Economic corpus supplementation (spec 2026-07-06): sources + rubric + additive-safe upsert.
import assert from "node:assert/strict";

(async () => {
  // --- Task 1: expanded economic harvest surface ---
  const { THEME_QUERIES, ECON_CANDIDATE_SEEDS } = await import("../src/lib/cases/ingest/sources");
  const rr = THEME_QUERIES.resource_revenue;
  const expectedTerms = [
    "revenue sharing", "resource revenue", "impact benefit agreement",
    "resource royalties", "equity stake", "equitable compensation",
    "expropriation compensation", "economic loss",
  ];
  assert.equal(rr.length, expectedTerms.length, "resource_revenue should have 8 query terms");
  for (const term of expectedTerms) assert.ok(rr.includes(term), `missing query term: ${term}`);
  assert.ok(Array.isArray(ECON_CANDIDATE_SEEDS) && ECON_CANDIDATE_SEEDS.length >= 4, "need >=4 candidate seeds");
  for (const c of ECON_CANDIDATE_SEEDS) assert.match(c, /\d{4}\s+[A-Z]/, `malformed citation: ${c}`);

  console.log("✅ test-cases-economic-supplement passed");
})().catch((e) => { console.error(e); process.exit(1); });
