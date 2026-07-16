// Run: npx tsx scripts/test-migrate-rap-dataclass.ts
import { planRapDataClass } from "./migrate-rap-dataclass";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

check(
  "an untagged row backfills conservatively to org_submitted",
  planRapDataClass({ PK: "RAP#1", SK: "META", et: "Rap" }) === "org_submitted",
);
check(
  "an already-tagged org_submitted row is left alone (idempotent)",
  planRapDataClass({ PK: "RAP#1", SK: "META", et: "Rap", dataClass: "org_submitted" }) === null,
);
check(
  "an already-tagged public row is NOT downgraded",
  planRapDataClass({ PK: "RAP#2", SK: "META", et: "Rap", dataClass: "public" }) === null,
);
check(
  "a garbage dataClass value is re-tagged conservatively",
  planRapDataClass({ PK: "RAP#3", SK: "META", et: "Rap", dataClass: "banana" }) === "org_submitted",
);

// Scope exclusion (finding 4): OrgClaim rows (et: "Claim") are a grant record,
// not document-derived content — the plan must never touch them, tagged or not.
check(
  "an untagged OrgClaim row is left alone (out of scope)",
  planRapDataClass({ PK: "ORGCLAIM#123456789", SK: "PARTY#p1", et: "Claim" }) === null,
);
check(
  "an OrgClaim row is left alone even if it somehow carries a garbage dataClass",
  planRapDataClass({ PK: "ORGCLAIM#123456789", SK: "PARTY#p1", et: "Claim", dataClass: "banana" }) === null,
);

// Every other in-scope entity type still gets backfilled.
for (const et of ["Job", "Org", "Rap", "Commitment", "Observation", "Rollup"]) {
  check(
    `an untagged ${et} row backfills conservatively to org_submitted`,
    planRapDataClass({ PK: `X#1`, SK: "META", et }) === "org_submitted",
  );
}

process.exit(fail ? 1 : 0);
