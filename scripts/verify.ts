// ===========================================================================
// Verification harness — `npm run verify` (needs DynamoDB Local: `npm run ddb:up`).
//
// Pins the data layer's behaviour so changes to fixtures or repo logic can't
// silently regress:
//   1. Portal: repo.dynamo ≡ repo.mock on the seeded reads (golden reference)
//   2. Portal mutations: report→confirm→coverage, the CORRECTED path, register, withdraw
//   3. Survey: nested round-trip + mock ≡ dynamo
//
// Resets + reseeds both tables at start (deterministic) and again at end (leaves
// clean demo state). Imports impls directly, so it doesn't depend on REPO_IMPL.
// ===========================================================================
import { BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { createSingleTable } from "../src/lib/dynamo/create";
import { mockRepo } from "../src/lib/repo/repo.mock";
import { dynamoRepo } from "../src/lib/repo/repo.dynamo";
import { seedAll } from "../src/lib/seed/seed";
import { mockSurveyRepo } from "../src/lib/survey/repo.mock";
import { dynamoSurveyRepo } from "../src/lib/survey/repo.dynamo";
import { seedSurvey } from "../src/lib/survey/seed";
import { mockCaseRepo } from "../src/lib/cases/repo.mock";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { seedCases } from "./seed-cases";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sortIds = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

async function resetTable(tableName: string) {
  const keys: { PK: string; SK: string }[] = [];
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(
      new ScanCommand({ TableName: tableName, ProjectionExpression: "PK, SK", ExclusiveStartKey: start }),
    );
    for (const it of (r.Items ?? []) as { PK: string; SK: string }[]) keys.push({ PK: it.PK, SK: it.SK });
    start = r.LastEvaluatedKey;
  } while (start);
  for (let i = 0; i < keys.length; i += 25) {
    await ddbDoc.send(
      new BatchWriteCommand({
        RequestItems: { [tableName]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) },
      }),
    );
  }
}

async function freshSeed() {
  await createSingleTable("DataPortal");
  await createSingleTable("RapSurvey");
  await resetTable("DataPortal");
  await resetTable("RapSurvey");
  await seedAll();
  await seedSurvey();
  await createSingleTable("LegalCases");
  await resetTable("LegalCases");
  await (async () => { process.env.CASES_TABLE = "LegalCases"; await seedCases(); })();
}

async function main() {
  await freshSeed();

  // --- 1. portal read parity: dynamo ≡ mock --------------------------------
  console.log("\n# 1. portal read parity (dynamo ≡ mock)");
  for (const c of ["c-northway", "c-cedartrust", "c-mapletel"]) {
    check(`getCoverage(${c})`, eq(await mockRepo.getCoverage(c), await dynamoRepo.getCoverage(c)));
  }
  for (const s of ["s-eagle", "s-raven", "s-sweetgrass"]) {
    const [m, d] = [await mockRepo.getSupplierRecord(s), await dynamoRepo.getSupplierRecord(s)];
    check(
      `getSupplierRecord(${s})`,
      m.confirmedRevenue === d.confirmedRevenue &&
        m.pendingCount === d.pendingCount &&
        m.disputedCount === d.disputedCount &&
        eq(sortIds(m.lines), sortIds(d.lines)),
    );
  }
  check("getIndexSummary", eq(await mockRepo.getIndexSummary(), await dynamoRepo.getIndexSummary()));
  check(
    "listParties('supplier')",
    eq(sortIds(await mockRepo.listParties("supplier")), sortIds(await dynamoRepo.listParties("supplier"))),
  );

  // --- 2. portal mutations -------------------------------------------------
  console.log("\n# 2. portal mutations");
  // demo loop
  const before = await dynamoRepo.getCoverage("c-northway");
  const line = await dynamoRepo.createReportedLine({
    companyId: "c-northway", supplierId: "s-raven", amount: 500_000, flowType: "procurement", period: "2025",
  });
  const inbox = await dynamoRepo.listPendingForSupplier("s-raven");
  check("new line appears in supplier pending inbox", inbox.some((l) => l.id === line.id));
  await dynamoRepo.recordConfirmation({ lineId: line.id, status: "confirmed", byPartyId: "s-raven" });
  const after = await dynamoRepo.getCoverage("c-northway");
  check("coverage rises by 500k after confirm", after.totalConfirmed === before.totalConfirmed + 500_000,
    `${before.totalConfirmed} → ${after.totalConfirmed}`);

  // CORRECTED path (previously untested): correct a pending seeded line to a lower amount
  const covBefore = await dynamoRepo.getCoverage("c-northway");
  await dynamoRepo.recordConfirmation({ lineId: "l-3", status: "corrected", correctedAmount: 50_000, byPartyId: "s-sweetgrass" });
  const covAfter = await dynamoRepo.getCoverage("c-northway");
  check("corrected line counts at corrected amount (+50k)", covAfter.totalConfirmed === covBefore.totalConfirmed + 50_000,
    `${covBefore.totalConfirmed} → ${covAfter.totalConfirmed}`);
  const sweetgrass = await dynamoRepo.getSupplierRecord("s-sweetgrass");
  check("supplier record reflects corrected revenue", sweetgrass.confirmedRevenue === 50_000, `$${sweetgrass.confirmedRevenue}`);

  // registerSupplier (previously untested)
  const newSup = await dynamoRepo.registerSupplier({ name: "Verify Test Co" });
  const fetched = await dynamoRepo.getParty(newSup.id);
  check("registerSupplier persists as self_declared", fetched?.role === "supplier" && (fetched as any).identityTier === "self_declared");
  const suppliers = await dynamoRepo.listParties("supplier");
  check("registered supplier appears in registry", suppliers.some((s) => s.id === newSup.id), `${suppliers.length} suppliers`);

  // withdraw (OCAP)
  const preWithdraw = await dynamoRepo.getCoverage("c-northway");
  await dynamoRepo.withdraw("s-raven");
  const postWithdraw = await dynamoRepo.getCoverage("c-northway");
  check("withdraw drops coverage", postWithdraw.totalConfirmed < preWithdraw.totalConfirmed,
    `${preWithdraw.totalConfirmed} → ${postWithdraw.totalConfirmed}`);
  const revertedInbox = await dynamoRepo.listPendingForSupplier("s-raven");
  check("withdrawn lines revert to pending", revertedInbox.some((l) => l.id === line.id));

  // --- 3. survey -----------------------------------------------------------
  console.log("\n# 3. survey");
  const r = await dynamoSurveyRepo.getResponse("org-mckinsey", "2025");
  check("survey response nested round-trip", !!r &&
    r.procurementTotal === 100_000 &&
    r.indigenousStaff.breakdown.traineeships === 3 &&
    r.partneredWith.length === 2 &&
    r.governanceStructures.includes("external_advisory"));
  const [ms, ds] = [await mockSurveyRepo.listResponsesByYear("2025"), await dynamoSurveyRepo.listResponsesByYear("2025")];
  check("survey listResponsesByYear: mock ≡ dynamo", eq(ms.map((x) => x.orgId).sort(), ds.map((x) => x.orgId).sort()),
    `${ds.length} responses`);

  // ---- Cases: dynamo ≡ mock on the seeded reads ----
  console.log("\n# 4. cases (dynamo ≡ mock)");
  const mList = await mockCaseRepo.listCases();
  const dList = await dynamoCaseRepo.listCases();
  check("cases: list count mock≡dynamo", mList.length === dList.length, `${mList.length}/${dList.length}`);
  check("cases: list ids mock≡dynamo", eq(sortIds(mList), sortIds(dList)));
  check("cases: getCase mock≡dynamo",
    eq(await mockCaseRepo.getCase("haida-2004"), await dynamoCaseRepo.getCase("haida-2004")));
  check("cases: activation mock≡dynamo",
    eq(await mockCaseRepo.getActivationSummary(), await dynamoCaseRepo.getActivationSummary()));
  check("cases: search mock≡dynamo",
    eq(sortIds(await mockCaseRepo.searchCases("Tsilhqot'in")), sortIds(await dynamoCaseRepo.searchCases("Tsilhqot'in"))));

  // ---- Cases Phase 2-A: tier + unclassified flow ----
  const subCase = {
    ...(await mockCaseRepo.getCase("haida-2004"))!,
    id: "verify-substrate", citation: "9999 SCC 9", corpusTier: "substrate" as const,
    themes: [] as any[], outcome: { outcomeType: "unclassified" as const, winType: "unclassified" as const, whoWon: "", holding: "" },
  };
  const subItems = caseToItems(subCase).map((Item) => ({ PutRequest: { Item } }));
  for (let i = 0; i < subItems.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { LegalCases: subItems.slice(i, i + 25) } }));
  const coreList = await dynamoCaseRepo.listCases();                    // default core-only
  const subList = await dynamoCaseRepo.listCases({ tier: "substrate" });
  check("cases: listCases excludes substrate", coreList.every((c) => c.corpusTier === "core"));
  check("cases: tier:substrate returns substrate", subList.some((c) => c.id === "verify-substrate"));
  check("cases: substrate round-trips unclassified",
    (await dynamoCaseRepo.getCase("verify-substrate"))?.outcome.winType === "unclassified");

  // leave a clean, seeded state for demoing
  await freshSeed();

  console.log(`\n${fail === 0 ? "🎉 ALL PASS" : "⚠️  FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("❌ verify crashed:", e);
  process.exit(1);
});
