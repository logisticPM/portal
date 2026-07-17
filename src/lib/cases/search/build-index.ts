// Builds the in-memory retrieval index from ONE table scan and caches it at module
// scope — never scanned per query (spec §7). DynamoDB is the source of truth; call
// invalidateSearchIndex() after an embed pass (or process restart rebuilds it).
// Spec 2026-07-03 adds artifact sources (INDEX_FILE / INDEX_BUCKET): a prebuilt
// binary index loaded once per process instead of scanning ~43k items per cold
// start. Any artifact-load failure degrades to the scan path — never breaks search.
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { promises as fs } from "node:fs";
import { casesDdbDoc as ddbDoc } from "../../dynamo/client";
import { itemToCase } from "../../dynamo/cases-table";
import { unpackF32 } from "./pack";
import { metaText, makeInMemorySearcher, type RetrievalUnit, type Searcher } from "./hybrid";
import { loadArtifacts, BM25_KEY, VECTORS_KEY } from "./artifact";
import { isRealProvider } from "./embedder";
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
  units: RetrievalUnit[];        // empty when artifact-backed (units are baked into searcher)
  cases: Map<string, LegalCase>; // PROFILE-derived (no chunks) — enough for list display
  embedderId: string | null;     // the embedder that wrote the stored vectors, if any
  vdim: number | null;           // dimension of the stored vectors (compatibility axis)
  searcher: Searcher;            // ALWAYS present: artifact-backed or built from units
  source: "artifact" | "scan";
}

let cached: SearchIndex | null = null;

export function invalidateSearchIndex(): void {
  cached = null;
}

export async function getSearchIndex(force = false): Promise<SearchIndex> {
  if (cached && !force) return cached;

  // Artifact sources (spec 2026-07-03): INDEX_FILE dir (local) or INDEX_BUCKET (S3).
  // Any failure falls through to the scan path — degradation, never breakage.
  const fileDir = (process.env.INDEX_FILE ?? "").trim();
  const bucket = (process.env.INDEX_BUCKET ?? "").trim();
  if (fileDir || bucket) {
    try {
      // Spec ("Vectors artifact"): vectors are loaded ONLY when a real query-time
      // embedder is configured (EMBED_PROVIDER set, not the stub) — the BM25-only
      // path must never pay the ~160MB download. Shared predicate with getEmbedder.
      const wantVectors = isRealProvider();
      let bm25: Buffer;
      let vectors: Buffer | null = null;
      if (fileDir) {
        bm25 = await fs.readFile(`${fileDir}/bm25.bin`);
        if (wantVectors) vectors = await fs.readFile(`${fileDir}/vectors.bin`).catch(() => null);
      } else {
        const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
        const s3 = new S3Client({});
        const get = async (Key: string) =>
          Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key }))).Body!.transformToByteArray());
        bm25 = await get(BM25_KEY);
        if (wantVectors) vectors = await get(VECTORS_KEY).catch(() => null);
      }
      const loaded = loadArtifacts(bm25, vectors);
      cached = { units: [], cases: loaded.cases, embedderId: loaded.embedderId, vdim: loaded.vdim, searcher: loaded.searcher, source: "artifact" };
      console.log(`[index] artifact loaded (buildId=${loaded.buildId}, cases=${loaded.cases.size})`);
      return cached;
    } catch (e) {
      console.warn(`[index] artifact load failed (${(e as Error).message}) (source=${fileDir || bucket}) → falling back to table scan`);
    }
  }

  const profiles: { id: string; meta: string }[] = [];
  const cases = new Map<string, LegalCase>();
  const chunks: { caseId: string; idx: number; text: string; vec?: Float32Array }[] = [];
  let embedderId: string | null = null;
  let vdim: number | null = null;

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
          vdim = it.vdim;
          vec = unpackF32(it.vec, it.vdim);
        }
        chunks.push({ caseId, idx, text: it.text, vec });
      }
    }
    start = r.LastEvaluatedKey;
  } while (start);

  const units = assembleUnits(profiles, chunks);
  cached = { units, cases, embedderId, vdim, searcher: makeInMemorySearcher(units), source: "scan" };
  return cached;
}
