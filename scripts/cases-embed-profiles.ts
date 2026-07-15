// Idempotent, additive profile-embedding pass (spec 2026-07-14): for every CORE profile
// whose pvec is missing or was written by a different embedder, embed assembleProfileText
// and write pvec/pvecEmbedderId/pvecDim on the PROFILE item. Never touches CHUNK vectors.
import "./fetch-polyfill";
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { getEmbedder } from "../src/lib/cases/search/embedder";
import { packF32 } from "../src/lib/cases/search/pack";
import { itemToCase } from "../src/lib/dynamo/cases-table";
import { assembleProfileText } from "../src/lib/cases/similarity";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

export function needsProfileEmbed(item: { pvec?: unknown; pvecEmbedderId?: string }, activeId: string): boolean {
  return !item.pvec || item.pvecEmbedderId !== activeId;
}

async function run() {
  const embedder = getEmbedder();
  console.log(`embedder = ${embedder.id} (dim ${embedder.dim})`);
  let embedded = 0, skipped = 0, total = 0;
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, IndexName: "GSI1", ExclusiveStartKey: start }));
    const profiles = (r.Items ?? []).filter((it) => it.et === "Case" && itemToCase(it).corpusTier === "core");
    total += profiles.length;
    const todo = profiles.filter((it) => needsProfileEmbed(it as any, embedder.id));
    skipped += profiles.length - todo.length;
    if (todo.length) {
      const vecs = await embedder.embed(todo.map((it) => assembleProfileText(itemToCase(it))));
      for (let i = 0; i < todo.length; i++) {
        const it = todo[i];
        await ddbDoc.send(new UpdateCommand({
          TableName: TABLE, Key: { PK: it.PK, SK: it.SK },
          UpdateExpression: "SET pvec = :v, pvecEmbedderId = :e, pvecDim = :d",
          ExpressionAttributeValues: { ":v": packF32(vecs[i]), ":e": embedder.id, ":d": embedder.dim },
        }));
      }
      embedded += todo.length;
    }
    start = r.LastEvaluatedKey;
  } while (start);
  console.log(`✅ profile-embedded ${embedded} · skipped-current ${skipped} · total core ${total}`);
}

if (require.main === module) run().catch((e) => { console.error("❌ cases-embed-profiles failed:", e); process.exit(1); });
