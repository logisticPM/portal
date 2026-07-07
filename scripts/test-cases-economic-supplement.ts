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

  // --- Task 2: widened resource_revenue rubric ---
  const { RUBRIC_VERSION, THEME_RUBRIC, labelPrompt } = await import("../src/lib/cases/ingest/rubric");
  assert.equal(RUBRIC_VERSION, "2026-07-06.1", "RUBRIC_VERSION must be bumped");
  assert.match(THEME_RUBRIC.resource_revenue, /impact-benefit/, "rubric must mention impact-benefit agreements");
  assert.match(THEME_RUBRIC.resource_revenue, /expropriation|taking/, "rubric must mention taking/expropriation");
  assert.match(labelPrompt("hello"), /impact-benefit/, "widened rubric must reach the label prompt");

  // --- Task 3: additive-safe upsert ---
  const { upsertIfAbsent } = await import("./cases-harvest-economic");
  type LC = import("../src/lib/cases/types").LegalCase;
  const mkCase = (id: string): LC => ({
    id, citation: id, styleOfCause: id, court: "SCC", level: "scc", year: 2010,
    jurisdiction: "CA", nations: [], themes: [],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "", holding: "" },
    casesCited: [], casesCiting: [], citingCount: 0, enrichmentLevel: "index", corpusTier: "substrate",
    fullTextAvailable: false,
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026", unofficial: true },
  });

  const calls: any[] = [];
  const stub = async (cmd: any) => {
    calls.push(cmd);
    if (cmd.input.Item.PK === "CASE#present") {
      const e: any = new Error("exists"); e.name = "ConditionalCheckFailedException"; throw e;
    }
    return {};
  };
  const res = await upsertIfAbsent([mkCase("present"), mkCase("absent")], stub);
  assert.deepEqual(res, { added: 1, skipped: 1 }, "existing PROFILE is skipped, absent one is written");
  assert.equal(calls[0].input.ConditionExpression, "attribute_not_exists(PK)", "write must be conditional");
  assert.equal(calls[0].input.Item.SK, "PROFILE", "writes the PROFILE item");

  let threw = false;
  try {
    await upsertIfAbsent([mkCase("absent")], async () => {
      const e: any = new Error("throughput"); e.name = "ProvisionedThroughputExceededException"; throw e;
    });
  } catch { threw = true; }
  assert.ok(threw, "a non-conditional error must propagate, not be swallowed");

  console.log("✅ test-cases-economic-supplement passed");
})().catch((e) => { console.error(e); process.exit(1); });
