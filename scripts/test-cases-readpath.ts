// Integration test (needs the full local corpus in DynamoDB Local): scanning GSI1
// returns exactly the set of Case profiles the old base-table filter did. Fast — the
// base count is a COUNT scan (no payload), GSI1 holds only profiles.
import assert from "node:assert/strict";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

// Count Case items on the base table WITHOUT transferring item data (Select COUNT).
async function baseCaseCount(): Promise<number> {
  let n = 0;
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({
      TableName: TABLE,
      Select: "COUNT",
      FilterExpression: "#et = :c",
      ExpressionAttributeNames: { "#et": "et" },
      ExpressionAttributeValues: { ":c": "Case" },
      ExclusiveStartKey: start,
    }));
    n += r.Count ?? 0;
    start = r.LastEvaluatedKey;
  } while (start);
  return n;
}

// Scan GSI1 → the profile ids it projects (with their full `data`).
async function gsi1Profiles(): Promise<{ ids: Set<string>; sampleHasData: boolean }> {
  const ids = new Set<string>();
  let sampleHasData = false;
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, IndexName: "GSI1", ExclusiveStartKey: start }));
    for (const it of r.Items ?? []) {
      assert.equal(it.et, "Case", `GSI1 returned a non-Case item (et=${it.et}) — chunks should not be projected`);
      ids.add(String(it.data?.id));
      if (it.data?.id) sampleHasData = true;
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return { ids, sampleHasData };
}

(async () => {
  const [baseN, { ids, sampleHasData }] = await Promise.all([baseCaseCount(), gsi1Profiles()]);
  assert.ok(baseN > 3000, `expected >3000 Case profiles, base COUNT found ${baseN} — is the full corpus loaded?`);
  assert.equal(ids.size, baseN, `GSI1 profile count ${ids.size} != base-table Case count ${baseN}`);
  assert.ok(sampleHasData, "GSI1 items are missing the `data` attribute (projection not ALL?)");
  assert.ok(ids.has("2004-scc-73"), "known case 2004-scc-73 missing from GSI1 scan");
  console.log(`✅ read-path parity: base=${baseN} · GSI1=${ids.size} (identical) · data present · known case present`);
})().catch((e) => { console.error(e); process.exit(1); });
