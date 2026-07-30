# Vector Quantization for the Search Artifact (binary + int8 rescore) — Design

**Date:** 2026-07-30 · **Status:** approved (design), pre-implementation · **Domain:** new `src/lib/cases/search/quantize.ts`, `src/lib/cases/search/artifact.ts`, `src/lib/cases/search/build-index.ts`, `scripts/cases-index-build.ts`, new `scripts/cases-quant-eval.ts`

## Motivation

The dense-vector artifact is **985 MB** (240,061 chunks × 1024 dims × 4 B = 983 MB). Loading it costs
**three concurrent copies** — S3 `transformToByteArray()` → `Buffer.from(...)` (`build-index.ts:69`) →
`artifact.ts`'s per-section 4-byte-alignment copy (`const copy = new Uint8Array(s[1]); copy.set(...)`)
— peaking ≈3.5 GB. This killed the BriefGen worker (a client demo hung at `pending` for three weeks;
see `2026-07-30-briefgen-p0-unblock-design.md`), and the Web block records the same load
**"OOMs even at the account's 3008 MB Lambda cap"** — which *is* the cap. P0 retreated to BM25-only,
sacrificing dense retrieval.

**Raising memory cannot work** and streaming alone cannot either: the dense scan touches *every*
vector, so the vectors must be resident in some form. The fix is to make "resident" cheap.

**Quantization does exactly that, and we can do it for free** — sign-thresholding vectors we already
have, no re-embedding, no API spend:

| Representation | Size | Reported nDCG@10 delta |
|---|---|---|
| float32 1024d (today) | **983 MB** | baseline |
| int8 1024d | 246 MB | −1.95 alone · **−0.09 with rescore** |
| **binary 1024d** | **30.7 MB** | −6.50 alone · **−0.93 with rescore** |

Sources: HAKARI-Bench (arXiv 2606.22778, 2026-06-22; 55 models — *single-author preprint, treat
magnitudes as directional*), corroborated by AWS's own Titan V2 binary-embedding figures (97 %
retrieval accuracy retained without reranking, 98.5 % with; 99.1 % end-to-end answer correctness).

**At 240 k vectors an exhaustive Hamming scan has zero ANN approximation error** — the
brute-force-purity property the corpus was designed around is preserved exactly.

## Scope (confirmed)

- **Two-tier dense retrieval**: binary (30.7 MB, resident) for full ranking → int8 (246 MB, on
  `/tmp`, read positionally) to rescore the head.
- **Stay at 1024 dims.** Do **not** stack binary on top of Matryoshka truncation: 1024d+binary
  retains ~96.5 % but **512d+binary drops to 90.76 %** — we sit exactly on the documented threshold
  where binary works (Qdrant: "expect poorer results for embeddings below 1024 dimensions").
- **Offline validation gate before any prod flip** — a script that measures binary+rescore ranking
  against float32 ranking on the *real* cloud vectors. This is self-validating and does **not**
  depend on the 18-query graded set (which is below the methodology literature's smallest simulated
  topic-set size of 25 and cannot resolve deltas under ~0.05).
- **NOT in scope:** re-enabling dense on BriefGen/Web (a follow-up, gated on the validation numbers,
  flipping the env vars P0 made overridable); re-embedding; changing the embedder; chunking changes.

## Architecture

### 1. New pure module — `src/lib/cases/search/quantize.ts`

```ts
// Sign-threshold to 1 bit/dim, MSB-first within each byte. Requires L2-normalized vectors
// (Titan v2 is called with normalize:true), which is what makes dot == cosine and the sign
// bit meaningful. Output length = ceil(dim/8).
export function toBinary(v: Float32Array): Uint8Array;

// Scalar-quantize to 1 byte/dim: round(v * 127) clamped to [-127, 127]. A GLOBAL scale is
// correct here precisely because the vectors are unit-norm, so every component is in [-1, 1] —
// no per-vector scale table is needed.
export function toInt8(v: Float32Array): Int8Array;

// Hamming distance over packed bits (popcount per byte via a 256-entry table).
export function hamming(a: Uint8Array, aOff: number, b: Uint8Array, bOff: number, bytes: number): number;

// Unnormalized int8 dot product. Monotone in the true cosine (the 1/127² factor is constant),
// so it is a valid *ranking* score and no dequantization is needed.
export function dotInt8(q: Int8Array, block: Int8Array, off: number, dim: number): number;
```

Pure, deterministic, no I/O — unit-testable offline.

### 2. Artifact format — decouple the vectors version from BM25

`FORMAT_VERSION` currently derives **both** storage keys, so bumping it would move `bm25.bin` too;
the loader would then miss it, `catch`, and fall back to the 42.8 s table scan until a rebuild
landed. To keep the rollout safe, introduce a **separate vectors version**:

```ts
export const FORMAT_VERSION = 1;          // unchanged — BM25_KEY stays at v1
export const VECTORS_FORMAT_VERSION = 2;  // quantized vectors
export const BM25_KEY = `cases-index/v${FORMAT_VERSION}/bm25.bin`;
export const VECTORS_KEY = `cases-index/v${VECTORS_FORMAT_VERSION}/vectors.bin`;
```

`buildArtifacts` writes the vectors container with `quant: "binary+int8"` in the header and sections:

| Section | Type | Size at 240 k × 1024d |
|---|---|---|
| `unitIdx` | `Uint32Array` (unchanged) | 0.96 MB |
| `bin` | `Uint8Array`, `count × dim/8` | **30.7 MB** |
| `int8` | `Int8Array`, `count × dim` | 246 MB |

Total **≈ 278 MB** (vs 985 MB). Float32 vectors are no longer stored in the artifact — DynamoDB
remains the source of truth for them (`vec` on CHUNK items), so nothing is lost and a future
re-quantization needs no re-embedding.

The v1 loader path stays intact: an old `v1/vectors.bin` is simply never requested, and a missing
`v2/vectors.bin` degrades to BM25-only exactly as today (`catch(() => null)`), never to a scan.

### 3. Loader — stream to `/tmp`, never materialize in heap

`build-index.ts` currently does `Buffer.from(await (...).transformToByteArray())`. Replace the
**vectors** path with a stream to `/tmp` (`ephemeral storage is 512 MB by default and does NOT count
against the function's MemorySize` — 278 MB fits, so **no config change is needed**):

```
S3 GetObject body  --pipe-->  /tmp/cases-vectors-<buildId>.bin      (heap ≈ 0)
  → read the 12-byte preamble + JSON header positionally
  → read the `bin` section into heap                                 (30.7 MB, needed for the full scan)
  → keep the fd open; read `int8` rows positionally on demand        (heap ≈ 0)
```

Rescoring the head reads `N × 1024` bytes (200 KB at N=200) per query via `fs.read` at computed
offsets — no native memmap module, no heap residency. `bm25.bin` keeps its existing in-heap path
(157 MB is affordable and the BM25 index needs random access to all of it).

### 4. Two-stage `denseRank` — contract-preserving

`denseRank(queryVec)` today returns a **full sorted list of every vector's unit id**, which
`hybridRank` fuses with BM25 via RRF (k=60). Truncating it would change fusion shape, so the two-stage
version **keeps the full list** and only makes the head accurate:

```
1. qb = toBinary(queryVec); qi = toInt8(queryVec)
2. Full scan: hamming(qb, row) for all `count` rows → sort ascending  → complete ranking
3. Rescore the top RESCORE_N rows: read their int8 bytes from /tmp, score dotInt8(qi, row),
   re-sort ONLY that head, splice it back above the untouched tail
4. Return the full id list (same shape as before)
```

`RESCORE_N` = `Number(process.env.DENSE_RESCORE_N ?? 200)`. The tail keeps binary ordering, which is
immaterial to RRF: a rank-200 contribution is `1/(60+200) ≈ 0.0038` against `1/(60+1) ≈ 0.0164` at the
head. If the int8 tier is unavailable (no `/tmp` file), stage 3 is skipped and binary-only ranking is
returned — degraded but functional, and logged.

The `embedderId` / `vdim` compatibility guard in `hybridSearch` is untouched: quantization changes the
*representation*, not the embedder identity, so a mismatched embedder still correctly falls back to
BM25-only.

### 5. Offline validation — `scripts/cases-quant-eval.ts` (the gate)

Reads the real cloud vectors (`cases:quant-eval[:cloud]`), and for a sample of queries reports how
much the quantized pipeline agrees with exact float32 ranking. **Queries are the corpus's own
vectors** (leave-one-out: use stored chunk vectors as queries), so this needs **no graded relevance
labels at all** — it measures representation fidelity, not retrieval quality.

Metrics, each over the same sample:
- **Recall@10 / @50** of the float32 top-k inside the quantized top-k (the number that matters)
- **Recall@10 for binary-only** (isolates what rescoring buys)
- **rank correlation on the head** (Kendall τ over the float32 top-50)
- **Effective size** and **measured heap** during load

**Gate to proceed to the prod flip: Recall@10 ≥ 0.95 with rescoring.** If binary-only is materially
better than the HAKARI-Bench prediction, note it; if Recall@10 lands below 0.95, the honest response
is to raise `RESCORE_N` or fall back to int8-only as the resident tier (246 MB still fits) — **not**
to ship a silent quality regression.

### Files

| File | Change |
|---|---|
| `src/lib/cases/search/quantize.ts` | **New, pure.** `toBinary`, `toInt8`, `hamming`, `dotInt8`. |
| `src/lib/cases/search/artifact.ts` | `VECTORS_FORMAT_VERSION` + quantized `bin`/`int8` sections in `buildArtifacts`; loader accepts an int8 accessor instead of a float block; two-stage `denseRank`. |
| `src/lib/cases/search/build-index.ts` | Stream the vectors object to `/tmp`; positional header/section reads; pass the int8 accessor through. |
| `scripts/cases-index-build.ts` | Report the new section sizes in its summary line. |
| `scripts/cases-quant-eval.ts` | **New.** Leave-one-out fidelity measurement + the 0.95 gate. |
| `scripts/test-cases-quantize.ts` | **New.** Unit tests for the pure module + a synthetic end-to-end ranking-agreement test. |
| `package.json` | `cases:quant-eval[:cloud]`. |

Unchanged: the embedder, `hybridRank`/RRF, `routeQuery`, `CaseRepo`, storage schema, DynamoDB as the
float32 source of truth, and every non-search feature. `bm25.bin` and its key are untouched.

## Error handling

- Vectors object missing / header unreadable / `quant` field absent → BM25-only, warned (existing
  `catch(() => null)` contract).
- `/tmp` write fails (disk full) → load the `bin` section only from the stream, skip the int8 tier →
  binary-only ranking, warned.
- `buildId` mismatch between bm25 and vectors → dense off (existing integrity guard, kept).
- Positional int8 read fails mid-query → that row keeps its binary rank rather than throwing.

## Testing (offline, TDD)

`scripts/test-cases-quantize.ts` (async-IIFE, `node:assert/strict`, no network):
- `toBinary`: bit order MSB-first; `dim % 8 == 0` and a non-multiple dim; a vector of all-positive →
  all 1 bits; sign boundary at exactly 0.
- `toInt8`: `1.0 → 127`, `-1.0 → -127`, `0 → 0`, clamping beyond ±1.
- `hamming`: identical → 0; one flipped bit → 1; offset arithmetic across rows.
- `dotInt8`: monotone agreement with float32 `dot` on random unit vectors (rank order preserved on a
  sample, which is the property the ranking relies on).
- **End-to-end agreement on synthetic data**: 2,000 random unit vectors, 50 random queries → assert
  quantized-with-rescore Recall@10 vs exact float32 ≥ 0.95 (the same criterion the real-data gate
  uses, so the test fails for the same reason production would).
- Artifact round-trip: `buildArtifacts` → `loadArtifacts` → `denseRank` returns the **full** id list
  (contract) and its head matches the exact float32 ordering on a small fixture.

Gate: `npx tsx scripts/test-cases-quantize.ts` passes; `npm run typecheck` clean; `npm run build`
compiles; `npm run verify` (dynamo ≡ mock) unaffected — `hybridSearch` is already excluded from the
parity golden set by design.

## Operational / deploy

1. Merge → deploy (code only; no artifact exists at `v2/` yet, so dense stays off exactly as P0 left it).
2. **Credentialed:** `cases:index-build:cloud` writes the v2 quantized vectors object
   (expect ≈278 MB vs 985 MB) alongside the untouched v1 `bm25.bin`.
3. **Credentialed:** `cases:quant-eval:cloud` → must report **Recall@10 ≥ 0.95**. Record the numbers.
4. Only if the gate passes: flip `BRIEF_EMBED_PROVIDER` / `CASES_EMBED_PROVIDER` back to `bedrock`
   (P0 made both overridable) and confirm in CloudWatch that the vectors load is ~278 MB and that
   BriefGen completes. **This is what restores dense retrieval for briefings.**
5. No new AWS resource; no memory or ephemeral-storage quota change required.

## Governance / safety

- **No change to what the user is shown or how claims are verified** — this is retrieval plumbing
  below the extraction/verification layer. Every red line (extractive, citation-anchored, verbatim-
  verified, refuses when nothing verifies) is untouched.
- Retrieval *quality* is protected by an explicit numeric gate measured on real data, not asserted.
- Brute-force exhaustive scan is preserved: **no ANN approximation error is introduced**, only
  quantization error, and that error is measured.

## Explicitly NOT doing (YAGNI + deferred)

- No Matryoshka/dimension truncation (documented to break binary below 1024d).
- No product quantization (needs codebook training; buys nothing over binary+rescore at 240 k).
- No ANN index (240 k exhaustive Hamming is fast and exact-by-construction).
- No embedder change (that is RM-6, and it is measured separately).
- No re-embedding — quantization derives from vectors already stored.
- No chunking change (RM-1), no eval-set work (RM-3).

## Success criteria

- The v2 vectors artifact is ≈278 MB, loads with ~31 MB resident heap, and `denseRank` still returns
  a full ranking whose head matches exact float32 within **Recall@10 ≥ 0.95** on real corpus vectors.
- Quantize unit tests green; typecheck + build clean; `verify` unaffected.
- After the gate passes, dense retrieval is **restored** on BriefGen and Web — undoing P0's retreat
  rather than living with it.
