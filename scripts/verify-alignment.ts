// ===========================================================================
// Alignment verification harness — `npm run verify:alignment`.
// Pure checks (score, normalize, marshaller) need no DB. Repo-parity + scenario
// sections (added in later tasks) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { cosine, structuredScore, combine } from "../src/lib/alignment/score";
import { normalizeSector, normalizeRegion } from "../src/lib/alignment/normalize";
import { opportunityKeys, toOpportunityItem, itemToOpportunity } from "../src/lib/dynamo/alignment-table";
import type { Opportunity } from "../src/lib/alignment/types";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
  // --- cosine ---
  check("cosine: identical vectors = 1", Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([1, 0])) - 1) < 1e-6);
  check("cosine: orthogonal = 0", Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))) < 1e-6);
  check("cosine: zero-vector = 0", cosine(new Float32Array([0, 0]), new Float32Array([1, 0])) === 0);

  // --- structured score ---
  const full = structuredScore({ sectorMatch: true, regionMatch: true, identityTier: "nation", ownershipPct: 100 });
  const none = structuredScore({ sectorMatch: false, regionMatch: false, identityTier: "self_declared", ownershipPct: 20 });
  const partial = structuredScore({ sectorMatch: true, regionMatch: false, identityTier: "ccab", ownershipPct: 80 });
  check("structured: full > partial > none", full > partial && partial > none && none >= 0);
  check("structured: full match caps at 1", full <= 1 && Math.abs(full - 1) < 1e-9);
  check("structured: sector+region+nation is high", full >= 0.8);

  // --- combine ---
  check("combine: weights structured + semantic", Math.abs(combine(1, 1) - 1) < 1e-6 && combine(0, 0) === 0);
  check("combine: monotonic in semantic", combine(0.5, 0.9) > combine(0.5, 0.1));

  // --- normalization (deterministic map) ---
  check("normalize sector: Construction -> construction", normalizeSector("Construction") === "construction");
  check("normalize sector: Logistics -> transport", normalizeSector("Logistics") === "transport");
  check("normalize sector: IT consulting -> consulting", normalizeSector("IT consulting") === "consulting");
  check("normalize sector: bare IT -> consulting", normalizeSector("IT") === "consulting");
  check("normalize sector: 'unit' does not match IT", normalizeSector("unit") === undefined);
  check("normalize sector: unknown -> undefined", normalizeSector("basket weaving") === undefined);
  check("normalize region: British Columbia -> BC", normalizeRegion("British Columbia") === "BC");
  check("normalize region: AB stays AB", normalizeRegion("AB") === "AB");

  // --- opportunity marshalling ---
  const o: Opportunity = {
    id: "cm-rbc-proc::s-eagle", commitmentId: "cm-rbc-proc", orgId: "rbc-royal-bank-of-canada",
    supplierId: "s-eagle", supplierName: "Eagle River Construction", commitmentTitle: "Grow Indigenous procurement",
    score: 0.82, reasons: { sectorMatch: true, regionMatch: false, identityTier: "nation", semantic: 0.71 },
    rationale: "Fits the construction procurement target.", status: "new", createdAt: "2025-01-15T00:00:00.000Z",
  };
  const item = toOpportunityItem(o);
  check("opp: PK is OPPORTUNITY#<orgId>", item.PK === "OPPORTUNITY#rbc-royal-bank-of-canada");
  check("opp: GSI1PK groups all (radar)", item.GSI1PK === "OPPORTUNITY");
  check("opp: round-trips", JSON.stringify(itemToOpportunity(item)) === JSON.stringify(o));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ verify-alignment crashed:", e);
  process.exit(1);
});
