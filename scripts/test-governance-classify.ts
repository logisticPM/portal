// Tests the one conservative classification decision (spec §6).
// Run: npx tsx scripts/test-governance-classify.ts
import { classifyUpload, coerceDataClass } from "../src/lib/governance";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

// A company's own upload is ALWAYS org_submitted.
check(
  "company upload → org_submitted",
  classifyUpload({ sessionKind: "company" }) === "org_submitted",
);
check(
  "company CANNOT declare its own upload public",
  classifyUpload({ sessionKind: "company", declaredPublic: true }) === "org_submitted",
);

// Staff can prove public only by declaring it explicitly.
check(
  "staff + declaredPublic → public",
  classifyUpload({ sessionKind: "indigenomics", declaredPublic: true }) === "public",
);
check(
  "staff without declaration → org_submitted (flag it, don't assume)",
  classifyUpload({ sessionKind: "indigenomics" }) === "org_submitted",
);
check(
  "staff + declaredPublic false → org_submitted",
  classifyUpload({ sessionKind: "indigenomics", declaredPublic: false }) === "org_submitted",
);

// No session / unknown → conservative.
check(
  "null session → org_submitted",
  classifyUpload({ sessionKind: null }) === "org_submitted",
);
check(
  "null session + declaredPublic → org_submitted",
  classifyUpload({ sessionKind: null, declaredPublic: true }) === "org_submitted",
);

// coerceDataClass: the Dynamo read-boundary guard (finding 1 & 2). Must fail
// CLOSED — anything not exactly "public" or "org_submitted" becomes
// "org_submitted", never "public".
check("coerceDataClass(undefined) → org_submitted (legacy row)", coerceDataClass(undefined) === "org_submitted");
check("coerceDataClass(null) → org_submitted", coerceDataClass(null) === "org_submitted");
check("coerceDataClass('banana') → org_submitted (garbage value)", coerceDataClass("banana") === "org_submitted");
check("coerceDataClass('public') → public (preserved)", coerceDataClass("public") === "public");
check("coerceDataClass('org_submitted') → org_submitted (preserved)", coerceDataClass("org_submitted") === "org_submitted");

process.exit(fail ? 1 : 0);
