// ===========================================================================
// DynamoDB Streams aggregation Lambda. Fires on every RapData write; when an
// Observation (PK=COMMIT#<id>, SK=OBS#<ts>) lands, it recomputes that
// commitment's rollup (COMMIT#<id>/META) so the dashboard reads one item
// instead of scanning the observation history.
//
// Only the Keys are inspected (no unmarshalling needed) to decide relevance.
// The rollup write has SK=META, not OBS#, so it never re-triggers this branch —
// no infinite loop. Affected commitIds are deduped per batch.
//
// Reads RAP_TABLE from env (set by SST). Reuses the dynamo repo so the query/put
// logic is the same code the app uses.
// ===========================================================================
import { dynamoRapRepo } from "../lib/rap/repo.dynamo";
import { computeRollup } from "../lib/rap/rollup";

interface StreamRecord {
  dynamodb?: { Keys?: { PK?: { S?: string }; SK?: { S?: string } } };
}

export async function handler(event: { Records?: StreamRecord[] }): Promise<void> {
  const affected = new Set<string>();
  for (const r of event.Records ?? []) {
    const pk = r.dynamodb?.Keys?.PK?.S;
    const sk = r.dynamodb?.Keys?.SK?.S;
    if (pk?.startsWith("COMMIT#") && sk?.startsWith("OBS#")) {
      affected.add(pk.slice("COMMIT#".length));
    }
  }

  for (const commitId of affected) {
    const observations = await dynamoRapRepo.listObservations(commitId);
    await dynamoRapRepo.putRollup(computeRollup(commitId, observations));
  }
}
