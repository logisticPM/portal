import assert from "node:assert/strict";
import { toCaseItem, itemToCase, caseKeys } from "../src/lib/dynamo/cases-table";
import { caseFixtures } from "../src/lib/cases/fixtures";

for (const c of caseFixtures) {
  const item = toCaseItem(c);
  assert.equal(item.PK, `CASE#${c.id}`, "PK shape");
  assert.equal(item.SK, "PROFILE", "SK shape");
  assert.equal(item.et, "Case", "entity type");
  assert.equal(item.GSI1PK, `THEME#${c.themes[0]}`, "GSI1 by primary theme");
  const round = itemToCase(item);
  assert.deepEqual(round, c, `round-trip preserves ${c.id}`);
}
assert.deepEqual(caseKeys.profile("x"), { PK: "CASE#x", SK: "PROFILE" });
console.log("✅ cases-table tests passed");
