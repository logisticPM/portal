// ===========================================================================
// Alignment verification harness — `npm run verify:alignment`.
// Pure checks (score, normalize, marshaller) need no DB. Repo-parity + scenario
// sections (added in later tasks) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { getSupplierProfile } from "../src/lib/suppliers/supplier-profiles";
import { cosine, fitScore, THRESHOLD } from "../src/lib/alignment/score";
import { bm25Relevance } from "../src/lib/alignment/relevance";
import { normalizeSector, normalizeRegion } from "../src/lib/alignment/normalize";
import { opportunityKeys, toOpportunityItem, itemToOpportunity } from "../src/lib/dynamo/alignment-table";
import type { Opportunity } from "../src/lib/alignment/types";
import { createSingleTable } from "../src/lib/dynamo/create";
import { mockAlignmentRepo, _resetMockAlignment } from "../src/lib/alignment/repo.mock";
import { dynamoAlignmentRepo } from "../src/lib/alignment/repo.dynamo";
import { computeForCommitment } from "../src/lib/alignment/engine";
import { alignmentRepo } from "../src/lib/alignment";

async function resetAlignmentTable() {
  const { ddbDoc } = await import("../src/lib/dynamo/client");
  const { ScanCommand, BatchWriteCommand } = await import("@aws-sdk/lib-dynamodb");
  const r = await ddbDoc.send(new ScanCommand({ TableName: "Alignment", ProjectionExpression: "PK, SK" }));
  const keys = (r.Items ?? []) as { PK: string; SK: string }[];
  for (let i = 0; i < keys.length; i += 25) {
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { Alignment: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
  }
}

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

  // --- fit score (real signals only: sector + relevance + tier + ownership) ---
  const full = fitScore({ sectorMatch: true, relevance: 1, identityTier: "nation", ownershipPct: 100 });
  const none = fitScore({ sectorMatch: false, relevance: 0, identityTier: "self_declared", ownershipPct: 20 });
  const partial = fitScore({ sectorMatch: true, relevance: 0.3, identityTier: "ccib", ownershipPct: 80 });
  check("fit: full > partial > none", full > partial && partial > none && none >= 0);
  check("fit: full match caps at 1", full <= 1 && Math.abs(full - 1) < 1e-9);
  check("fit: sector match alone clears threshold", fitScore({ sectorMatch: true, relevance: 0, identityTier: "nation", ownershipPct: 51 }) >= THRESHOLD);
  check("fit: monotonic in relevance", fitScore({ sectorMatch: false, relevance: 0.9, identityTier: "nation" }) > fitScore({ sectorMatch: false, relevance: 0.1, identityTier: "nation" }));
  check("fit: sector term dominates relevance", fitScore({ sectorMatch: true, relevance: 0, identityTier: "ccib" }) > fitScore({ sectorMatch: false, relevance: 1, identityTier: "ccib" }) - 0.05);

  // --- BM25 relevance (real, deterministic, offline) ---
  const rel = bm25Relevance("Grow Indigenous construction procurement", [
    { id: "match", text: "Eagle River Construction · Construction services" },
    { id: "nomatch", text: "Raven Logistics · freight and warehousing" },
  ]);
  check("relevance: capability-overlap supplier scores higher", rel[0] > rel[1]);
  check("relevance: best match normalizes to 1", Math.abs(rel[0] - 1) < 1e-9);
  check("relevance: no-overlap pool is all zero", bm25Relevance("construction", [{ id: "x", text: "totally unrelated widgets" }]).every((v) => v === 0));

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
    score: 0.82, reasons: { sectorMatch: true, relevance: 0.71, identityTier: "nation", semantic: 0.71 },
    rationale: "Fits the construction procurement target.", status: "new", createdAt: "2025-01-15T00:00:00.000Z",
  };
  const item = toOpportunityItem(o);
  check("opp: PK is OPPORTUNITY#<orgId>", item.PK === "OPPORTUNITY#rbc-royal-bank-of-canada");
  check("opp: GSI1PK groups all (radar)", item.GSI1PK === "OPPORTUNITY");
  check("opp: round-trips", JSON.stringify(itemToOpportunity(item)) === JSON.stringify(o));

  // --- opportunity repo parity (DynamoDB Local) ---
  if (process.env.DYNAMO_ENDPOINT) {
    process.env.ALIGNMENT_TABLE = "Alignment";
    await createSingleTable("Alignment");
    await resetAlignmentTable();
    _resetMockAlignment();
    await mockAlignmentRepo.upsert(o);
    await dynamoAlignmentRepo.upsert(o);
    const m = await mockAlignmentRepo.listForOrg(o.orgId);
    const d = await dynamoAlignmentRepo.listForOrg(o.orgId);
    check("opp repo: mock ≡ dynamo (listForOrg)", JSON.stringify(m) === JSON.stringify(d));
    check("opp repo: listAll returns it", (await dynamoAlignmentRepo.listAll()).some((x) => x.id === o.id));
    await dynamoAlignmentRepo.upsert({ ...o, score: 0.5 }); // same id, different score
    check("opp repo: upsert idempotent on score change", (await dynamoAlignmentRepo.listForOrg(o.orgId)).filter((x) => x.id === o.id).length === 1);
    // restore original score in both repos so tie-order check below starts from a clean state
    _resetMockAlignment();
    await resetAlignmentTable();
    await mockAlignmentRepo.upsert(o);
    await dynamoAlignmentRepo.upsert(o);
    const o2 = { ...o, id: "cm-rbc-proc::s-raven", supplierId: "s-raven", supplierName: "Raven Logistics" };
    await mockAlignmentRepo.upsert(o2);
    await dynamoAlignmentRepo.upsert(o2);
    check("opp repo: mock ≡ dynamo (listAll, tie-order)", JSON.stringify(await mockAlignmentRepo.listAll()) === JSON.stringify(await dynamoAlignmentRepo.listAll()));

    // --- engine scenario: a procurement commitment matches a same-sector verified supplier ---
    process.env.EMBED_PROVIDER = "stub"; // deterministic semantic score
    const scenarioCommit = {
      id: "cm-test-proc", orgName: "Test Co", orgId: "test-co", sector: "construction" as const,
      orgSize: "large" as const, type: "procurement" as const, title: "Grow Indigenous construction procurement",
      targetYear: 2027, status: "committed" as const, progressPct: 10, history: [{ period: "2025", status: "committed" as const, progressPct: 10 }],
      createdAt: "2025-01-15T00:00:00.000Z", detail: "Buy construction services from Indigenous firms.",
    };
    const supplierPool = [
      { id: "s-eagle", role: "supplier" as const, name: "Eagle River Construction", identityTier: "nation" as const, ownershipPct: 100, sector: "Construction", sectorNorm: "construction" as const, region: "BC", regionNorm: "BC", registered: true, createdAt: "2025-01-15T00:00:00.000Z" },
      { id: "s-raven", role: "supplier" as const, name: "Raven Logistics", identityTier: "ccib" as const, ownershipPct: 80, sector: "Logistics", sectorNorm: "transport" as const, region: "AB", regionNorm: "AB", registered: true, createdAt: "2025-01-15T00:00:00.000Z" },
    ];
    const opps = await computeForCommitment(scenarioCommit as any, supplierPool as any, alignmentRepo);
    check("engine: top match is the construction supplier", opps[0]?.supplierId === "s-eagle");
    check("engine: score above threshold + reasons.sectorMatch", (opps[0]?.score ?? 0) >= THRESHOLD && opps[0]?.reasons.sectorMatch === true);
    check("engine: stub embedder leaves no semantic term (score is real signal only)", opps[0]?.reasons.semantic === undefined);
    check("engine: reasons carry a real BM25 relevance", typeof opps[0]?.reasons.relevance === "number" && opps[0]!.reasons.relevance > 0);
    const r = opps[0]?.rationale ?? "";
    check("engine: rationale is a real sentence, NOT a stub theme-array", r.length > 0 && !r.trim().startsWith("["));
    check("engine: rationale states real facts (tier + sector)", r.includes("Nation-verified") && /construction/i.test(r));
    check("engine: upserted to repo", (await alignmentRepo.listForOrg("test-co")).some((x) => x.supplierId === "s-eagle"));
    const noOrgCommit = { ...scenarioCommit, id: "cm-noorg", orgId: undefined };
    check("engine: skips commitment without orgId", (await computeForCommitment(noOrgCommit as any, supplierPool as any, alignmentRepo)).length === 0);
  } else {
    console.warn("⚠️  opp repo parity skipped — set DYNAMO_ENDPOINT (npm run ddb:up)");
  }

  // --- supplier profiles (curated real data) ---
  check("profile: norsask HQ", getSupplierProfile("s-norsask")?.headquarters === "Meadow Lake, Saskatchewan");
  check("profile: 3ne has no employees (unpublished)", getSupplierProfile("s-3ne")?.employees === undefined);
  check("profile: unknown id -> undefined", getSupplierProfile("s-nope") === undefined);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ verify-alignment crashed:", e);
  process.exit(1);
});
