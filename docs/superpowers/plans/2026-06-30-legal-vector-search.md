# Phase 2-B.2: Vector / Hybrid Retrieval Substrate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add brute-force BM25 + dense-vector + RRF(k=60) hybrid retrieval over the full-text chunk substrate, behind a new `CaseRepo.hybridSearch` method, with a pluggable embedder that runs offline (deterministic no-key stub) and lights up real semantic vectors behind a key.

**Architecture:** All new code lives under `src/lib/cases/search/`. Pure pieces (pack/unpack, BM25, RRF, embedder stub, unit assembly) are unit-tested offline. The dynamo repo builds an in-memory index (BM25 inverted index + L2-normalized vector matrix) once per process from one table scan — never per query — and fuses BM25 + cosine ranks with RRF, aggregating to the case by max. `searchCases` is UNTOUCHED so the `dynamo ≡ mock` golden checks still hold; `hybridSearch` is a new method, excluded from those equality checks by design (the mock delegates to keyword search because fixtures have no vectors). Vectors are stored as a `vec` Binary attribute added to CHUNK items by a separate idempotent `cases:embed` pass; the domain `LegalCase` and PROFILE marshalling never see vectors.

**Tech Stack:** TypeScript, Next.js 14 server components, AWS DynamoDB (lib-dynamodb DocumentClient), `tsx` standalone test scripts, `node:crypto` for the stub embedder.

**Spec:** `docs/specs/2026-06-30-vector-hybrid-search-design.md`. **Branch:** `feat/legal-vector-search` (already created, stacked on `feat/legal-fulltext-fetch`).

**Conventions to follow:**
- Tests are standalone scripts run with `npx tsx scripts/test-cases-<name>.ts`; they use `import assert from "node:assert/strict"`, assert, and end with `console.log("✅ … passed")`. There is no `npm test` runner.
- Vectors are L2-normalized by contract, so cosine similarity = dot product.
- Determinism everywhere: stable sorts with an `id`/`caseId` `localeCompare` tie-break (matches `query.ts`).
- Commit after each task with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

**Create:**
- `src/lib/cases/search/pack.ts` — float32 ⇄ Buffer (DynamoDB Binary) pack/unpack. Pure.
- `src/lib/cases/search/bm25.ts` — tokenizer + BM25 index/score. Pure.
- `src/lib/cases/search/hybrid.ts` — RRF fusion, dot/cosine, `metaText`, `hybridRank` (chunk-level fuse → max-per-case). Pure.
- `src/lib/cases/search/embedder.ts` — `Embedder` interface, deterministic stub, env-selected real factory.
- `src/lib/cases/search/build-index.ts` — pure `assembleUnits` + ddb-coupled cached `getSearchIndex`/`invalidateSearchIndex`.
- `scripts/cases-embed.ts` — idempotent/resumable embed pass (writes `vec`/`embedderId`/`vdim` onto CHUNK items).
- `scripts/test-cases-pack.ts`, `test-cases-bm25.ts`, `test-cases-rrf.ts`, `test-cases-embedder.ts`, `test-cases-chunk.ts`, `test-cases-hybrid.ts`, `test-cases-embed-helper.ts` — offline unit tests.

**Modify:**
- `src/lib/cases/ingest/a2aj.ts` — retrieval-sized chunking (target ~2 KB; 256 KB hard backstop kept).
- `src/lib/cases/types.ts` — add `hybridSearch` to `CaseRepo`.
- `src/lib/cases/repo.dynamo.ts` — implement `hybridSearch`.
- `src/lib/cases/repo.mock.ts` — implement `hybridSearch` (delegates to keyword `searchCases`).
- `src/app/cases/page.tsx` — search call site uses `hybridSearch`.
- `scripts/verify.ts` — add `hybridSearch` BM25-only checks (do not touch the equality checks).
- `package.json` — `cases:embed` + `cases:embed:cloud` scripts.

**Untouched (call out so nobody "helpfully" edits them):** `src/lib/dynamo/cases-table.ts` (`vec` is an infra-only attribute the embed pass adds; `caseToItems`/`reassembleCase`/`itemToCase` never read or write it), `src/lib/cases/query.ts`, the `LegalCase` domain type's fields.

---

## Task 1: Float32 pack/unpack (DynamoDB Binary)

**Files:**
- Create: `src/lib/cases/search/pack.ts`
- Test: `scripts/test-cases-pack.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-cases-pack.ts
import assert from "node:assert/strict";
import { packF32, unpackF32 } from "../src/lib/cases/search/pack";

const v = Float32Array.from([1, -2.5, 3.25, 0, 0.125]);
const buf = packF32(v);
assert.equal(buf.length, v.length * 4, "4 bytes per float");

// round-trip is exact (values are already float32)
const back = unpackF32(buf, v.length);
assert.deepEqual(Array.from(back), Array.from(v), "round-trip equal");

// DynamoDB returns Binary as Uint8Array — unpack must accept it
const asU8 = new Uint8Array(buf);
const back2 = unpackF32(asU8, v.length);
assert.deepEqual(Array.from(back2), Array.from(v), "unpack accepts Uint8Array");

console.log("✅ pack tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-pack.ts`
Expected: FAIL — `Cannot find module '.../search/pack'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/cases/search/pack.ts
// Pack/unpack a float32 vector to/from a Node Buffer for storage as a DynamoDB
// Binary attribute. Binary (not a Number-list) keeps a 1024-d vector at exactly
// dim×4 bytes; a DynamoDB Number-list would bloat to tens of KB (see spec §4).
export function packF32(v: Float32Array): Buffer {
  const b = Buffer.allocUnsafe(v.length * 4);
  for (let i = 0; i < v.length; i++) b.writeFloatLE(v[i], i * 4);
  return b;
}

// Accepts a Buffer (our writes) or Uint8Array (what DocumentClient returns on read).
export function unpackF32(bytes: Buffer | Uint8Array, dim: number): Float32Array {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = buf.readFloatLE(i * 4);
  return v;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-pack.ts`
Expected: PASS — `✅ pack tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/search/pack.ts scripts/test-cases-pack.ts
git commit -m "feat(cases): float32 pack/unpack for DynamoDB Binary vectors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Tokenizer + BM25

**Files:**
- Create: `src/lib/cases/search/bm25.ts`
- Test: `scripts/test-cases-bm25.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-cases-bm25.ts
import assert from "node:assert/strict";
import { tokenize, Bm25 } from "../src/lib/cases/search/bm25";

// keeps legal exact tokens (digits + neutral-citation parts), lowercases, no stemming
assert.deepEqual(tokenize("Haida 2004 SCC 73"), ["haida", "2004", "scc", "73"]);

const docs = [
  { id: "d1", tokens: tokenize("the quick brown fox") },
  { id: "d2", tokens: tokenize("the lazy dog sleeps") },
  { id: "d3", tokens: tokenize("quick quick fox runs") },
];
const bm = new Bm25(docs);
const ranked = bm.search(tokenize("quick fox"));

// d3 (quick×2, fox×1) outranks d1 (quick×1, fox×1); d2 (neither) scores 0 → absent
assert.equal(ranked[0].id, "d3", "d3 first");
assert.equal(ranked[1].id, "d1", "d1 second");
assert.ok(!ranked.some((r) => r.id === "d2"), "d2 (no match) absent");

// deterministic: empty query → empty results
assert.deepEqual(bm.search([]), []);

console.log("✅ bm25 tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-bm25.ts`
Expected: FAIL — `Cannot find module '.../search/bm25'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/cases/search/bm25.ts
// In-process BM25 (Robertson/Sparck-Jones). k1=1.2, b=0.75 (standard). Lexical
// matching guarantees exact legal tokens (neutral citations, section numbers) are
// findable — the property dense embeddings blur (spec §2, BEIR). No stemming / no
// stopword removal: deterministic, and stopwords already get near-zero idf weight.
export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export interface Bm25Doc {
  id: string;
  tokens: string[];
}

export class Bm25 {
  private readonly k1: number;
  private readonly b: number;
  private readonly docs: Bm25Doc[];
  private readonly df = new Map<string, number>();   // document frequency
  private readonly len = new Map<string, number>();  // doc length in tokens
  private readonly avgdl: number;

  constructor(docs: Bm25Doc[], k1 = 1.2, b = 0.75) {
    this.docs = docs;
    this.k1 = k1;
    this.b = b;
    let total = 0;
    for (const d of docs) {
      this.len.set(d.id, d.tokens.length);
      total += d.tokens.length;
      for (const t of new Set(d.tokens)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgdl = docs.length ? total / docs.length : 0;
  }

  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    // BM25 idf with +1 smoothing → always > 0 for present terms
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5));
  }

  // Returns docs with score > 0, sorted by score desc then id asc (deterministic).
  search(queryTokens: string[]): { id: string; score: number }[] {
    if (!queryTokens.length) return [];
    const q = [...new Set(queryTokens)].filter((t) => this.df.has(t));
    const out: { id: string; score: number }[] = [];
    for (const d of this.docs) {
      const dl = this.len.get(d.id) ?? 0;
      const tf = new Map<string, number>();
      for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of q) {
        const f = tf.get(term) ?? 0;
        if (!f) continue;
        const denom = f + this.k1 * (1 - this.b + (this.b * dl) / (this.avgdl || 1));
        score += this.idf(term) * ((f * (this.k1 + 1)) / denom);
      }
      if (score > 0) out.push({ id: d.id, score });
    }
    return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-bm25.ts`
Expected: PASS — `✅ bm25 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/search/bm25.ts scripts/test-cases-bm25.ts
git commit -m "feat(cases): in-process BM25 index + legal-token tokenizer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: RRF fusion + cosine + hybridRank

**Files:**
- Create: `src/lib/cases/search/hybrid.ts`
- Test: `scripts/test-cases-hybrid.ts` (RRF + metaText + dot here; full stub end-to-end added in Task 6 test after the embedder exists)

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-cases-hybrid.ts
import assert from "node:assert/strict";
import { rrf, dot, metaText, hybridRank, type RetrievalUnit } from "../src/lib/cases/search/hybrid";

// --- RRF(k=60): id in both lists at rank 0 scores 2/60 and wins ---
const fused = rrf([[{ id: "a" }, { id: "b" }, { id: "c" }], [{ id: "a" }, { id: "c" }, { id: "b" }]], 60);
assert.ok(Math.abs((fused.get("a") ?? 0) - 2 / 60) < 1e-9, "a = 2/60");
assert.ok((fused.get("a") ?? 0) > (fused.get("b") ?? 0), "a beats b");

// --- dot of L2-normalized vectors = cosine ---
assert.ok(Math.abs(dot(Float32Array.from([1, 0]), Float32Array.from([1, 0])) - 1) < 1e-9);
assert.ok(Math.abs(dot(Float32Array.from([1, 0]), Float32Array.from([0, 1]))) < 1e-9);

// --- metaText folds citation + name + nations + holding into one lexical doc ---
const mt = metaText({
  citation: "2014 SCC 44", citation2: undefined, styleOfCause: "Tsilhqot'in Nation v BC",
  nations: ["Tsilhqot'in"], outcome: { holding: "Aboriginal title established." },
} as any);
assert.ok(mt.includes("2014 SCC 44") && mt.includes("Tsilhqot'in") && mt.includes("title"));

// --- hybridRank: BM25-only (queryVec=null) ranks the case whose text matches ---
const units: RetrievalUnit[] = [
  { unitId: "caseA#meta", caseId: "caseA", text: "Haida Nation consultation duty" },
  { unitId: "caseB#meta", caseId: "caseB", text: "fisheries licensing dispute" },
];
const bm25Only = hybridRank(units, "consultation duty", null);
assert.equal(bm25Only[0].caseId, "caseA", "BM25-only finds caseA");

console.log("✅ hybrid (rrf/dot/meta/bm25-only) tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-hybrid.ts`
Expected: FAIL — `Cannot find module '.../search/hybrid'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/cases/search/hybrid.ts
// Pure hybrid fusion: BM25 + dense cosine ranks fused by Reciprocal Rank Fusion
// (Cormack SIGIR'09, k=60), aggregated to the case by MAX over its retrieval units
// (a strong single passage is the signal; sum would bias toward long judgments).
import { Bm25, tokenize } from "./bm25";
import type { LegalCase } from "../types";

export interface RetrievalUnit {
  unitId: string;   // `${caseId}#meta` or `${caseId}#chunk#<idx>`
  caseId: string;
  text: string;
  vec?: Float32Array; // present only for embedded chunk units
}
export interface HybridResult {
  caseId: string;
  score: number;
}

// Dot product. Vectors are L2-normalized by embedder contract, so dot == cosine.
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Reciprocal Rank Fusion. rank = index in each pre-sorted list.
export function rrf(lists: { id: string }[][], k = 60): Map<string, number> {
  const m = new Map<string, number>();
  for (const list of lists)
    list.forEach((item, rank) => m.set(item.id, (m.get(item.id) ?? 0) + 1 / (k + rank)));
  return m;
}

// Compact lexical doc for a case's metadata so exact-token queries (citation, name,
// nation) hit via BM25 even though those fields aren't in the body chunks (spec §6).
export function metaText(c: Pick<LegalCase, "citation" | "citation2" | "styleOfCause" | "nations" | "outcome">): string {
  return [c.citation, c.citation2 ?? "", c.styleOfCause, c.nations.join(" "), c.outcome.holding]
    .filter(Boolean)
    .join(" ");
}

// Rank cases for a query. queryVec === null → BM25-only (dense path skipped).
export function hybridRank(
  units: RetrievalUnit[],
  query: string,
  queryVec: Float32Array | null,
  k = 60,
): HybridResult[] {
  const bm = new Bm25(units.map((u) => ({ id: u.unitId, tokens: tokenize(u.text) })));
  const lists: { id: string }[][] = [bm.search(tokenize(query)).map((r) => ({ id: r.id }))];

  if (queryVec) {
    const dense = units
      .filter((u) => u.vec)
      .map((u) => ({ id: u.unitId, score: dot(queryVec, u.vec!) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((r) => ({ id: r.id }));
    lists.push(dense);
  }

  const fused = rrf(lists, k);
  const unitCase = new Map(units.map((u) => [u.unitId, u.caseId]));
  const byCase = new Map<string, number>();
  for (const [unitId, score] of fused) {
    const caseId = unitCase.get(unitId);
    if (!caseId) continue;
    byCase.set(caseId, Math.max(byCase.get(caseId) ?? 0, score));
  }
  return [...byCase.entries()]
    .map(([caseId, score]) => ({ caseId, score }))
    .sort((a, b) => b.score - a.score || a.caseId.localeCompare(b.caseId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-hybrid.ts`
Expected: PASS — `✅ hybrid (rrf/dot/meta/bm25-only) tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/search/hybrid.ts scripts/test-cases-hybrid.ts
git commit -m "feat(cases): RRF(k=60) fusion + cosine + per-case hybrid ranking

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Pluggable embedder (stub + factory)

**Files:**
- Create: `src/lib/cases/search/embedder.ts`
- Test: `scripts/test-cases-embedder.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-cases-embedder.ts
import assert from "node:assert/strict";
import { getEmbedder, StubEmbedder } from "../src/lib/cases/search/embedder";

const e = new StubEmbedder(1024);
assert.equal(e.id, "stub-hash-v1");
assert.equal(e.dim, 1024);

const [a] = await e.embed(["aboriginal title established"]);
const [a2] = await e.embed(["aboriginal title established"]);
const [b] = await e.embed(["fisheries licensing dispute"]);

assert.equal(a.length, 1024, "dim");
assert.deepEqual(Array.from(a), Array.from(a2), "deterministic: same text → same vector");
assert.ok(Array.from(a).some((x, i) => x !== b[i]), "different text → different vector");

// L2-normalized → norm ≈ 1
const norm = Math.sqrt(Array.from(a).reduce((s, x) => s + x * x, 0));
assert.ok(Math.abs(norm - 1) < 1e-5, "L2-normalized");

// factory falls back to the stub when no EMBED_PROVIDER is set
delete process.env.EMBED_PROVIDER;
assert.equal(getEmbedder().id, "stub-hash-v1", "no key → stub");

console.log("✅ embedder tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-embedder.ts`
Expected: FAIL — `Cannot find module '.../search/embedder'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/cases/search/embedder.ts
// Pluggable embedder. Default = a DETERMINISTIC HASH STUB that needs no API key, so
// the whole pipeline (chunk → embed → index → rank) runs offline in CI. The stub is
// NOT semantically meaningful — it only makes the dense path runnable + tests stable.
// A real provider (Bedrock/OpenAI/self-hosted bge-m3) is selected via EMBED_PROVIDER,
// mirroring ingest/llm.ts. Every vector is stamped with the embedder `id` so a query
// from embedder X is never cosine-compared against vectors written by embedder Y.
import { createHash } from "node:crypto";

export interface Embedder {
  readonly id: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export class StubEmbedder implements Embedder {
  readonly id = "stub-hash-v1";
  constructor(readonly dim = 1024) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => stubVector(t, this.dim));
  }
}

function stubVector(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest(); // 32 bytes
    for (let i = 0; i < dim; i++) v[i] += (h[i % h.length] - 127.5) / 127.5;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

// Real provider wiring lives here (Bedrock InvokeModel / OpenAI / bge-m3 HTTP), kept
// thin and out of tests — exactly like ingest/llm.ts callProvider. Implementers fill
// the call and MUST L2-normalize the output. Throws until configured.
class ProviderEmbedder implements Embedder {
  readonly id: string;
  constructor(readonly provider: string, readonly model: string, readonly dim: number) {
    this.id = `${provider}:${model}`;
  }
  async embed(_texts: string[]): Promise<Float32Array[]> {
    throw new Error(`ProviderEmbedder not configured for ${this.id} — implement the provider call.`);
  }
}

export function getEmbedder(): Embedder {
  const provider = (process.env.EMBED_PROVIDER ?? "").trim();
  const dim = Number(process.env.EMBED_DIM ?? "1024") || 1024;
  if (!provider) return new StubEmbedder(dim);
  const model = (process.env.EMBED_MODEL ?? "").trim();
  if (!model) throw new Error("EMBED_PROVIDER set but EMBED_MODEL missing.");
  return new ProviderEmbedder(provider, model, dim);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-embedder.ts`
Expected: PASS — `✅ embedder tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/search/embedder.ts scripts/test-cases-embedder.ts
git commit -m "feat(cases): pluggable embedder — deterministic no-key stub + keyed provider seam

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Retrieval-sized chunking

**Files:**
- Modify: `src/lib/cases/ingest/a2aj.ts:35-73` (the `MAX_CHUNK_BYTES` constant, `splitLarge`, and `chunkText`)
- Test: `scripts/test-cases-chunk.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-cases-chunk.ts
import assert from "node:assert/strict";
import { chunkText, TARGET_CHUNK_BYTES } from "../src/lib/cases/ingest/a2aj";

// short paragraph stays one chunk, untouched
const short = chunkText("A short paragraph about Aboriginal title.");
assert.equal(short.length, 1, "short → 1 chunk");
assert.equal(short[0].text, "A short paragraph about Aboriginal title.");

// a long single paragraph (no blank lines) is split into retrieval-sized pieces
const longPara = Array.from({ length: 400 }, (_, i) => `This is sentence number ${i}.`).join(" ");
assert.ok(Buffer.byteLength(longPara, "utf8") > TARGET_CHUNK_BYTES, "test input exceeds target");
const chunks = chunkText(longPara);
assert.ok(chunks.length > 1, "long paragraph splits into multiple chunks");
for (const c of chunks)
  assert.ok(Buffer.byteLength(c.text, "utf8") <= TARGET_CHUNK_BYTES + 64, "each chunk ~≤ target");

// paragraph boundaries (blank lines) still split first
const twoPara = chunkText("First paragraph.\n\nSecond paragraph.");
assert.equal(twoPara.length, 2, "blank-line paragraphs → 2 chunks");

// chunk ids are sequential para-N
assert.equal(chunks[0].paragraph, "para-1");
assert.equal(chunks[1].paragraph, "para-2");

console.log("✅ chunk tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-chunk.ts`
Expected: FAIL — `TARGET_CHUNK_BYTES` is not exported (and the long paragraph currently returns 1 chunk, since the old threshold is 256 KB).

- [ ] **Step 3: Write minimal implementation**

Replace `a2aj.ts` lines 33–73 (the `MAX_CHUNK_BYTES` comment block, `splitLarge`, and `chunkText`) with:

```ts
// Retrieval-sized chunking. TARGET keeps each chunk embeddable as one meaningful
// vector (~500 tokens); the 256 KB MAX is the absolute DynamoDB-item backstop for a
// pathological single sentence. No overlap → concatenating a case's chunks still
// reproduces the source (the fidelity property include.ts + getCase rely on).
export const TARGET_CHUNK_BYTES = 2048;   // ~500 tokens, retrieval-sized
const MAX_CHUNK_BYTES = 262144;           // 256 KB hard backstop

// Split a paragraph to ≤ TARGET on sentence boundaries; a single sentence over the
// 256 KB hard cap is char-split as a last resort (avoids ValidationException).
function splitLarge(para: string): string[] {
  if (Buffer.byteLength(para, "utf8") <= TARGET_CHUNK_BYTES) return [para];
  const sentences = para.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";
  for (const s of sentences) {
    const candidate = current ? `${current} ${s}` : s;
    if (Buffer.byteLength(candidate, "utf8") > TARGET_CHUNK_BYTES) {
      if (current) { parts.push(current); current = ""; }
      if (Buffer.byteLength(s, "utf8") > MAX_CHUNK_BYTES) {
        // single sentence over the hard cap: char-split (UTF-8 worst case 4 B/char)
        let remaining = s;
        const step = Math.floor(MAX_CHUNK_BYTES / 4);
        while (Buffer.byteLength(remaining, "utf8") > MAX_CHUNK_BYTES) {
          parts.push(remaining.slice(0, step));
          remaining = remaining.slice(step);
        }
        current = remaining;
      } else {
        current = s; // a long-ish sentence (over target, under cap) becomes its own chunk
      }
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}

export function chunkText(text: string): CaseChunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .flatMap(splitLarge);
  return paragraphs.map((t, i) => ({ paragraph: `para-${i + 1}`, text: t }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-chunk.ts`
Expected: PASS — `✅ chunk tests passed`.

- [ ] **Step 5: Confirm no regression in the existing full-text test**

Run: `npx tsx scripts/test-cases-fulltext.ts`
Expected: PASS — `✅ fulltext tests passed` (its inputs are small paragraphs, untouched by the new threshold).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/a2aj.ts scripts/test-cases-chunk.ts
git commit -m "feat(cases): retrieval-sized chunking (~2KB target, 256KB backstop)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Index assembly (pure) + cached builder + stub end-to-end

**Files:**
- Create: `src/lib/cases/search/build-index.ts`
- Test: append to `scripts/test-cases-hybrid.ts` (pure `assembleUnits` + a stub end-to-end through `hybridRank` with real vectors)

- [ ] **Step 1: Write the failing test (append to `scripts/test-cases-hybrid.ts`, before the final `console.log`)**

```ts
// --- assembleUnits: one meta unit per case + one chunk unit per chunk ---
import { assembleUnits } from "../src/lib/cases/search/build-index";
import { StubEmbedder } from "../src/lib/cases/search/embedder";

const units2 = assembleUnits(
  [{ id: "caseA", meta: "Haida Nation consultation" }],
  [
    { caseId: "caseA", idx: 1, text: "the Crown has a duty to consult", vec: undefined },
    { caseId: "caseA", idx: 2, text: "honour of the Crown engaged", vec: undefined },
  ],
);
assert.equal(units2.length, 3, "1 meta + 2 chunk units");
assert.equal(units2[0].unitId, "caseA#meta");
assert.equal(units2[1].unitId, "caseA#chunk#1");

// --- stub end-to-end: embed unit texts + query, dense path exercised ---
const emb = new StubEmbedder(64);
const docs = [
  { unitId: "caseA#chunk#1", caseId: "caseA", text: "duty to consult Aboriginal peoples" },
  { unitId: "caseB#chunk#1", caseId: "caseB", text: "commercial fishing quota allocation" },
];
const withVecs = await Promise.all(
  docs.map(async (d) => ({ ...d, vec: (await emb.embed([d.text]))[0] })),
);
const [qVec] = await emb.embed(["duty to consult"]);
const ranked2 = hybridRank(withVecs, "duty to consult", qVec);
assert.equal(ranked2[0].caseId, "caseA", "stub dense+bm25 ranks caseA first");
```

(Adjust the final line of the file to `console.log("✅ hybrid + index-assembly tests passed");`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-hybrid.ts`
Expected: FAIL — `Cannot find module '.../search/build-index'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/cases/search/build-index.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-hybrid.ts`
Expected: PASS — `✅ hybrid + index-assembly tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/search/build-index.ts scripts/test-cases-hybrid.ts
git commit -m "feat(cases): cached in-memory retrieval index from one table scan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Embed pass (`cases:embed`)

**Files:**
- Create: `scripts/cases-embed.ts`
- Create: `scripts/test-cases-embed-helper.ts`
- Modify: `package.json:32` (add `cases:embed` + `cases:embed:cloud` after `cases:promote`)

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
// scripts/test-cases-embed-helper.ts
import assert from "node:assert/strict";
import { needsEmbed } from "./cases-embed";

// missing vector → needs embedding
assert.equal(needsEmbed({ text: "x" }, "stub-hash-v1"), true, "no vec → embed");
// stale embedder id → re-embed
assert.equal(needsEmbed({ text: "x", vec: new Uint8Array(4), embedderId: "old" }, "stub-hash-v1"), true, "stale id → embed");
// current embedder id → skip
assert.equal(needsEmbed({ text: "x", vec: new Uint8Array(4), embedderId: "stub-hash-v1" }, "stub-hash-v1"), false, "current → skip");

console.log("✅ embed-helper tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-embed-helper.ts`
Expected: FAIL — `Cannot find module './cases-embed'` (or `needsEmbed` undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/cases-embed.ts
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
export function needsEmbed(item: { vec?: unknown; embedderId?: string }, activeId: string): boolean {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-embed-helper.ts`
Expected: PASS — `✅ embed-helper tests passed`.

- [ ] **Step 5: Add npm scripts**

In `package.json`, after the `cases:promote` line (line 32), add:

```json
    "cases:embed": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases tsx scripts/cases-embed.ts",
    "cases:embed:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases tsx scripts/cases-embed.ts"
```

(Add a trailing comma to the `cases:promote` line so the JSON stays valid.)

- [ ] **Step 6: Verify the JSON parses**

Run: `npx tsx -e "import('./package.json',{with:{type:'json'}}).then(()=>console.log('package.json OK'))"`
Expected: `package.json OK` (no JSON parse error).

- [ ] **Step 7: Commit**

```bash
git add scripts/cases-embed.ts scripts/test-cases-embed-helper.ts package.json
git commit -m "feat(cases): cases:embed pass — idempotent vec writes onto CHUNK items

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Seam — `hybridSearch` on `CaseRepo` + both repos + wire page

**Files:**
- Modify: `src/lib/cases/types.ts:102-110` (add method to `CaseRepo`)
- Modify: `src/lib/cases/repo.dynamo.ts` (implement)
- Modify: `src/lib/cases/repo.mock.ts` (implement — delegate to keyword search)
- Modify: `src/app/cases/page.tsx:19` (call `hybridSearch`)

- [ ] **Step 1: Add the method to the `CaseRepo` interface**

In `src/lib/cases/types.ts`, inside `CaseRepo`, add after the `searchCases` line:

```ts
  hybridSearch(query: string, filter?: CaseFilter): Promise<LegalCase[]>;
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — `dynamoCaseRepo`/`mockCaseRepo` do not implement `hybridSearch` (TS2741).

- [ ] **Step 3: Implement on the mock repo (keyword fallback)**

In `src/lib/cases/repo.mock.ts`, add after the `searchCases` method:

```ts
  // Fixtures have no vectors; the mock answers hybridSearch with the same keyword
  // path as searchCases. INTENTIONALLY NOT equal to dynamo's hybrid result — this
  // method is excluded from the dynamo ≡ mock golden checks (spec §8).
  async hybridSearch(query, filter) {
    return searchCases(caseFixtures, query, filter);
  },
```

- [ ] **Step 4: Implement on the dynamo repo (real hybrid)**

In `src/lib/cases/repo.dynamo.ts`, update the imports and add the method.

Change the `./query` import line to also import nothing new (it already imports `filterCases`), and add these imports near the top:

```ts
import { getSearchIndex } from "./search/build-index";
import { hybridRank } from "./search/hybrid";
import { getEmbedder } from "./search/embedder";
```

Add this method to the `dynamoCaseRepo` object (after `searchCases`):

```ts
  // Brute-force hybrid retrieval: BM25 + dense cosine fused by RRF(k=60), aggregated
  // to the case by max. Ranks over the whole indexed haystack, then applies the
  // post-filter (core-only by default, like browse). Degrades to BM25-only when no
  // vectors exist or the active embedder ≠ the one that wrote them (logged).
  async hybridSearch(query, filter) {
    const idx = await getSearchIndex();
    const embedder = getEmbedder();
    let queryVec = null as Float32Array | null;
    if (idx.embedderId && idx.embedderId === embedder.id) {
      queryVec = (await embedder.embed([query]))[0];
    } else if (idx.embedderId) {
      console.warn(`[hybrid] embedder mismatch active=${embedder.id} stored=${idx.embedderId} → BM25-only`);
    } else {
      console.warn(`[hybrid] no stored vectors → BM25-only`);
    }
    const ranked = hybridRank(idx.units, query, queryVec);
    const ordered = ranked
      .map((r) => idx.cases.get(r.caseId))
      .filter((c): c is LegalCase => !!c);
    return filterCases(ordered, filter); // Array.filter preserves rank order
  },
```

- [ ] **Step 5: Wire the search page**

In `src/app/cases/page.tsx`, change line 19 from:

```ts
  const cases = q ? await casesRepo.searchCases(q, filter) : await casesRepo.listCases(filter);
```

to:

```ts
  const cases = q ? await casesRepo.hybridSearch(q, filter) : await casesRepo.listCases(filter);
```

- [ ] **Step 6: Run typecheck to verify it passes**

Run: `npm run typecheck`
Expected: PASS — exit 0 (both repos now satisfy `CaseRepo`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/repo.dynamo.ts src/lib/cases/repo.mock.ts src/app/cases/page.tsx
git commit -m "feat(cases): CaseRepo.hybridSearch — dynamo hybrid, mock keyword fallback, page wired

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Verify integration + full green + final commit

**Files:**
- Modify: `scripts/verify.ts` (add a `# 5. cases hybrid retrieval` section; DO NOT touch sections 1–4 equality checks)

**Prereq:** Docker running + `npm run ddb:up` (DynamoDB Local on :8000). If `npm run verify` cannot reach `localhost:8000`, the failure is environmental (Docker), not code.

- [ ] **Step 1: Add the hybrid checks to verify.ts**

In `scripts/verify.ts`, add this import near the other cases imports (after line 25):

```ts
import { invalidateSearchIndex } from "../src/lib/cases/search/build-index";
```

Then, immediately before the final `// leave a clean, seeded state for demoing` block (line ~171), add:

```ts
  // ---- 5. cases hybrid retrieval (BM25-only path; no vectors seeded) ----
  console.log("\n# 5. cases hybrid retrieval");
  invalidateSearchIndex(); // table changed since any prior build
  const hybridHits = await dynamoCaseRepo.hybridSearch("Haida");
  check("cases: hybridSearch finds Haida (BM25-only)", hybridHits.some((c) => c.id === "haida-2004"),
    `${hybridHits.length} hits`);
  const mockHybrid = await mockCaseRepo.hybridSearch("Haida");
  check("cases: mock hybridSearch (keyword fallback) finds Haida", mockHybrid.some((c) => c.id === "haida-2004"));
  // hybridSearch is intentionally EXCLUDED from dynamo ≡ mock equality (mock has no vectors).
```

- [ ] **Step 2: Run the full verify suite**

Run: `npm run ddb:up && npm run verify`
Expected: `🎉 ALL PASS` — the prior 26 checks still pass (sections 1–4 unchanged) plus the 2 new hybrid checks. If you instead see `ECONNREFUSED 127.0.0.1:8000`, Docker/DynamoDB Local is down — start it; this is not a code failure.

- [ ] **Step 3: Run every cases unit test offline**

Run each and confirm its `✅` line:
```bash
npx tsx scripts/test-cases-pack.ts
npx tsx scripts/test-cases-bm25.ts
npx tsx scripts/test-cases-hybrid.ts
npx tsx scripts/test-cases-embedder.ts
npx tsx scripts/test-cases-chunk.ts
npx tsx scripts/test-cases-embed-helper.ts
npx tsx scripts/test-cases-fulltext.ts
```
Expected: all print their `✅ … passed` lines, no throws.

- [ ] **Step 4: Final typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: (Manual, optional — needs Docker) live stub embed + dense smoke**

```bash
npm run cases:create   # ensure table exists
npm run cases:seed     # seed fixtures (no vectors)
npm run cases:embed    # stub embeds all CHUNK items → vec/embedderId written
```
Then in a scratch script confirm `getSearchIndex()` reports a non-null `embedderId` and `hybridSearch("title")` returns ranked cases via the dense path. (Not part of automated verify because seeded fixtures may have few chunks; the offline stub end-to-end in Task 6 already exercises the dense path deterministically.)

- [ ] **Step 6: Commit**

```bash
git add scripts/verify.ts
git commit -m "test(cases): verify hybridSearch BM25-only path; exclude from dynamo≡mock

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (each spec section → task):**
- §1 retrieval-sized chunking → Task 5. Pluggable embedder → Task 4. Vector storage (Binary on CHUNK) → pack (Task 1) + embed pass (Task 7). Embed pass → Task 7. Hybrid retrieval → Tasks 2/3. In-memory index cache → Task 6. Seam (`hybridSearch`, mock fallback, page) → Task 8. ✓
- §1 Definition of Done → Task 9 (verify green, offline units, BM25-only degrade, embedder-consistency guard implemented in Task 8 + logged). ✓
- §2 chunking (no overlap, 256 KB backstop, re-chunk operationally) → Task 5 + the operational note in `cases-embed.ts` header (run after fetch). ✓
- §3 embedder (stub id stamped, real seam throws until configured, consistency guard) → Task 4 + guard in Task 8. ✓
- §4 Binary attr, not Number-list, ~4 KB, matrix in memory → Task 1 + Task 6/7. ✓
- §5 embed pass (scan missing/stale, batch ≤25, flush, resumable, logs id) → Task 7. ✓
- §6 BM25 (k1/b, legal tokens) + dense cosine + RRF(k=60) + max-per-case + filter reuse + determinism → Tasks 2/3/8. ✓
- §7 one scan builds both, cached, never per query, invalidate → Task 6. ✓
- §8 components + golden-test exclusion → Tasks 1–8 + Task 9 exclusion note. ✓
- §9 testing (every listed pure unit + golden + live) → Tasks 1–7 tests + Task 9. ✓
- §10 additive/contract-first, idempotent, no outbound fetch, governance, instrument count → Tasks 7/8 (the embed log includes counts; vector total is observable via the embed pass output). ✓
- §11 open questions are deferred decisions, not plan work. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to". Every code step shows complete code. The real `ProviderEmbedder.embed` throws by design (mirrors `llm.ts callProvider`) — that is a documented seam, not a placeholder; the default path (stub) is fully implemented and tested.

**Type consistency:** `RetrievalUnit`/`HybridResult` defined in `hybrid.ts` (Task 3), imported by `build-index.ts` (Task 6) and `repo.dynamo.ts` (Task 8). `packF32`/`unpackF32` (Task 1) used by `build-index.ts` + `cases-embed.ts`. `Embedder.id`/`.dim`/`.embed` (Task 4) used by `cases-embed.ts` + `repo.dynamo.ts`. `getSearchIndex`/`invalidateSearchIndex`/`assembleUnits` (Task 6) used by `repo.dynamo.ts` + `verify.ts`. `metaText` (Task 3) used by `build-index.ts`. `TARGET_CHUNK_BYTES` exported from `a2aj.ts` (Task 5) used by its test. `needsEmbed` (Task 7) used by its test. `hybridSearch(query, filter)` signature identical across interface (Task 8 Step 1), mock, dynamo, and the page call. Names consistent throughout.
