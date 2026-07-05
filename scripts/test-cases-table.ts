import assert from "node:assert/strict";
import { caseToItems, reassembleCase, caseKeys, chunkSk } from "../src/lib/dynamo/cases-table";
import { caseFixtures } from "../src/lib/cases/fixtures";
import type { LegalCase } from "../src/lib/cases/types";

for (const c of caseFixtures) {
  const items = caseToItems(c);
  const profile = items.find((it) => it.SK === "PROFILE");
  const chunks = items.filter((it) => String(it.SK).startsWith("CHUNK#"));
  assert.ok(profile, `${c.id} has a PROFILE item`);
  assert.equal(profile!.PK, `CASE#${c.id}`);
  assert.equal(profile!.et, "Case");
  assert.equal(profile!.data.chunks, undefined, "profile data omits chunks");
  assert.equal(profile!.chunkCount, c.chunks?.length ?? 0, "chunkCount matches");
  assert.equal(chunks.length, c.chunks?.length ?? 0, "one item per chunk");
  // round-trip: reassemble equals original
  const round = reassembleCase(profile, chunks);
  assert.deepEqual(round, c, `round-trip preserves ${c.id}`);
}
assert.equal(chunkSk(1), "CHUNK#0001");
assert.deepEqual(caseKeys.profile("x"), { PK: "CASE#x", SK: "PROFILE" });

// Kitchen-sink round-trip: the fixtures above never set every optional field at
// once, so a silent itemToCase omission (see MAINTAINER note in cases-table.ts)
// can ship undetected. This case populates EVERY optional field in LegalCase
// (types.ts) and pins the full field set against future itemToCase drift.
const kitchenSink: LegalCase = {
  id: "kitchen-sink-2026", citation: "2026 SCC 1", citation2: "[2026] 1 SCR 1",
  styleOfCause: "Kitchen Sink v. Everything", court: "Supreme Court of Canada",
  level: "scc", year: 2026, jurisdiction: "Canada",
  nations: ["Test Nation"], themes: ["land_rights", "fiduciary"],
  outcome: { outcomeType: "precedent", winType: "party_win", whoWon: "Test Nation",
    holding: "A holding that exercises every optional field." },
  economic: {
    valueType: "settlement", settlementAmount: 1_000_000, resourceRevenue: 500_000,
    equityStake: 10, economicSummary: "A settlement plus revenue share plus equity.",
  },
  valueRealization: { status: "realized", note: "Fully realized.", asOf: "2026-01-01" },
  summary: { claims: [
    { text: "A citation-anchored claim.", sourceParagraph: "para-1", sourceUrl: "https://example.org/kitchen-sink" },
  ] },
  summaryMeta: { method: "llm", model: "us.meta.llama3-3-70b-instruct-v1:0", generatedAt: "2026-07-04T00:00:00.000Z", claimsDropped: 2 },
  chunks: [
    { paragraph: "para-1", text: "A citation-anchored claim appears here in full." },
    { paragraph: "para-2", text: "A second paragraph of judgment text." },
  ],
  casesCited: ["[2000] 1 SCR 1"], casesCiting: ["[2027 SCC 2]"], citingCount: 1,
  enrichmentLevel: "deep", corpusTier: "core",
  labelMeta: { method: "dual_llm", models: ["model-a", "model-b"], agreement: "full", confidence: "high", needsReview: false },
  fullTextAvailable: true,
  provenance: { source: "manual", sourceUrl: "https://example.org/kitchen-sink", upstreamLicense: "open", ingestedAt: "2026-07-01T00:00:00.000Z", unofficial: true },
  sensitivity: "contains-sensitive-detail",
};
const ksItems = caseToItems(kitchenSink);
const ksBack = reassembleCase(ksItems[0], ksItems.slice(1));
assert.deepEqual(ksBack, kitchenSink, "kitchen-sink round-trip preserves every optional field");

console.log("✅ cases-table tests passed");
