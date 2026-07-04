# Search-Index Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix production search 504: prebuild the search index into binary artifacts on S3 (inverted BM25 + profiles; vectors separate), loaded once per Lambda instead of a 43k-item table scan; per-query BM25 drops from ~2.7 s to ms.

**Architecture:** New pure `inverted.ts` (BM25-identical scoring over a prebuilt inverted index) and `artifact.ts` (binary codec). `hybrid.ts` refactors to a `Searcher` interface but `hybridRank(units, …)` keeps its signature as a thin wrapper — existing tests/eval unchanged (parity by construction). `getSearchIndex()` gains artifact sources (INDEX_FILE / INDEX_BUCKET) with full-scan fallback. Build script `cases:index-build` runs at pipeline end. SST adds a linked bucket + 2048 MB server memory.

**Tech Stack:** TypeScript, Node Buffers/TypedArrays, `@aws-sdk/client-s3` (already a dependency), tsx standalone tests (`node:assert/strict`, async IIFE), DynamoDB Local for integration.

Spec: `docs/specs/2026-07-03-search-index-artifact-design.md`.

**Hard requirement (applies to every task): BM25 ranking parity.** The inverted scorer must produce bit-identical scores and order to `search/bm25.ts` (same k1=1.2/b=0.75, same `log(1+(N-df+0.5)/(df+0.5))` idf, same score-desc/id-asc tie-break, and the **same float accumulation order**: per doc, terms added in deduped first-appearance query order). Published eval numbers depend on this.

Conventions: repo is NOT ESM (async-IIFE tests); ALWAYS run `npm run typecheck`; never touch `searchCases`/storage/mock.

---

### Task 1: `inverted.ts` — inverted index + BM25-identical scoring

**Files:**
- Create: `src/lib/cases/search/inverted.ts`
- Create: `scripts/test-cases-inverted.ts`

- [ ] **Step 1: Write the failing parity test**

Create `scripts/test-cases-inverted.ts`:

```ts
// Parity: the inverted-index BM25 must rank IDENTICALLY (score + order) to the
// reference Bm25 class — the published eval numbers depend on it.
import assert from "node:assert/strict";
import { Bm25, tokenize } from "../src/lib/cases/search/bm25";
import { buildInverted, scoreInverted } from "../src/lib/cases/search/inverted";

const DOCS = [
  { id: "a#meta", text: "Haida Nation v British Columbia duty to consult forestry tenure" },
  { id: "b#meta", text: "Tsilhqotin Nation aboriginal title declared over claim area" },
  { id: "c#chunk#1", text: "the duty to consult arises when the Crown has knowledge of the asserted right" },
  { id: "d#chunk#1", text: "the duty to consult arises when the Crown has knowledge of the asserted right" }, // tie with c
  { id: "e#chunk#2", text: "fisheries revenue sharing agreement between the nation and canada" },
];

const tokenized = DOCS.map((d) => ({ id: d.id, tokens: tokenize(d.text) }));
const reference = new Bm25(tokenized);
const inv = buildInverted(tokenized);

const QUERIES = [
  "duty to consult",
  "aboriginal title",
  "revenue sharing",
  "crown knowledge asserted",
  "consult consult duty",      // duplicate query terms (dedup path)
  "nonexistent zzz term",      // no hits
  "",                          // empty query
  "the",                       // stopword-ish, present in several docs
];

(async () => {
  for (const q of QUERIES) {
    const want = reference.search(tokenize(q));
    const got = scoreInverted(inv, tokenize(q));
    assert.deepEqual(
      got.map((r) => ({ id: r.id, score: r.score })),
      want.map((r) => ({ id: r.id, score: r.score })),
      `parity failed for query "${q}"`,
    );
  }
  // tie-break sanity: c and d have identical text → equal scores, id asc
  const tie = scoreInverted(inv, tokenize("duty to consult"));
  const ci = tie.findIndex((r) => r.id === "c#chunk#1");
  const di = tie.findIndex((r) => r.id === "d#chunk#1");
  assert.ok(ci >= 0 && di === ci + 1, "tied docs must sort id-asc adjacent");
  console.log("✅ inverted BM25 parity (scores + order, incl. ties)");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-cases-inverted.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/search/inverted'`.

- [ ] **Step 3: Implement `inverted.ts`**

Create `src/lib/cases/search/inverted.ts`:

```ts
// Inverted-index BM25 with EXACT parity to ./bm25.ts (same constants, same idf,
// same tie-break, same float accumulation order). A query touches only its own
// terms' postings lists → ms-level scoring instead of an O(corpus) pass per query.
// Built once (at artifact build or index load), reused for every query.

export interface InvertedIndex {
  ids: string[];              // docIdx → id
  n: number;
  avgdl: number;
  docLen: Uint32Array;        // per docIdx
  terms: Map<string, { df: number; start: number }>; // start = pair offset into postings
  postings: Uint32Array;      // packed pairs (docIdx, tf), grouped per term
}

export function buildInverted(docs: { id: string; tokens: string[] }[]): InvertedIndex {
  const ids = docs.map((d) => d.id);
  const docLen = new Uint32Array(docs.length);
  let total = 0;
  // term → Map<docIdx, tf>, built in first-appearance order (Map preserves insertion)
  const acc = new Map<string, Map<number, number>>();
  docs.forEach((d, i) => {
    docLen[i] = d.tokens.length;
    total += d.tokens.length;
    for (const t of d.tokens) {
      let m = acc.get(t);
      if (!m) acc.set(t, (m = new Map()));
      m.set(i, (m.get(i) ?? 0) + 1);
    }
  });
  let pairs = 0;
  for (const m of acc.values()) pairs += m.size;
  const postings = new Uint32Array(pairs * 2);
  const terms = new Map<string, { df: number; start: number }>();
  let cursor = 0;
  for (const [t, m] of acc) {
    terms.set(t, { df: m.size, start: cursor });
    for (const [docIdx, tf] of m) { postings[cursor * 2] = docIdx; postings[cursor * 2 + 1] = tf; cursor++; }
  }
  return { ids, n: docs.length, avgdl: docs.length ? total / docs.length : 0, docLen, terms, postings };
}

// Identical math to Bm25.search: idf = log(1+(N-df+0.5)/(df+0.5)); per-doc score
// accumulated in deduped first-appearance query-term order (float-order parity).
export function scoreInverted(idx: InvertedIndex, queryTokens: string[], k1 = 1.2, b = 0.75): { id: string; score: number }[] {
  if (!queryTokens.length) return [];
  const q = [...new Set(queryTokens)].filter((t) => idx.terms.has(t));
  const scores = new Map<number, number>(); // docIdx → score (insertion order irrelevant to result)
  for (const term of q) {
    const { df, start } = idx.terms.get(term)!;
    const idf = Math.log(1 + (idx.n - df + 0.5) / (df + 0.5));
    for (let p = start; p < start + df; p++) {
      const docIdx = idx.postings[p * 2];
      const f = idx.postings[p * 2 + 1];
      const dl = idx.docLen[docIdx];
      const denom = f + k1 * (1 - b + (b * dl) / (idx.avgdl || 1));
      scores.set(docIdx, (scores.get(docIdx) ?? 0) + idf * ((f * (k1 + 1)) / denom));
    }
  }
  const out: { id: string; score: number }[] = [];
  for (const [docIdx, score] of scores) if (score > 0) out.push({ id: idx.ids[docIdx], score });
  return out.sort((a, b2) => b2.score - a.score || a.id.localeCompare(b2.id));
}
```

**Float-order note for the implementer:** the reference iterates, per doc, the deduped
query terms in first-appearance order and adds each term's contribution. Here we iterate
terms in the same order and add into the doc's accumulator — every doc receives the same
additions in the same order, so sums are bit-identical.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/test-cases-inverted.ts` — Expected: `✅ inverted BM25 parity …`.

- [ ] **Step 5: Typecheck + commit**

`npm run typecheck` clean, then:
```bash
git add src/lib/cases/search/inverted.ts scripts/test-cases-inverted.ts
git commit -m "feat(cases): inverted-index BM25 with exact parity to the reference scorer"
```

---

### Task 2: `Searcher` seam in `hybrid.ts` (signature-compatible refactor)

**Files:**
- Modify: `src/lib/cases/search/hybrid.ts`
- Modify: `scripts/test-cases-hybrid.ts` (add one wrapper-equivalence assertion; existing assertions unchanged)

- [ ] **Step 1: Add the failing test**

In `scripts/test-cases-hybrid.ts`, add (near the other imports / after existing tests; keep everything already there):

```ts
import { makeInMemorySearcher, rankWithSearcher } from "../src/lib/cases/search/hybrid";
// wrapper equivalence: hybridRank(units,…) ≡ rankWithSearcher(makeInMemorySearcher(units),…)
{
  const viaWrapper = hybridRank(units, "consultation duty", null);
  const viaSearcher = rankWithSearcher(makeInMemorySearcher(units), "consultation duty", null);
  assert.deepEqual(viaSearcher, viaWrapper, "searcher path must equal wrapper path");
}
```

Run: `npx tsx scripts/test-cases-hybrid.ts` — Expected: FAIL (exports don't exist).

- [ ] **Step 2: Refactor `hybrid.ts`**

Keep `rrf`, `dot`, `metaText`, types unchanged. Replace the `hybridRank` implementation with:

```ts
// Pluggable search backend: the in-memory impl is built from RetrievalUnits (scan
// fallback, tests, eval); the artifact impl (see ./artifact.ts) is loaded from a
// prebuilt binary. hybridRank keeps its signature as a thin wrapper so existing
// callers/tests/eval are unchanged — which enforces ranking parity by construction.
import { buildInverted, scoreInverted, type InvertedIndex } from "./inverted";

export interface Searcher {
  bm25Rank(query: string): { id: string }[];             // pre-sorted
  denseRank(queryVec: Float32Array): { id: string }[];   // pre-sorted; [] when no usable vectors
  caseOf(unitId: string): string | undefined;
}

export function makeInMemorySearcher(units: RetrievalUnit[]): Searcher {
  const inv: InvertedIndex = buildInverted(units.map((u) => ({ id: u.unitId, tokens: tokenize(u.text) })));
  const unitCase = new Map(units.map((u) => [u.unitId, u.caseId]));
  return {
    bm25Rank: (query) => scoreInverted(inv, tokenize(query)).map((r) => ({ id: r.id })),
    denseRank: (queryVec) =>
      units
        .filter((u) => u.vec && u.vec.length === queryVec.length)
        .map((u) => ({ id: u.unitId, score: dot(queryVec, u.vec!) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map((r) => ({ id: r.id })),
    caseOf: (unitId) => unitCase.get(unitId),
  };
}

export function rankWithSearcher(s: Searcher, query: string, queryVec: Float32Array | null, k = 60): HybridResult[] {
  const lists: { id: string }[][] = [s.bm25Rank(query)];
  if (queryVec) lists.push(s.denseRank(queryVec));
  const fused = rrf(lists, k);
  const byCase = new Map<string, number>();
  for (const [unitId, score] of fused) {
    const caseId = s.caseOf(unitId);
    if (!caseId) continue;
    byCase.set(caseId, Math.max(byCase.get(caseId) ?? 0, score));
  }
  return [...byCase.entries()]
    .map(([caseId, score]) => ({ caseId, score }))
    .sort((a, b) => b.score - a.score || a.caseId.localeCompare(b.caseId));
}

export function hybridRank(units: RetrievalUnit[], query: string, queryVec: Float32Array | null, k = 60): HybridResult[] {
  return rankWithSearcher(makeInMemorySearcher(units), query, queryVec, k);
}
```

(The old direct `Bm25` usage inside hybridRank is replaced by the parity-locked inverted
scorer; `bm25.ts` remains the reference implementation used by the parity test.)

- [ ] **Step 3: Verify all existing search tests + eval-core tests still green**

Run: `npx tsx scripts/test-cases-hybrid.ts && npx tsx scripts/test-cases-route.ts && npx tsx scripts/test-cases-retrieval.ts && npx tsx scripts/test-cases-inverted.ts`
Expected: all ✅ (hybrid test includes the new equivalence assertion).

- [ ] **Step 4: Typecheck + commit**

`npm run typecheck` clean, then:
```bash
git add src/lib/cases/search/hybrid.ts scripts/test-cases-hybrid.ts
git commit -m "refactor(cases): Searcher seam in hybrid ranking (hybridRank stays signature-compatible)"
```

---

### Task 3: `artifact.ts` — binary codec + roundtrip test

**Files:**
- Create: `src/lib/cases/search/artifact.ts`
- Create: `scripts/test-cases-artifact.ts`

- [ ] **Step 1: Write the failing roundtrip test**

Create `scripts/test-cases-artifact.ts`:

```ts
// Roundtrip: build artifacts from units+cases → load → rankings identical to the
// in-memory searcher, profiles hydrate identically, embedder metadata preserved.
import assert from "node:assert/strict";
import { makeInMemorySearcher, rankWithSearcher, type RetrievalUnit } from "../src/lib/cases/search/hybrid";
import { buildArtifacts, loadArtifacts } from "../src/lib/cases/search/artifact";
import type { LegalCase } from "../src/lib/cases/types";

const mkCase = (id: string, styleOfCause: string): LegalCase => ({ id, styleOfCause } as LegalCase);
const cases = new Map<string, LegalCase>([
  ["haida", mkCase("haida", "Haida Nation v. British Columbia")],
  ["tsil", mkCase("tsil", "Tsilhqot'in Nation v. British Columbia")],
]);
const vec = (a: number, b: number) => { const v = new Float32Array(4); v[0] = a; v[1] = b; const n = Math.hypot(a, b) || 1; v[0] /= n; v[1] /= n; return v; };
const units: RetrievalUnit[] = [
  { unitId: "haida#meta", caseId: "haida", text: "Haida Nation duty to consult forestry" },
  { unitId: "haida#chunk#1", caseId: "haida", text: "the crown must consult before disposition", vec: vec(1, 0) },
  { unitId: "tsil#meta", caseId: "tsil", text: "Tsilhqotin aboriginal title claim area" },
  { unitId: "tsil#chunk#1", caseId: "tsil", text: "title declared over the claim area", vec: vec(0, 1) },
];

(async () => {
  const built = buildArtifacts({ units, cases, embedderId: "stub-hash-v1", vdim: 4 });
  const loaded = loadArtifacts(built.bm25, built.vectors);

  assert.equal(loaded.embedderId, "stub-hash-v1");
  assert.equal(loaded.vdim, 4);
  assert.equal(loaded.cases.size, 2);
  assert.equal(loaded.cases.get("haida")!.styleOfCause, "Haida Nation v. British Columbia");

  const mem = makeInMemorySearcher(units);
  for (const q of ["duty to consult", "aboriginal title", "claim area", "zzz"]) {
    assert.deepEqual(rankWithSearcher(loaded.searcher, q, null), rankWithSearcher(mem, q, null), `bm25 roundtrip "${q}"`);
    const qv = vec(0.7, 0.7);
    assert.deepEqual(rankWithSearcher(loaded.searcher, q, qv), rankWithSearcher(mem, q, qv), `hybrid roundtrip "${q}"`);
  }

  // bm25-only load (no vectors buffer): dense list must be empty, bm25 still identical
  const lonly = loadArtifacts(built.bm25);
  assert.deepEqual(lonly.searcher.denseRank(vec(1, 0)), [], "no vectors → empty dense list");
  assert.deepEqual(rankWithSearcher(lonly.searcher, "duty to consult", null), rankWithSearcher(mem, "duty to consult", null));

  console.log("✅ artifact roundtrip (bm25 + vectors + profiles + metadata)");
})().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/test-cases-artifact.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `artifact.ts`**

Create `src/lib/cases/search/artifact.ts`:

```ts
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

function unpack(buf: Buffer): { header: any; section: (name: string) => Uint8Array } {
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error("bad artifact magic");
  const hlen = buf.readUInt32LE(4);
  const secStart = buf.readUInt32LE(8);
  const header = JSON.parse(buf.subarray(12, 12 + hlen).toString("utf8"));
  return {
    header,
    section: (name) => {
      const s = header.sections[name];
      if (!s) throw new Error(`missing section ${name}`);
      const abs = secStart + s[0];
      const copy = new Uint8Array(s[1]);
      copy.set(buf.subarray(abs, abs + s[1]));
      return copy;
    },
  };
}

const toU32 = (b: Uint8Array) => new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
const toF32 = (b: Uint8Array) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
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
    ids, n: a.header.n, avgdl: a.header.avgdl,
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
      vdim = v.header.vdim;
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
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx tsx scripts/test-cases-artifact.ts` — Expected: `✅ artifact roundtrip …`.

- [ ] **Step 4: Typecheck + commit**

`npm run typecheck` clean, then:
```bash
git add src/lib/cases/search/artifact.ts scripts/test-cases-artifact.ts
git commit -m "feat(cases): binary search-index artifact codec (bm25 + vectors, roundtrip-tested)"
```

---

### Task 4: `cases:index-build` script (local file / S3 upload)

**Files:**
- Create: `scripts/cases-index-build.ts`
- Modify: `package.json` (two npm scripts)

- [ ] **Step 1: Implement the build script**

Create `scripts/cases-index-build.ts`:

```ts
// Build the search-index artifacts from the CURRENT table (run at pipeline end —
// after ingest / fetch-fulltext / embed / promote). Writes local files always;
// uploads to S3 when INDEX_BUCKET is set. Spec 2026-07-03.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSearchIndex } from "../src/lib/cases/search/build-index";
import { buildArtifacts } from "../src/lib/cases/search/artifact";

const OUT_DIR = path.join(process.cwd(), "scripts", ".cache", "index");
export const BM25_KEY = `cases-index/v1/bm25.bin`;
export const VECTORS_KEY = `cases-index/v1/vectors.bin`;

async function main() {
  // Guard against circularity: the builder must ALWAYS scan the table, never load a
  // previously-built artifact (INDEX_FILE/INDEX_BUCKET may be exported in the shell).
  // Remember the upload target, then clear both envs before getSearchIndex runs.
  const bucket = process.env.INDEX_BUCKET;
  delete process.env.INDEX_FILE;
  delete process.env.INDEX_BUCKET;
  const idx = await getSearchIndex(true); // force a fresh scan — artifact must reflect the table NOW
  const { bm25, vectors, buildId } = buildArtifacts({ units: idx.units, cases: idx.cases, embedderId: idx.embedderId, vdim: idx.vdim });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "bm25.bin"), bm25);
  if (vectors) await fs.writeFile(path.join(OUT_DIR, "vectors.bin"), vectors);
  console.log(`✅ built artifacts buildId=${buildId} · bm25=${(bm25.length / 1e6).toFixed(1)}MB · vectors=${vectors ? (vectors.length / 1e6).toFixed(1) + "MB" : "none"} → ${OUT_DIR}`);

  if (bucket) {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: BM25_KEY, Body: bm25 }));
    if (vectors) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: VECTORS_KEY, Body: vectors }));
    console.log(`✅ uploaded to s3://${bucket}/${BM25_KEY}${vectors ? " (+vectors)" : ""}`);
  }
}
main().catch((e) => { console.error("❌ cases-index-build failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts** (in `package.json`, after the `cases:eval:*` entries):

```json
"cases:index-build": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases tsx scripts/cases-index-build.ts",
"cases:index-build:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases tsx scripts/cases-index-build.ts",
```

- [ ] **Step 3: Run locally over the real corpus** (needs DynamoDB Local + full corpus + vectors)

Run: `npm run cases:index-build`
Expected: `✅ built artifacts … bm25=~60-100MB · vectors=~160MB` (sizes are estimates; record actuals). Takes ~1 min (one forced scan).

- [ ] **Step 4: Typecheck + commit**

`npm run typecheck` clean, then:
```bash
git add scripts/cases-index-build.ts package.json
git commit -m "feat(cases): cases:index-build — build + optionally upload search artifacts"
```

---

### Task 5: artifact-backed `getSearchIndex` + `hybridSearch` via Searcher

**Files:**
- Modify: `src/lib/cases/search/build-index.ts`
- Modify: `src/lib/cases/repo.dynamo.ts` (hybridSearch: `hybridRank` → `rankWithSearcher(idx.searcher, …)`)
- Create: `scripts/test-cases-index-load.ts` (integration; needs the Task-4 artifacts on disk)

- [ ] **Step 1: Extend `SearchIndex` + loader in `build-index.ts`**

Changes to `src/lib/cases/search/build-index.ts`:
1. Import: `import { makeInMemorySearcher, type Searcher } from "./hybrid";` and `import { loadArtifacts } from "./artifact";` and `import { promises as fs } from "node:fs";`
2. Extend the interface:
```ts
export interface SearchIndex {
  units: RetrievalUnit[];        // empty when artifact-backed (units are baked in)
  cases: Map<string, LegalCase>;
  embedderId: string | null;
  vdim: number | null;
  searcher: Searcher;            // ALWAYS present: artifact-backed or built from units
  source: "artifact" | "scan";
}
```
3. In `getSearchIndex(force = false)`, before the scan path, try artifact sources:
```ts
  // Artifact sources (spec 2026-07-03): INDEX_FILE dir (local) or INDEX_BUCKET (S3).
  // Any failure falls through to the scan path — degradation, never breakage.
  const fileDir = (process.env.INDEX_FILE ?? "").trim();
  const bucket = (process.env.INDEX_BUCKET ?? "").trim();
  if (fileDir || bucket) {
    try {
      let bm25: Buffer, vectors: Buffer | null = null;
      if (fileDir) {
        bm25 = await fs.readFile(`${fileDir}/bm25.bin`);
        vectors = await fs.readFile(`${fileDir}/vectors.bin`).catch(() => null);
      } else {
        const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
        const s3 = new S3Client({});
        const get = async (Key: string) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key }))).Body!.transformToByteArray());
        bm25 = await get("cases-index/v1/bm25.bin");
        vectors = await get("cases-index/v1/vectors.bin").catch(() => null);
      }
      const loaded = loadArtifacts(bm25, vectors);
      cached = { units: [], cases: loaded.cases, embedderId: loaded.embedderId, vdim: loaded.vdim, searcher: loaded.searcher, source: "artifact" };
      console.log(`[index] artifact loaded (buildId=${loaded.buildId}, cases=${loaded.cases.size})`);
      return cached;
    } catch (e) {
      console.warn(`[index] artifact load failed (${(e as Error).message}) → falling back to table scan`);
    }
  }
```
4. Scan path: after assembling units, set `cached = { units, cases, embedderId, vdim, searcher: makeInMemorySearcher(units), source: "scan" }` — the memoized searcher also fixes the ~2.7 s/query cost on the fallback path.

- [ ] **Step 2: Switch `hybridSearch` to the searcher**

In `src/lib/cases/repo.dynamo.ts`: import `rankWithSearcher` instead of `hybridRank`; replace
`const ranked = hybridRank(idx.units, query, queryVec);` with
`const ranked = rankWithSearcher(idx.searcher, query, queryVec);`
(`routeQuery(query, idx)` is unchanged — `idx.cases` is populated in both modes; the
profile hydration below the ranking loop stays exactly as-is.)

- [ ] **Step 3: Integration test**

Create `scripts/test-cases-index-load.ts`:

```ts
// Integration (needs Task-4 artifacts in scripts/.cache/index and the full local
// corpus in DynamoDB Local): artifact-backed index ranks EXACTLY like the scan-built
// index, and loads fast.
import assert from "node:assert/strict";
process.env.INDEX_FILE = "scripts/.cache/index";
import { getSearchIndex, invalidateSearchIndex } from "../src/lib/cases/search/build-index";
import { rankWithSearcher } from "../src/lib/cases/search/hybrid";

(async () => {
  const t0 = Date.now();
  const art = await getSearchIndex(true);
  const loadMs = Date.now() - t0;
  assert.equal(art.source, "artifact");
  assert.ok(art.cases.size > 3000, `artifact cases ${art.cases.size}`);

  const t1 = Date.now();
  const r1 = rankWithSearcher(art.searcher, "duty to consult", null);
  const queryMs = Date.now() - t1;
  assert.ok(r1.length > 100, "bm25 results over real corpus");

  process.env.INDEX_FILE = "";
  invalidateSearchIndex();
  const scan = await getSearchIndex(true);
  assert.equal(scan.source, "scan");
  for (const q of ["duty to consult", "2014 SCC 44", "aboriginal title", "treaty annuities"]) {
    assert.deepEqual(
      rankWithSearcher(art.searcher, q, null).slice(0, 50),
      rankWithSearcher(scan.searcher, q, null).slice(0, 50),
      `artifact≡scan for "${q}"`,
    );
  }
  console.log(`✅ index-load: artifact≡scan · load=${loadMs}ms · query=${queryMs}ms`);
})().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/test-cases-index-load.ts`
Expected: `✅ index-load: artifact≡scan · load=<few thousand>ms · query=<double-digit>ms` — record both numbers (success criteria: load ≤ ~5 s, query ≤ ~50 ms).

- [ ] **Step 4: Full regression + typecheck + commit**

Run: `npx tsx scripts/test-cases-hybrid.ts && npx tsx scripts/test-cases-route.ts && npx tsx scripts/test-cases-inverted.ts && npx tsx scripts/test-cases-artifact.ts && npm run typecheck`
Then `npm run verify` (NOTE: resets the corpus to fixtures — reload afterwards with `npm run cases:ingest && npm run cases:fetch-fulltext`, and remember re-chunking drops vectors).
Expected: all green, verify 35/0.

```bash
git add src/lib/cases/search/build-index.ts src/lib/cases/repo.dynamo.ts scripts/test-cases-index-load.ts
git commit -m "feat(cases): artifact-backed search index with scan fallback; hybridSearch via Searcher"
```

---

### Task 6: SST wiring + deploy + production verification

**Files:**
- Modify: `sst.config.ts`

- [ ] **Step 1: Provision the bucket + env + memory**

In `sst.config.ts`:
1. Near the other buckets: `const casesIndex = new sst.aws.Bucket("CasesIndex");`
2. Web app `link:` — add `casesIndex`.
3. Web `environment:` — add:
```ts
        // Search-index artifacts (spec 2026-07-03): prebuilt bm25/vectors objects the
        // server loads once per instance instead of scanning the table (prod 504 fix).
        INDEX_BUCKET: casesIndex.name,
```
4. Web `transform.server` — add `memory: "2048 MB",` (artifact resident + faster CPU).

- [ ] **Step 2: Typecheck + commit + push + PR**

`npm run typecheck`, then commit:
```bash
git add sst.config.ts
git commit -m "feat(cases): CasesIndex bucket + INDEX_BUCKET env + 2048MB server (search 504 fix)"
```
Push the branch and open the PR to main (controller/user merges; merge auto-deploys via deploy.yml).

- [ ] **Step 3: Upload artifacts to the prod bucket (after deploy; needs user AWS creds)**

Get the generated bucket name (SDK, no aws CLI locally):
```bash
node --input-type=module -e 'import{S3Client,ListBucketsCommand}from"@aws-sdk/client-s3";const s=new S3Client({region:"us-east-1"});const r=await s.send(new ListBucketsCommand({}));console.log(r.Buckets.map(b=>b.Name).filter(n=>/casesindex/i.test(n)).join("\n"));'
```
Then upload from the CLOUD table (so the artifact matches prod data):
```bash
INDEX_BUCKET=<bucket-name> npm run cases:index-build:cloud
```

- [ ] **Step 4: Verify production search**

```bash
curl -s -o /dev/null -w "HTTP %{http_code} %{time_total}s\n" --max-time 60 -b "portal_session=indigenomics" "https://d1hwn8hhp1ytc0.cloudfront.net/cases?q=duty+to+consult"
```
Expected: **HTTP 200** (was 504) — cold < ~8 s, repeat call < ~1-2 s. Also verify a
known-item query (`?q=2014+SCC+44`) returns 200 and a browse page still renders.
Record before/after in the spec's Result section, commit the doc update.

---

## Notes for the implementer

- Tasks 1–3 are pure/offline. Task 4–5 need the full local corpus (+vectors for the
  vectors artifact). Task 6 needs the user's AWS creds + PR merge.
- NEVER modify `bm25.ts` (reference implementation), `searchCases`, storage, or the mock.
- The float-order parity note in Task 1 is load-bearing — do not "optimize" the
  accumulation order.
- `npm run verify` resets the local corpus; reload + re-embed before rebuilding artifacts.
