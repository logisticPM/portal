// Binary search-index artifacts (spec 2026-07-03). Two buffers: BM25 (inverted index +
// unit/case tables + profiles) and vectors (optional, loaded only when a query-time
// embedder is configured). Container: MAGIC u32len + JSON header + 8-byte-aligned
// sections at header-declared offsets. Sections are COPIED into fresh typed arrays on
// load (pooled Buffers from fs/S3 have arbitrary byteOffset → alignment-safe).
import { tokenize } from "./bm25";
import { buildInverted, scoreInverted, type InvertedIndex } from "./inverted";
import { dot, type Searcher, type RetrievalUnit } from "./hybrid";
import type { LegalCase } from "../types";

const MAGIC = 0x43494458; // "CIDX"
export const FORMAT_VERSION = 1;

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
    const unitIdx = new Uint32Array(withVec.length);
    const block = new Float32Array(withVec.length * input.vdim);
    withVec.forEach(({ u, i }, row) => { unitIdx[row] = i; block.set(u.vec!, row * input.vdim!); });
    vectors = pack(
      { magicName: "vectors", formatVersion: FORMAT_VERSION, buildId, embedderId: input.embedderId, vdim: input.vdim, count: withVec.length },
      [
        { name: "unitIdx", bytes: new Uint8Array(unitIdx.buffer) },
        { name: "vecs", bytes: new Uint8Array(block.buffer) },
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

export function loadArtifacts(bm25Buf: Buffer, vectorsBuf?: Buffer | null): LoadedArtifacts {
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
  let vecUnitIdx: Uint32Array | null = null;
  let vecBlock: Float32Array | null = null;
  let vdim: number | null = a.header.vdim ?? null;
  if (vectorsBuf) {
    const v = unpack(vectorsBuf);
    if (v.header.buildId === a.header.buildId) {
      vecUnitIdx = toU32(v.section("unitIdx"));
      vecBlock = toF32(v.section("vecs"));
      vdim = v.header.vdim ?? null;
    } else {
      console.warn(`[artifact] vectors buildId mismatch (${v.header.buildId} vs ${a.header.buildId}) → dense off`);
    }
  }

  const searcher: Searcher = {
    bm25Rank: (query) => scoreInverted(inv, tokenize(query)).map((r) => ({ id: r.id })),
    denseRank: (queryVec) => {
      if (!vecUnitIdx || !vecBlock || !vdim || queryVec.length !== vdim) return [];
      const out: { id: string; score: number }[] = [];
      for (let row = 0; row < vecUnitIdx.length; row++) {
        const vecView = vecBlock.subarray(row * vdim, (row + 1) * vdim);
        out.push({ id: ids[vecUnitIdx[row]], score: dot(queryVec, vecView) });
      }
      return out.sort((a2, b2) => b2.score - a2.score || a2.id.localeCompare(b2.id)).map((r) => ({ id: r.id }));
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
