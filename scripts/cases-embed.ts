// Idempotent, resumable embed pass: for every CHUNK item whose vector is missing or
// was written by a different embedder, embed its text and write back vec/embedderId/
// vdim. Stub runs fully offline; a real provider needs a key (see search/embedder.ts).
// Run AFTER cases:fetch-fulltext — re-chunking replaces CHUNK items and drops vectors.
import "./fetch-polyfill"; // harmless for stub; real providers may use fetch
import { ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { getEmbedder } from "../src/lib/cases/search/embedder";
import { packF32 } from "../src/lib/cases/search/pack";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

// PURE decision: does this CHUNK item need (re)embedding under the active embedder?
export function needsEmbed(item: { vec?: unknown; embedderId?: string; [k: string]: unknown }, activeId: string): boolean {
  return !item.vec || item.embedderId !== activeId;
}

async function embedPass() {
  const embedder = getEmbedder();
  console.log(`embedder = ${embedder.id} (dim ${embedder.dim})`);

  let embedded = 0, skipped = 0, total = 0;
  let pending: Record<string, any>[] = [];

  const flush = async () => {
    for (let i = 0; i < pending.length; i += 25)
      await ddbDoc.send(new BatchWriteCommand({
        RequestItems: { [TABLE]: pending.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) },
      }));
    pending = [];
  };

  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    const chunkItems = (r.Items ?? []).filter((it) => it.et === "CaseChunk");
    total += chunkItems.length;

    const todo = chunkItems.filter((it) => needsEmbed(it, embedder.id));
    skipped += chunkItems.length - todo.length;

    if (todo.length) {
      const vecs = await embedder.embed(todo.map((it) => String(it.text ?? "")));
      todo.forEach((it, i) => {
        pending.push({ ...it, vec: packF32(vecs[i]), embedderId: embedder.id, vdim: embedder.dim });
      });
      embedded += todo.length;
      if (pending.length >= 100) await flush();
    }
    start = r.LastEvaluatedKey;
  } while (start);

  await flush();
  console.log(`✅ embedded ${embedded} · skipped-current ${skipped} · total chunks ${total}`);
}

if (require.main === module)
  embedPass().catch((e) => { console.error("❌ cases-embed failed:", e); process.exit(1); });
