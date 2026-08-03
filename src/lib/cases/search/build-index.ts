// Builds the in-memory retrieval index from ONE table scan and caches it at module
// scope — never scanned per query (spec §7). DynamoDB is the source of truth; call
// invalidateSearchIndex() after an embed pass (or process restart rebuilds it).
// Spec 2026-07-03 adds artifact sources (INDEX_FILE / INDEX_BUCKET): a prebuilt
// binary index loaded once per process instead of scanning ~43k items per cold
// start. Any artifact-load failure degrades to the scan path — never breaks search.
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { promises as fs } from "node:fs";
import { createWriteStream, readSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { casesDdbDoc as ddbDoc } from "../../dynamo/client";
import { itemToCase } from "../../dynamo/cases-table";
import { unpackF32 } from "./pack";
import { metaText, makeInMemorySearcher, type RetrievalUnit, type Searcher } from "./hybrid";
import { loadArtifacts, parseVectorsBuffer, readPreamble, readHeader, PREAMBLE_BYTES, BM25_KEY, VECTORS_KEY, type VectorsSource } from "./artifact";
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
  buildId: string | null;        // artifact build id; null on the scan path
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
      // Spec ("Vectors artifact"): vectors are loaded ONLY when a real query-time embedder is
      // configured; a BM25-only path must never pay for them. Shared predicate with getEmbedder.
      const wantVectors = isRealProvider();
      const bm25: Buffer = fileDir
        ? await fs.readFile(`${fileDir}/${BM25_KEY.split("/").pop()}`)
        : await getObjectBuffer(bucket, BM25_KEY);
      let vectors: VectorsSource | null = null;
      if (wantVectors) {
        try {
          vectors = fileDir
            ? parseVectorsBuffer(await fs.readFile(`${fileDir}/${VECTORS_KEY.split("/").pop()}`))
            : await streamVectorsToTmp(bucket, VECTORS_KEY);
        } catch (e) {
          console.warn(`[index] vectors unavailable (${(e as Error).message}) → BM25-only`);
        }
      }
      const loaded = loadArtifacts(bm25, vectors);
      cached = { units: [], cases: loaded.cases, embedderId: loaded.embedderId, vdim: loaded.vdim, searcher: loaded.searcher, source: "artifact", buildId: loaded.buildId };
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
  cached = { units, cases, embedderId, vdim, searcher: makeInMemorySearcher(units), source: "scan", buildId: null };
  return cached;
}

// Plain S3 GetObject → Buffer. Used for bm25.bin, which needs random access to all of it anyway.
async function getObjectBuffer(bucket: string, Key: string): Promise<Buffer> {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({});
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

// Stream the vectors object to /tmp, then make resident ONLY what the full scan needs. Lambda's
// /tmp is 512MB by default and does NOT count against MemorySize, so the ~278MB quantized object
// fits with no quota change while the heap holds just the 30.7MB binary block. This is the whole
// point of the change: Buffer.from(await transformToByteArray()) on the old 985MB float32 object
// peaked ~3.5GB and OOMed even at the account's 3008MB cap.
async function streamVectorsToTmp(bucket: string, Key: string): Promise<VectorsSource> {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({});
  const file = path.join(os.tmpdir(), `cases-vectors-${process.pid}.bin`);
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
  await pipeline(r.Body as NodeJS.ReadableStream, createWriteStream(file));
  const fh = await open(file, "r");
  const readAt = async (len: number, pos: number) => {
    const b = Buffer.allocUnsafe(len);
    await fh.read(b, 0, len, pos);
    return b;
  };
  const { headerLen, secStart } = readPreamble(await readAt(PREAMBLE_BYTES, 0));
  const { header, sections } = readHeader(await readAt(headerLen, PREAMBLE_BYTES));
  const at = (name: string) => {
    const s = sections[name];
    if (!s) throw new Error(`vectors artifact missing section ${name}`);
    return { pos: secStart + s[0], len: s[1] };
  };
  const vdim = Number(header.vdim);
  const binSec = at("bin"), idxSec = at("unitIdx"), i8Sec = at("int8");
  const bin = new Uint8Array(await readAt(binSec.len, binSec.pos));
  const idxBuf = await readAt(idxSec.len, idxSec.pos);
  // .slice() detaches from the pooled Buffer so the Uint32Array owns aligned memory.
  const unitIdx = new Uint32Array(idxBuf.buffer, idxBuf.byteOffset, idxBuf.byteLength / 4).slice();
  // Positional int8 reads: DENSE_RESCORE_N rows × vdim bytes per query (200KB at N=200), heap ≈ 0.
  const rowBuf = Buffer.allocUnsafe(vdim);
  const fd = fh.fd;
  const readRow = (row: number): Int8Array | null => {
    try {
      const n = readSync(fd, rowBuf, 0, vdim, i8Sec.pos + row * vdim);
      if (n !== vdim) return null;
      return new Int8Array(rowBuf.buffer, rowBuf.byteOffset, vdim);
    } catch { return null; }
  };
  process.once("exit", () => { void unlink(file).catch(() => {}); });
  console.log(`[index] vectors streamed to ${file} (bin ${(bin.length / 1e6).toFixed(1)}MB resident, int8 ${(i8Sec.len / 1e6).toFixed(1)}MB on disk)`);
  return { bin, unitIdx, vdim, count: Number(header.count), buildId: String(header.buildId), readInt8Row: readRow };
}
