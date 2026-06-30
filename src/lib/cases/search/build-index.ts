// Builds the in-memory retrieval index from ONE table scan and caches it at module
// scope — never scanned per query (spec §7). DynamoDB is the source of truth; call
// invalidateSearchIndex() after an embed pass (or process restart rebuilds it).
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../../dynamo/client";
import { itemToCase } from "../../dynamo/cases-table";
import { unpackF32 } from "./pack";
import { metaText, type RetrievalUnit } from "./hybrid";
import type { LegalCase } from "../types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

// PURE: assemble retrieval units. Meta unit = BM25-only lexical doc; chunk units
// carry the body text + (optionally) a stored vector.
export function assembleUnits(
  profiles: { id: string; meta: string }[],
  chunks: { caseId: string; idx: number; text: string; vec?: Float32Array }[],
): RetrievalUnit[] {
  const units: RetrievalUnit[] = [];
  for (const p of profiles) units.push({ unitId: `${p.id}#meta`, caseId: p.id, text: p.meta });
  for (const c of chunks)
    units.push({ unitId: `${c.caseId}#chunk#${c.idx}`, caseId: c.caseId, text: c.text, vec: c.vec });
  return units;
}

export interface SearchIndex {
  units: RetrievalUnit[];
  cases: Map<string, LegalCase>; // PROFILE-derived (no chunks) — enough for list display
  embedderId: string | null;     // the embedder that wrote the stored vectors, if any
}

let cached: SearchIndex | null = null;

export function invalidateSearchIndex(): void {
  cached = null;
}

export async function getSearchIndex(force = false): Promise<SearchIndex> {
  if (cached && !force) return cached;

  const profiles: { id: string; meta: string }[] = [];
  const cases = new Map<string, LegalCase>();
  const chunks: { caseId: string; idx: number; text: string; vec?: Float32Array }[] = [];
  let embedderId: string | null = null;

  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    for (const it of r.Items ?? []) {
      if (it.et === "Case") {
        const c = itemToCase(it);
        cases.set(c.id, c);
        profiles.push({ id: c.id, meta: metaText(c) });
      } else if (it.et === "CaseChunk") {
        const caseId = String(it.PK).replace(/^CASE#/, "");
        const idx = Number(String(it.SK).replace(/^CHUNK#/, ""));
        let vec: Float32Array | undefined;
        if (it.vec && typeof it.vdim === "number" && it.embedderId) {
          embedderId = it.embedderId;
          vec = unpackF32(it.vec, it.vdim);
        }
        chunks.push({ caseId, idx, text: it.text, vec });
      }
    }
    start = r.LastEvaluatedKey;
  } while (start);

  cached = { units: assembleUnits(profiles, chunks), cases, embedderId };
  return cached;
}
