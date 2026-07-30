# Vector Quantization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the 985 MB dense-vector artifact to ~278 MB (binary 30.7 MB resident + int8 246 MB read positionally from `/tmp`) so it loads in any Lambda, restoring dense retrieval.

**Architecture:** A pure `quantize.ts` converts L2-normalized float32 vectors to 1-bit and 8-bit forms. The vectors artifact gains its own format version and stores `bin` + `int8` sections instead of float32. `denseRank` becomes two-stage: an exhaustive Hamming scan produces the full ranking (contract unchanged), then the top-N rows are rescored with int8 read positionally from a `/tmp` file that S3 streams into. An offline leave-one-out script measures fidelity against exact float32 and gates the prod flip.

**Tech Stack:** TypeScript, `tsx` tests (async-IIFE + `node:assert/strict`), `@aws-sdk/client-s3` streaming, `node:fs` positional reads.

**Spec:** `docs/superpowers/specs/2026-07-30-vector-quantization-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/search/quantize.ts` | **New, pure.** `toBinary`, `toInt8`, `hamming`, `dotInt8`. No I/O. |
| `scripts/test-cases-quantize.ts` | **New.** Unit tests for the pure module + synthetic ranking-agreement. |
| `src/lib/cases/search/artifact.ts` | `VECTORS_FORMAT_VERSION`; write `bin`/`int8` sections; `VectorsSource` seam; container-parsing exports; two-stage `denseRank`. |
| `src/lib/cases/search/build-index.ts` | Stream the vectors object to `/tmp`; build a `VectorsSource` with positional int8 reads. |
| `scripts/cases-index-build.ts` | Report new section sizes. |
| `scripts/cases-quant-eval.ts` | **New.** Leave-one-out fidelity measurement + the Recall@10 ≥ 0.95 gate. |
| `package.json` | `cases:quant-eval[:cloud]`. |

Existing facts the implementer must not break: `pack()` lays sections at 8-byte-aligned offsets recorded as **relative** offsets in a JSON header, after a **12-byte preamble** (`MAGIC u32`, `headerLen u32`, `secStart u32`). `unpack().section(name)` returns a **copied** `Uint8Array`. `denseRank(queryVec)` must keep returning a **full sorted list of every vector's unit id** — `hybridRank` fuses it with BM25 via RRF.

---

## Task 1: `quantize.ts` pure module + unit tests

**Files:**
- Create: `src/lib/cases/search/quantize.ts`
- Create: `scripts/test-cases-quantize.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-quantize.ts`:
```ts
// quantize.ts unit tests. Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { toBinary, toInt8, hamming, dotInt8, BITS_PER_BYTE } from "../src/lib/cases/search/quantize";
import { dot } from "../src/lib/cases/search/hybrid";

const unit = (dim: number, rnd: () => number) => {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rnd() * 2 - 1;
  let n = 0; for (let i = 0; i < dim; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1; for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
};
// Deterministic PRNG so the test never flakes.
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

(async () => {
  assert.equal(BITS_PER_BYTE, 8);

  // --- toBinary: MSB-first bit order ---
  const v8 = Float32Array.from([1, -1, 1, -1, 1, -1, 1, -1]);
  assert.deepEqual([...toBinary(v8)], [0b10101010], "MSB-first packing");
  assert.equal(toBinary(new Float32Array(1024)).length, 128, "1024 dims → 128 bytes");
  assert.equal(toBinary(new Float32Array(12)).length, 2, "non-multiple dim rounds up");
  assert.deepEqual([...toBinary(Float32Array.from([1, 1, 1, 1, 1, 1, 1, 1]))], [0xff], "all positive → all ones");
  assert.deepEqual([...toBinary(Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0]))], [0x00], "exactly 0 is not positive");

  // --- toInt8 ---
  assert.deepEqual([...toInt8(Float32Array.from([1, -1, 0]))], [127, -127, 0]);
  assert.deepEqual([...toInt8(Float32Array.from([2, -2]))], [127, -127], "clamped beyond ±1");

  // --- hamming ---
  const a = Uint8Array.from([0b00000000, 0b11111111]);
  const b = Uint8Array.from([0b00000001, 0b11111111]);
  assert.equal(hamming(a, 0, a, 0, 2), 0, "identical → 0");
  assert.equal(hamming(a, 0, b, 0, 2), 1, "one flipped bit → 1");
  const rows = Uint8Array.from([0x00, 0x00, 0xff, 0xff]); // row0 = 00 00, row1 = ff ff
  assert.equal(hamming(rows, 0, rows, 2, 2), 16, "row offsets addressed correctly");

  // --- dotInt8 is monotone in the true cosine (the ranking property) ---
  const q = unit(256, rnd);
  const qi = toInt8(q);
  const cands = Array.from({ length: 60 }, () => unit(256, rnd));
  const block = new Int8Array(cands.length * 256);
  cands.forEach((c, i) => block.set(toInt8(c), i * 256));
  const exactOrder = cands.map((c, i) => ({ i, s: dot(q, c) })).sort((x, y) => y.s - x.s).map((r) => r.i);
  const int8Order = cands.map((_, i) => ({ i, s: dotInt8(qi, block, i * 256, 256) })).sort((x, y) => y.s - x.s).map((r) => r.i);
  const top10Overlap = int8Order.slice(0, 10).filter((i) => exactOrder.slice(0, 10).includes(i)).length;
  assert.ok(top10Overlap >= 9, `int8 preserves the head (got ${top10Overlap}/10)`);

  // --- end-to-end: binary candidate generation + int8 rescore vs exact float32 ---
  const DIM = 1024, N = 2000, Q = 50, RESCORE = 200;
  const corpus = Array.from({ length: N }, () => unit(DIM, rnd));
  const binBlock = new Uint8Array(N * (DIM / 8));
  const i8Block = new Int8Array(N * DIM);
  corpus.forEach((c, i) => { binBlock.set(toBinary(c), i * (DIM / 8)); i8Block.set(toInt8(c), i * DIM); });

  let hits = 0, total = 0;
  for (let t = 0; t < Q; t++) {
    const query = unit(DIM, rnd);
    const exact = corpus.map((c, i) => ({ i, s: dot(query, c) })).sort((x, y) => y.s - x.s).slice(0, 10).map((r) => r.i);
    const qb = toBinary(query), qi2 = toInt8(query);
    const byHam = Array.from({ length: N }, (_, i) => ({ i, d: hamming(qb, 0, binBlock, i * (DIM / 8), DIM / 8) }))
      .sort((x, y) => x.d - y.d).slice(0, RESCORE);
    const rescored = byHam.map(({ i }) => ({ i, s: dotInt8(qi2, i8Block, i * DIM, DIM) }))
      .sort((x, y) => y.s - x.s).slice(0, 10).map((r) => r.i);
    hits += exact.filter((i) => rescored.includes(i)).length;
    total += exact.length;
  }
  const recall10 = hits / total;
  console.log(`   synthetic Recall@10 (binary+int8 rescore vs exact float32) = ${recall10.toFixed(4)}`);
  assert.ok(recall10 >= 0.95, `Recall@10 must be ≥ 0.95, got ${recall10.toFixed(4)}`);

  console.log("✅ test-cases-quantize passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-quantize.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/search/quantize'`.

- [ ] **Step 3: Implement `quantize.ts`**

Create `src/lib/cases/search/quantize.ts`:
```ts
// Quantized representations of the corpus vectors (spec 2026-07-30). The float32 artifact is
// 983MB at 240k×1024d and its load peaks ~3.5GB (three concurrent copies), which OOMs even at the
// account's 3008MB Lambda cap. Binary is 1 bit/dim (30.7MB) for candidate generation; int8 is
// 1 byte/dim (246MB) to rescore the head. DynamoDB keeps the float32 vectors, so nothing is lost.
//
// Both forms assume L2-NORMALIZED input (the embedder is called with normalize:true). That is what
// makes dot == cosine, the sign bit meaningful, and a single global int8 scale correct — every
// component of a unit vector is in [-1, 1], so no per-vector scale table is needed.
export const BITS_PER_BYTE = 8;
const INT8_SCALE = 127;

// Sign-threshold to 1 bit/dim, MSB-first within each byte. Exactly 0 is NOT set (v > 0), which
// matches the "positive" reading and keeps an all-zero vector all-zero.
export function toBinary(v: Float32Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(v.length / BITS_PER_BYTE));
  for (let i = 0; i < v.length; i++) {
    if (v[i] > 0) out[i >> 3] |= 0x80 >> (i & 7);
  }
  return out;
}

// Scalar-quantize to 1 byte/dim with a global scale. Clamped so an out-of-range component (a
// non-normalized vector slipping through) cannot wrap around into the wrong sign.
export function toInt8(v: Float32Array): Int8Array {
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const q = Math.round(v[i] * INT8_SCALE);
    out[i] = q > INT8_SCALE ? INT8_SCALE : q < -INT8_SCALE ? -INT8_SCALE : q;
  }
  return out;
}

// popcount lookup — a table beats bit-twiddling here because this runs 240k times per query.
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

// Hamming distance between two packed-bit rows. Offsets are BYTE offsets into each array, so one
// contiguous block can hold every row.
export function hamming(a: Uint8Array, aOff: number, b: Uint8Array, bOff: number, bytes: number): number {
  let d = 0;
  for (let i = 0; i < bytes; i++) d += POPCOUNT[a[aOff + i] ^ b[bOff + i]];
  return d;
}

// Unnormalized int8 dot product. The 1/127² factor is constant across candidates, so this is a
// valid RANKING score and no dequantization is needed.
export function dotInt8(q: Int8Array, block: Int8Array, off: number, dim: number): number {
  let s = 0;
  for (let i = 0; i < dim; i++) s += q[i] * block[off + i];
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-quantize.ts`
Expected: `✅ test-cases-quantize passed`, with the synthetic Recall@10 line printing ≥ 0.95.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/search/quantize.ts scripts/test-cases-quantize.ts
git commit -m "feat(search): quantize.ts — binary + int8 vector quantization"
```

---

## Task 2: Artifact format v2 — write quantized sections, two-stage `denseRank`

**Files:**
- Modify: `src/lib/cases/search/artifact.ts`
- Modify: `scripts/test-cases-quantize.ts` (append a round-trip test)

- [ ] **Step 1: Append the failing round-trip test**

In `scripts/test-cases-quantize.ts`, add these imports at the top (keep the existing ones):
```ts
import { buildArtifacts, loadArtifacts, parseVectorsBuffer, VECTORS_KEY, VECTORS_FORMAT_VERSION } from "../src/lib/cases/search/artifact";
import type { RetrievalUnit } from "../src/lib/cases/search/hybrid";
import type { LegalCase } from "../src/lib/cases/types";
```
Then insert this block immediately BEFORE the final `console.log("✅ test-cases-quantize passed");`:
```ts
  // --- artifact round-trip: quantized sections + full-list denseRank contract ---
  assert.equal(VECTORS_FORMAT_VERSION, 2);
  assert.ok(VECTORS_KEY.includes("/v2/"), "vectors key carries its own version");

  const DIM2 = 64, N2 = 40;
  const rvecs = Array.from({ length: N2 }, () => unit(DIM2, rnd));
  const units: RetrievalUnit[] = rvecs.map((v, i) => ({
    unitId: `u-${i}`, caseId: `c-${i % 4}`, text: `unit ${i} aboriginal title treaty`, vec: v,
  }));
  const caseMap = new Map<string, LegalCase>(
    [0, 1, 2, 3].map((i) => [`c-${i}`, { id: `c-${i}`, citation: `2020 SCC ${i}` } as unknown as LegalCase]),
  );
  const built = buildArtifacts({ units, cases: caseMap, embedderId: "test:e", vdim: DIM2 });
  assert.ok(built.vectors, "vectors artifact written");

  const vsrc = parseVectorsBuffer(built.vectors!);
  assert.equal(vsrc.vdim, DIM2);
  assert.equal(vsrc.count, N2);
  assert.equal(vsrc.bin.length, N2 * (DIM2 / 8), "binary block is count × dim/8 bytes");
  assert.ok(vsrc.readInt8Row, "int8 accessor present for an in-memory source");

  const loaded = loadArtifacts(built.bm25, vsrc);
  const qv = rvecs[7];
  const ranked = loaded.searcher.denseRank(qv);
  assert.equal(ranked.length, N2, "denseRank returns the FULL list (RRF fusion contract)");
  assert.equal(ranked[0].id, "u-7", "a vector queried by itself ranks first");
  const exactTop5 = rvecs.map((v, i) => ({ i, s: dot(qv, v) })).sort((x, y) => y.s - x.s).slice(0, 5).map((r) => `u-${r.i}`);
  const gotTop5 = ranked.slice(0, 5).map((r) => r.id);
  assert.ok(exactTop5.filter((id) => gotTop5.includes(id)).length >= 4, `head matches exact float32 (${gotTop5} vs ${exactTop5})`);
  assert.equal(loaded.searcher.caseOf("u-7"), "c-3", "caseOf still resolves");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-cases-quantize.ts`
Expected: FAIL — `parseVectorsBuffer` / `VECTORS_FORMAT_VERSION` are not exported from `artifact.ts`.

- [ ] **Step 3: Add the version split and the `VectorsSource` seam to `artifact.ts`**

In `src/lib/cases/search/artifact.ts`, replace the two key/version lines:
```ts
export const FORMAT_VERSION = 1;
```
…and the `VECTORS_KEY` line, so the block reads:
```ts
export const FORMAT_VERSION = 1;
// The vectors object is versioned SEPARATELY so a vectors-format change never moves bm25.bin's
// key. If both moved, a code deploy that precedes the artifact rebuild would fail the bm25 load
// and fall back to the 42.8s table scan; with only the vectors key moving, a missing v2 object
// degrades to BM25-only — the same safe path as having no embedder configured.
export const VECTORS_FORMAT_VERSION = 2;
export const BM25_KEY = `cases-index/v${FORMAT_VERSION}/bm25.bin`;
export const VECTORS_KEY = `cases-index/v${VECTORS_FORMAT_VERSION}/vectors.bin`;
```
(Delete the old `VECTORS_KEY` definition that used `FORMAT_VERSION`.)

Add the import at the top, below the existing `import { dot, ... }` line:
```ts
import { toBinary, toInt8, hamming, dotInt8, BITS_PER_BYTE } from "./quantize";
```

Add these exports near `LoadedArtifacts`:
```ts
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
  const int8 = new Int8Array(v.section("int8").buffer as ArrayBuffer);
  return {
    bin, unitIdx: toU32(v.section("unitIdx")), vdim,
    count: Number(v.header.count), buildId: String(v.header.buildId),
    readInt8Row: (row) => int8.subarray(row * vdim, (row + 1) * vdim),
  };
}
```

- [ ] **Step 4: Write quantized sections in `buildArtifacts`**

In `buildArtifacts`, replace the whole `let vectors: Buffer | null = null; … }` block (the one that builds `unitIdx` + a Float32 `block` section named `vecs`) with:
```ts
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
```

- [ ] **Step 5: Make `loadArtifacts` take a `VectorsSource` and rank in two stages**

Change the signature and the vectors block. Replace:
```ts
export function loadArtifacts(bm25Buf: Buffer, vectorsBuf?: Buffer | null): LoadedArtifacts {
```
with:
```ts
export function loadArtifacts(bm25Buf: Buffer, vectors?: VectorsSource | null): LoadedArtifacts {
```
Replace the whole `let vecUnitIdx … }` vectors-loading block with:
```ts
  // vectors (optional; buildId must match or dense is skipped — integrity guard)
  let vsrc: VectorsSource | null = null;
  let vdim: number | null = a.header.vdim ?? null;
  if (vectors) {
    if (vectors.buildId === a.header.buildId) { vsrc = vectors; vdim = vectors.vdim; }
    else console.warn(`[artifact] vectors buildId mismatch (${vectors.buildId} vs ${a.header.buildId}) → dense off`);
  }
  const RESCORE_N = Number(process.env.DENSE_RESCORE_N ?? 200);
```
Then replace the whole `denseRank: (queryVec) => { … }` property with:
```ts
    // Two stages, and the CONTRACT IS PRESERVED: a full sorted list of every vector's unit id, so
    // hybridRank's RRF fusion shape is unchanged. Stage 1 is an exhaustive Hamming scan (exact by
    // construction — no ANN approximation error at this corpus size). Stage 2 rescores only the
    // head with int8, read positionally, and splices it back; the tail keeps binary order, which
    // is immaterial to RRF (rank 200 contributes 1/(60+200)≈0.004 vs 1/(60+1)≈0.016 at the head).
    denseRank: (queryVec) => {
      if (!vsrc || !vdim || queryVec.length !== vdim) return [];
      const binBytes = Math.ceil(vdim / BITS_PER_BYTE);
      const qb = toBinary(queryVec);
      const byHam: { row: number; d: number }[] = new Array(vsrc.count);
      for (let row = 0; row < vsrc.count; row++) {
        byHam[row] = { row, d: hamming(qb, 0, vsrc.bin, row * binBytes, binBytes) };
      }
      const idOf = (row: number) => ids[vsrc!.unitIdx[row]];
      byHam.sort((x, y) => x.d - y.d || idOf(x.row).localeCompare(idOf(y.row)));
      const headN = Math.min(RESCORE_N, byHam.length);
      if (vsrc.readInt8Row && headN > 0) {
        const qi = toInt8(queryVec);
        const head: { row: number; s: number }[] = [];
        for (let k = 0; k < headN; k++) {
          const row = byHam[k].row;
          const r = vsrc.readInt8Row(row);
          // A failed positional read keeps this row's binary standing rather than throwing.
          head.push({ row, s: r ? dotInt8(qi, r, 0, vdim) : -Infinity });
        }
        head.sort((x, y) => y.s - x.s || idOf(x.row).localeCompare(idOf(y.row)));
        return [...head.map((h) => ({ id: idOf(h.row) })), ...byHam.slice(headN).map((h) => ({ id: idOf(h.row) }))];
      }
      console.warn("[artifact] int8 tier unavailable → binary-only dense ranking");
      return byHam.map((h) => ({ id: idOf(h.row) }));
    },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx scripts/test-cases-quantize.ts`
Expected: `✅ test-cases-quantize passed`

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `unpack`, `SectionMap`, `MAGIC`, or `toU32` are not in scope where you added the new exports, move your additions BELOW their definitions in the same file — do not duplicate them.

- [ ] **Step 8: Commit**

```bash
git add src/lib/cases/search/artifact.ts scripts/test-cases-quantize.ts
git commit -m "feat(search): quantized vectors artifact v2 + two-stage denseRank"
```

---

## Task 3: Stream the vectors object to `/tmp` in `build-index.ts`

**Files:**
- Modify: `src/lib/cases/search/build-index.ts`
- Modify: `scripts/cases-index-build.ts`

- [ ] **Step 1: Replace the artifact-loading block in `build-index.ts`**

The current block (inside the `try` that runs when `fileDir || bucket` is set) reads both objects into Buffers and calls `loadArtifacts(bm25, vectors)`. Replace that whole block — from `const wantVectors = isRealProvider();` through the `const loaded = loadArtifacts(bm25, vectors);` line — with:
```ts
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
```
Update the imports at the top of the file so they read:
```ts
import { loadArtifacts, parseVectorsBuffer, readPreamble, readHeader, PREAMBLE_BYTES, BM25_KEY, VECTORS_KEY, type VectorsSource } from "./artifact";
```
and add, next to the other Node imports:
```ts
import { createWriteStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
```

- [ ] **Step 2: Add the two helpers at the bottom of `build-index.ts`**

```ts
// Plain S3 GetObject → Buffer. Used for bm25.bin, which needs random access to all of it anyway.
async function getObjectBuffer(bucket: string, Key: string): Promise<Buffer> {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({});
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

// Stream the vectors object to /tmp, then read only what must be resident. Ephemeral storage is
// 512MB by default and does NOT count against the function's MemorySize, so ~278MB fits with no
// quota change — while the heap never holds more than the 30.7MB binary block. This is the whole
// point: `Buffer.from(await transformToByteArray())` on the old 985MB object peaked ~3.5GB.
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
  const unitIdx = new Uint32Array(idxBuf.buffer, idxBuf.byteOffset, idxBuf.byteLength / 4).slice();
  // Positional int8 reads: RESCORE_N rows × vdim bytes per query (200KB at N=200), heap ≈ 0.
  const rowBuf = Buffer.allocUnsafe(vdim);
  const readInt8Row = (row: number): Int8Array | null => {
    try {
      const { bytesRead } = fh.readSync ? { bytesRead: 0 } : { bytesRead: 0 }; // placeholder replaced below
      void bytesRead;
      return null;
    } catch { return null; }
  };
  void readInt8Row;
  // Synchronous positional reads need a raw fd, so keep one alongside the FileHandle.
  const fd = fh.fd;
  const { readSync } = await import("node:fs");
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
```

Then **delete** the dead `rowBuf`-shadowing placeholder: remove the `const readInt8Row = (row: number) …` block and the `void readInt8Row;` line, keeping only `readRow`. (They are written above only to make the intent of the replacement unambiguous — the committed file must contain exactly one accessor, `readRow`.)

- [ ] **Step 3: Report the new sizes in `scripts/cases-index-build.ts`**

Find the summary `console.log` that prints `bm25=…MB` and the vectors size, and change the vectors portion to report both sections. If the script currently logs `vectors.length`, keep that byte count but relabel it so the split is visible:
```ts
    `· bm25=${(bm25.length / 1e6).toFixed(1)}MB` +
    (vectors ? ` · vectors(quantized bin+int8)=${(vectors.length / 1e6).toFixed(1)}MB` : " · vectors=none")
```

- [ ] **Step 4: Typecheck + tests + build**

Run: `npm run typecheck` → expected clean (0 errors).
Run: `npx tsx scripts/test-cases-quantize.ts` → `✅ test-cases-quantize passed`
Run: `npx tsx scripts/test-cases-hybrid.ts` → expected PASS (the existing hybrid suite must not regress).
Run: `npm run build` → expected Next.js build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/search/build-index.ts scripts/cases-index-build.ts
git commit -m "feat(search): stream the vectors artifact to /tmp; positional int8 reads"
```

---

## Task 4: `cases-quant-eval.ts` — the fidelity gate

**Files:**
- Create: `scripts/cases-quant-eval.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the eval script**

Create `scripts/cases-quant-eval.ts`:
```ts
// Leave-one-out fidelity measurement for the quantized artifact (spec 2026-07-30). Uses the
// corpus's OWN stored vectors as queries, so it needs NO graded relevance labels — it measures
// representation fidelity (does quantized ranking agree with exact float32?), not retrieval
// quality. That matters because our graded set is 18 queries, below the smallest topic-set size
// the IR methodology literature even simulates (25), and cannot resolve deltas under ~0.05.
//
// GATE: Recall@10 with rescoring must be ≥ 0.95 before dense is re-enabled in production.
import "./fetch-polyfill";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { unpackF32 } from "../src/lib/cases/search/pack";
import { dot } from "../src/lib/cases/search/hybrid";
import { toBinary, toInt8, hamming, dotInt8, BITS_PER_BYTE } from "../src/lib/cases/search/quantize";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const DIM = Number(process.env.EMBED_DIM ?? 1024);
const QUERIES = Number(process.env.QUANT_EVAL_QUERIES ?? 200);
const RESCORE_N = Number(process.env.DENSE_RESCORE_N ?? 200);
const GATE = 0.95;

async function main() {
  // Scan CHUNK items for stored float32 vectors (Binary `vec` attribute).
  const vecs: Float32Array[] = [];
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({
      TableName: TABLE, ExclusiveStartKey: start,
      ProjectionExpression: "vec", FilterExpression: "attribute_exists(vec)",
    }));
    for (const it of r.Items ?? []) if (it.vec) vecs.push(unpackF32(it.vec as Uint8Array, DIM));
    start = r.LastEvaluatedKey;
    if (vecs.length % 20000 < 200) console.log(`  scanned ${vecs.length} vectors…`);
  } while (start);
  const N = vecs.length;
  if (N < 50) { console.error(`❌ only ${N} vectors found — nothing to measure`); process.exit(1); }

  const binBytes = Math.ceil(DIM / BITS_PER_BYTE);
  const bin = new Uint8Array(N * binBytes);
  const i8 = new Int8Array(N * DIM);
  vecs.forEach((v, i) => { bin.set(toBinary(v), i * binBytes); i8.set(toInt8(v), i * DIM); });
  console.log(`vectors ${N} · float32 ${(N * DIM * 4 / 1e6).toFixed(1)}MB · binary ${(bin.length / 1e6).toFixed(1)}MB · int8 ${(i8.length / 1e6).toFixed(1)}MB`);

  // Leave-one-out: every Kth vector is a query; exclude itself from its own gold set.
  const step = Math.max(1, Math.floor(N / QUERIES));
  let hitR10 = 0, hitR50 = 0, hitBinOnly = 0, tot10 = 0, tot50 = 0, q = 0;
  for (let qi = 0; qi < N && q < QUERIES; qi += step, q++) {
    const query = vecs[qi];
    const exact = vecs.map((v, i) => ({ i, s: i === qi ? -Infinity : dot(query, v) }))
      .sort((x, y) => y.s - x.s);
    const gold10 = new Set(exact.slice(0, 10).map((r) => r.i));
    const gold50 = new Set(exact.slice(0, 50).map((r) => r.i));
    const qb = toBinary(query), qint = toInt8(query);
    const byHam = Array.from({ length: N }, (_, i) => ({ i, d: i === qi ? Infinity : hamming(qb, 0, bin, i * binBytes, binBytes) }))
      .sort((x, y) => x.d - y.d);
    const binTop10 = byHam.slice(0, 10).map((r) => r.i);
    const rescored = byHam.slice(0, RESCORE_N)
      .map(({ i }) => ({ i, s: dotInt8(qint, i8, i * DIM, DIM) }))
      .sort((x, y) => y.s - x.s);
    hitR10 += rescored.slice(0, 10).filter((r) => gold10.has(r.i)).length; tot10 += gold10.size;
    hitR50 += rescored.slice(0, 50).filter((r) => gold50.has(r.i)).length; tot50 += gold50.size;
    hitBinOnly += binTop10.filter((i) => gold10.has(i)).length;
  }
  const r10 = hitR10 / tot10, r50 = hitR50 / tot50, rBin = hitBinOnly / tot10;
  console.log(`queries ${q} · rescore_n ${RESCORE_N}`);
  console.log(`  Recall@10 binary-only      = ${rBin.toFixed(4)}`);
  console.log(`  Recall@10 binary+int8      = ${r10.toFixed(4)}   (gate ≥ ${GATE})`);
  console.log(`  Recall@50 binary+int8      = ${r50.toFixed(4)}`);
  if (r10 < GATE) {
    console.error(`❌ GATE FAILED: Recall@10 ${r10.toFixed(4)} < ${GATE}. Raise DENSE_RESCORE_N or make int8 the resident tier — do NOT ship a silent quality regression.`);
    process.exit(1);
  }
  console.log(`✅ gate passed — safe to re-enable dense (flip BRIEF_EMBED_PROVIDER / CASES_EMBED_PROVIDER to bedrock)`);
}

main().catch((e) => { console.error("❌ cases-quant-eval failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts**

In `package.json` `scripts`, add after the `cases:index-build:cloud` line:
```json
    "cases:quant-eval": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-quant-eval.ts",
    "cases:quant-eval:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-quant-eval.ts",
```
Ensure valid JSON (commas).

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck` → expected clean.
Run: `npm run build` → expected Next.js build succeeds (ops scripts must not enter any route bundle).

Do NOT run the eval script — it needs DynamoDB and credentials, and is verified by typecheck + build only.

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-quant-eval.ts package.json
git commit -m "feat(search): leave-one-out quantization fidelity eval + gate"
```

---

## Final verification (before finishing the branch)

- [ ] `npx tsx scripts/test-cases-quantize.ts` → passed, synthetic Recall@10 ≥ 0.95 printed
- [ ] `npx tsx scripts/test-cases-hybrid.ts` → passed (no regression in the existing hybrid suite)
- [ ] `npm run typecheck` → clean · `npm run build` → succeeds
- [ ] `grep -n "vecs" src/lib/cases/search/artifact.ts` → the old float32 `vecs` section name is gone
- [ ] `grep -n "transformToByteArray" src/lib/cases/search/build-index.ts` → appears ONLY inside `getObjectBuffer` (bm25), never on the vectors path
- [ ] `grep -c "readRow\|readInt8Row" src/lib/cases/search/build-index.ts` → exactly one accessor implementation

---

## Self-Review (completed by plan author)

**1. Spec coverage:** pure quantize module → T1 ✅ · `VECTORS_FORMAT_VERSION` decoupled from BM25 key → T2 Step 3 ✅ · `bin`/`int8` sections → T2 Step 4 ✅ · two-stage contract-preserving `denseRank` with `DENSE_RESCORE_N` → T2 Step 5 ✅ · stream to `/tmp` + positional int8, no heap materialization → T3 ✅ · stay at 1024 dims (no truncation anywhere) ✅ · leave-one-out gate at 0.95 → T4 ✅ · graceful degradation (missing vectors → BM25-only; missing int8 → binary-only) → T2 Step 5 + T3 Step 1 ✅ · re-enabling dense is explicitly deferred to ops, not code ✅

**2. Placeholder scan:** One deliberate exception, flagged inline: T3 Step 2 shows a placeholder `readInt8Row` and then instructs its deletion, so the intent of the final single `readRow` accessor is unambiguous. Everything else is complete code.

**3. Type consistency:** `VectorsSource{bin, unitIdx, vdim, count, buildId, readInt8Row}` is identical in `artifact.ts` (T2), the test (T2 Step 1), and `build-index.ts` (T3). `toBinary`/`toInt8`/`hamming(a,aOff,b,bOff,bytes)`/`dotInt8(q,block,off,dim)`/`BITS_PER_BYTE` signatures match across T1, T2, T3, T4. `loadArtifacts(bm25Buf, vectors?: VectorsSource | null)` is used with a `VectorsSource` in both the test and `build-index.ts`. `PREAMBLE_BYTES`/`readPreamble`/`readHeader` are defined in T2 and consumed in T3.
