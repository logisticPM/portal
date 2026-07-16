// Run: npx tsx scripts/test-migrate-rap-dataclass.ts
import { planRapDataClass } from "./migrate-rap-dataclass";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

check(
  "an untagged row backfills conservatively to org_submitted",
  planRapDataClass({ PK: "RAP#1", SK: "META" }) === "org_submitted",
);
check(
  "an already-tagged org_submitted row is left alone (idempotent)",
  planRapDataClass({ PK: "RAP#1", SK: "META", dataClass: "org_submitted" }) === null,
);
check(
  "an already-tagged public row is NOT downgraded",
  planRapDataClass({ PK: "RAP#2", SK: "META", dataClass: "public" }) === null,
);
check(
  "a garbage dataClass value is re-tagged conservatively",
  planRapDataClass({ PK: "RAP#3", SK: "META", dataClass: "banana" }) === "org_submitted",
);

process.exit(fail ? 1 : 0);
