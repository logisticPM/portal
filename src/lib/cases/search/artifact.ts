// Binary search-index artifacts (spec 2026-07-03). Two buffers: BM25 (inverted index +
// unit/case tables + profiles) and vectors (optional, loaded only when a query-time
// embedder is configured). Container: MAGIC u32len + JSON header + 8-byte-aligned
// sections at header-declared offsets. Sections are COPIED into fresh typed arrays on
// load (pooled Buffers from fs/S3 have arbitrary byteOffset → alignment-safe).
import { tokenize } from "./bm25";
import { buildInverted, scoreInverted, type InvertedIndex } from "./inverted";
import { dot, type Searcher, type RetrievalUnit } from "./hybrid";
import { toBinary, toInt8, hamming, dotInt8, BITS_PER_BYTE } from "./quantize";
import type { LegalCase } from "../types";

const MAGIC = 0x43494458; // "CIDX"
export const FORMAT_VERSION = 1;
// The vectors object is versioned SEPARATELY so a vectors-format change never moves bm25.bin's
// key. If both moved, a code deploy that precedes the artifact rebuild would fail the bm25 load
// and fall back to the 42.8s table scan; with only the vectors key moving, a missing v2 object
// degrades to BM25-only — the same safe path as having no embedder configured.
export const VECTORS_FORMAT_VERSION = 2;
export const BM25_KEY = `cases-index/v${FORMAT_VERSION}/bm25.bin`;
export const VECTORS_KEY = `cases-index/v${VECTORS_FORMAT_VERSION}/vectors.bin`;

interface SectionMap { [name: string]: [offset: number, length: number] }

// Container layout: 12-byte preamble (MAGIC u32, headerLen u32, secStart u32) +
// JSON header (RELATIVE section offsets — written once, no rewrite) + 8-aligned
// sections. secStart lives in the fixed preamble so header length never depends on
// the offsets' digit count (a self-referential trap otherwise).
function pack(headerObj: Record<string, unknown>, sections: { name: string; bytes: Uint8Array }[]): Buffer {
  const secMap: SectionMap = {};
  let cursor = 0; // relative to secStart
  const paddedLens = sections.map((s) => Math.ceil(s.bytes.length / 8) * 8);
  sections.forEach((s, i) => { secMap[s.name] = [cursor, s.bytes.length]; cursor += paddedLens[i]; });
  const header = Buffer.from(JSON.stringify({ ...headerObj, sections: secMap }), "utf8");
  const PRE = 12; // MAGIC + headerLen + secStart
  const secStart = Math.ceil((PRE + header.length) / 8) * 8;
  const out = Buffer.alloc(secStart + cursor);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(header.length, 4);
  out.writeUInt32LE(secStart, 8);
  header.copy(out, PRE);
  let off = secStart;
  sections.forEach((s, i) => { out.set(s.bytes, off); off += paddedLens[i]; });
  return out;
}

// Minimal typed view of the JSON header (private to the module). bm25 and vectors
// objects share the container fields; object-specific fields are optional.
interface ArtifactHeader {
  formatVersion: number;
  buildId: string;
  sections: SectionMap;
  magicName?: string;
  n?: number;
  avgdl?: number;
  embedderId?: string | null;
  vdim?: number | null;
  count?: number;
  builtAt?: string;
  counts?: Record<string, number>;
}

function unpack(buf: Buffer): { header: ArtifactHeader; section: (name: string) => Uint8Array } {
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error("bad artifact magic");
  const hlen = buf.readUInt32LE(4);
  const secStart = buf.readUInt32LE(8);
  const header: ArtifactHeader = JSON.parse(buf.subarray(12, 12 + hlen).toString("utf8"));
  // Runtime insurance beyond the key path's own version segment: never deserialize a future
  // format. This reader is shared by both object kinds, and bm25/vectors are versioned
  // SEPARATELY (see VECTORS_FORMAT_VERSION above), so both stamps are valid here.
  if (header.formatVersion !== FORMAT_VERSION && header.formatVersion !== VECTORS_FORMAT_VERSION)
    throw new Error(`unsupported artifact formatVersion ${header.formatVersion} (expected ${FORMAT_VERSION} or ${VECTORS_FORMAT_VERSION})`);
  return {
    header,
    section: (name) => {
      const s = header.sections[name];
      if (!s) throw new Error(`missing section ${name}`);
      const abs = secStart + s[0];
      // Reject short buffers: subarray silently clamps, which would leave the copy
      // zero-filled past the truncation point (garbage data, no error).
      if (abs + s[1] > buf.length) throw new Error(`truncated artifact: section '${name}' extends past buffer end`);
      const copy = new Uint8Array(s[1]);
      copy.set(buf.subarray(abs, abs + s[1]));
      return copy;
    },
  };
}

// A non-4-multiple byteLength means the artifact is corrupt — throw rather than
// silently truncating the view length (byteLength / 4 would floor).
const assertAligned4 = (b: Uint8Array) => {
  if (b.byteLength % 4 !== 0) throw new Error("corrupt artifact: section byteLength not 4-aligned");
};
const toU32 = (b: Uint8Array) => { assertAligned4(b); return new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const toF32 = (b: Uint8Array) => { assertAligned4(b); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const json = (o: unknown) => new Uint8Array(Buffer.from(JSON.stringify(o), "utf8"));
const unjson = (b: Uint8Array) => JSON.parse(Buffer.from(b).toString("utf8"));

// How the loader reaches the quantized vectors. `bin` is resident (30.7MB at 240k×1024d);
// `readInt8Row` is a positional accessor so the 246MB int8 tier never enters the heap — the S3
// object is streamed to /tmp and rows are read on demand. A null accessor means binary-only
// ranking (degraded but functional), which is what happens if /tmp is unavailable.
export interface VectorsSource {
  bin: Uint8Array;
  unitIdx: Uint32Array;
  vdim: number;
  count: number;
  buildId: string;
  readInt8Row: ((row: number) => Int8Array | null) | null;
}

// Preamble/header readers, exported so build-index can locate sections in a /tmp file without
// re-implementing the container format (12-byte preamble: MAGIC u32, headerLen u32, secStart u32).
export const PREAMBLE_BYTES = 12;
export function readPreamble(buf: Buffer): { headerLen: number; secStart: number } {
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error("corrupt artifact: bad magic");
  return { headerLen: buf.readUInt32LE(4), secStart: buf.readUInt32LE(8) };
}
export function readHeader(headerBytes: Buffer): { header: Record<string, any>; sections: SectionMap } {
  const header = JSON.parse(headerBytes.toString("utf8")) as Record<string, any>;
  return { header, sections: header.sections as SectionMap };
}

// Build a fully in-memory VectorsSource from a vectors container Buffer. Used by tests and by the
// local INDEX_FILE path; the S3 path streams to /tmp instead (see build-index.ts).
export function parseVectorsBuffer(buf: Buffer): VectorsSource {
  const v = unpack(buf);
  const vdim = Number(v.header.vdim);
  const bin = v.section("bin");
  const i8sec = v.section("int8");
  const int8 = new Int8Array(i8sec.buffer as ArrayBuffer, i8sec.byteOffset, i8sec.byteLength);
  return {
    bin, unitIdx: toU32(v.section("unitIdx")), vdim,
    count: Number(v.header.count), buildId: String(v.header.buildId),
    readInt8Row: (row) => int8.subarray(row * vdim, (row + 1) * vdim),
  };
}

export interface ArtifactInput {
  units: RetrievalUnit[];
  cases: Map<string, LegalCase>;
  embedderId: string | null;
  vdim: number | null;
}

export function buildArtifacts(input: ArtifactInput): { bm25: Buffer; vectors: Buffer | null; buildId: string } {
  const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const inv = buildInverted(input.units.map((u) => ({ id: u.unitId, tokens: tokenize(u.text) })));

  // unit → case as indices into a caseId table
  const caseIds = [...input.cases.keys()];
  const caseIdx = new Map(caseIds.map((id, i) => [id, i]));
  const unitCase = new Uint32Array(input.units.length);
  input.units.forEach((u, i) => { unitCase[i] = caseIdx.get(u.caseId) ?? 0xffffffff; });

  // vocab: terms as JSON array aligned with meta pairs (start, df)
  const terms = [...inv.terms.keys()];
  const vocabMeta = new Uint32Array(terms.length * 2);
  terms.forEach((t, i) => { const m = inv.terms.get(t)!; vocabMeta[i * 2] = m.start; vocabMeta[i * 2 + 1] = m.df; });

  const bm25 = pack(
    { magicName: "bm25", formatVersion: FORMAT_VERSION, buildId, builtAt: new Date().toISOString(),
      counts: { units: input.units.length, cases: input.cases.size },
      embedderId: input.embedderId, vdim: input.vdim, n: inv.n, avgdl: inv.avgdl },
    [
      { name: "unitIds", bytes: json(inv.ids) },
      { name: "caseIds", bytes: json(caseIds) },
      { name: "unitCase", bytes: new Uint8Array(unitCase.buffer) },
      { name: "docLen", bytes: new Uint8Array(inv.docLen.buffer) },
      { name: "terms", bytes: json(terms) },
      { name: "vocabMeta", bytes: new Uint8Array(vocabMeta.buffer) },
      { name: "postings", bytes: new Uint8Array(inv.postings.buffer, inv.postings.byteOffset, inv.postings.byteLength) },
      { name: "profiles", bytes: json([...input.cases.values()]) },
    ],
  );

  let vectors: Buffer | null = null;
  const withVec = input.units.map((u, i) => ({ u, i })).filter(({ u }) => u.vec && input.vdim && u.vec.length === input.vdim);
  if (withVec.length && input.embedderId && input.vdim) {
    const vdim = input.vdim;
    const binBytes = Math.ceil(vdim / BITS_PER_BYTE);
    const unitIdx = new Uint32Array(withVec.length);
    const bin = new Uint8Array(withVec.length * binBytes);
    const int8 = new Int8Array(withVec.length * vdim);
    withVec.forEach(({ u, i }, row) => {
      unitIdx[row] = i;
      bin.set(toBinary(u.vec!), row * binBytes);
      int8.set(toInt8(u.vec!), row * vdim);
    });
    vectors = pack(
      { magicName: "vectors", formatVersion: VECTORS_FORMAT_VERSION, quant: "binary+int8", buildId,
        embedderId: input.embedderId, vdim, count: withVec.length },
      [
        { name: "unitIdx", bytes: new Uint8Array(unitIdx.buffer) },
        { name: "bin", bytes: bin },
        { name: "int8", bytes: new Uint8Array(int8.buffer) },
      ],
    );
  }
  return { bm25, vectors, buildId };
}

export interface LoadedArtifacts {
  searcher: Searcher;
  cases: Map<string, LegalCase>;
  embedderId: string | null;
  vdim: number | null;
  buildId: string;
}

export function loadArtifacts(bm25Buf: Buffer, vectors?: VectorsSource | null): LoadedArtifacts {
  const a = unpack(bm25Buf);
  const ids: string[] = unjson(a.section("unitIds"));
  const caseIds: string[] = unjson(a.section("caseIds"));
  const unitCase = toU32(a.section("unitCase"));
  const inv: InvertedIndex = {
    ids, n: a.header.n!, avgdl: a.header.avgdl!, // always written by the bm25 packer
    docLen: toU32(a.section("docLen")),
    terms: new Map(), postings: toU32(a.section("postings")),
  };
  const terms: string[] = unjson(a.section("terms"));
  const vocabMeta = toU32(a.section("vocabMeta"));
  terms.forEach((t, i) => inv.terms.set(t, { start: vocabMeta[i * 2], df: vocabMeta[i * 2 + 1] }));
  const profiles: LegalCase[] = unjson(a.section("profiles"));
  const cases = new Map(profiles.map((c) => [c.id, c]));
  const unitIdToIdx = new Map(ids.map((id, i) => [id, i]));

  // vectors (optional; buildId must match or dense is skipped — integrity guard)
  let vsrc: VectorsSource | null = null;
  let vdim: number | null = a.header.vdim ?? null;
  if (vectors) {
    if (vectors.buildId === a.header.buildId) { vsrc = vectors; vdim = vectors.vdim; }
    else console.warn(`[artifact] vectors buildId mismatch (${vectors.buildId} vs ${a.header.buildId}) → dense off`);
  }
  const RESCORE_N = Number(process.env.DENSE_RESCORE_N ?? 200);

  const searcher: Searcher = {
    bm25Rank: (query) => scoreInverted(inv, tokenize(query)).map((r) => ({ id: r.id })),
    // Two stages, and the CONTRACT IS PRESERVED: a full sorted list of every vector's unit id, so
    // hybridRank's RRF fusion shape is unchanged. Stage 1 is an exhaustive Hamming scan (exact by
    // construction — no ANN approximation error at this corpus size). Stage 2 rescores only the
    // head with int8, read positionally, and splices it back; the tail keeps binary order, which
    // is immaterial to RRF (rank 200 contributes 1/(60+200)≈0.004 vs 1/(60+1)≈0.016 at the head).
    // Measured on clustered synthetic data: binary top-200 coverage of the true top-10 = 1.0000,
    // and the pipeline scores exactly the same Recall@10 as int8-over-everything — candidate
    // generation is lossless and accuracy is set entirely by int8.
    denseRank: (queryVec) => {
      if (!vsrc || !vdim || queryVec.length !== vdim) return [];
      const src = vsrc, d = vdim;
      const binBytes = Math.ceil(d / BITS_PER_BYTE);
      const qb = toBinary(queryVec);
      const idOf = (row: number) => ids[src.unitIdx[row]];
      const byHam: { row: number; dist: number }[] = new Array(src.count);
      for (let row = 0; row < src.count; row++) {
        byHam[row] = { row, dist: hamming(qb, 0, src.bin, row * binBytes, binBytes) };
      }
      byHam.sort((x, y) => x.dist - y.dist || idOf(x.row).localeCompare(idOf(y.row)));
      const headN = Math.min(RESCORE_N, byHam.length);
      if (src.readInt8Row && headN > 0) {
        const qi = toInt8(queryVec);
        const head: { row: number; s: number }[] = [];
        for (let k = 0; k < headN; k++) {
          const row = byHam[k].row;
          const r = src.readInt8Row(row);
          // A failed positional read keeps this row's binary standing rather than throwing.
          head.push({ row, s: r ? dotInt8(qi, r, 0, d) : -Infinity });
        }
        head.sort((x, y) => y.s - x.s || idOf(x.row).localeCompare(idOf(y.row)));
        return [...head.map((h) => ({ id: idOf(h.row) })), ...byHam.slice(headN).map((h) => ({ id: idOf(h.row) }))];
      }
      console.warn("[artifact] int8 tier unavailable → binary-only dense ranking");
      return byHam.map((h) => ({ id: idOf(h.row) }));
    },
    caseOf: (unitId) => {
      const i = unitIdToIdx.get(unitId);
      if (i === undefined) return undefined;
      const ci = unitCase[i];
      return ci === 0xffffffff ? undefined : caseIds[ci];
    },
  };

  return { searcher, cases, embedderId: a.header.embedderId ?? null, vdim, buildId: a.header.buildId };
}
