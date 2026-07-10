// scripts/test-rap-registry.ts
import assert from "node:assert/strict";
import { StubRegistryProvider, cbrSearchUrl } from "../src/lib/rap/registry";

async function main() {
  const reg = new StubRegistryProvider({
    "119653384": { businessNumber: "119653384", legalName: "ENBRIDGE INC.", status: "Active", jurisdiction: "CA-federal", officeLocation: "CALGARY, Alberta", source: "ised" },
  });

  const hit = await reg.verifyBN("119653384");
  assert.equal(hit?.legalName, "ENBRIDGE INC.", "known BN resolves");
  assert.equal(await reg.verifyBN("000000000"), null, "unknown BN → null");

  const url = cbrSearchUrl("Enbridge Inc.");
  assert.ok(url.startsWith("https://ised-isde.canada.ca/cbr-rec/"), "CBR base");
  assert.ok(/Enbridge/.test(decodeURIComponent(url)), "name is in the query");
  console.log("OK test-rap-registry");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
