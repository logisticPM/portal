import assert from "node:assert/strict";
import { caseToItems, reassembleCase, caseKeys, chunkSk } from "../src/lib/dynamo/cases-table";
import { caseFixtures } from "../src/lib/cases/fixtures";

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
console.log("✅ cases-table tests passed");
