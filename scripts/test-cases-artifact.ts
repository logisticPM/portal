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

  // buildId mismatch: bm25 from build A + vectors from build B → dense silently off
  // (warn, no throw), BM25 unaffected — honest degradation, never corrupt fusion.
  const buildA = buildArtifacts({ units, cases, embedderId: "stub-hash-v1", vdim: 4 });
  const buildB = buildArtifacts({ units, cases, embedderId: "stub-hash-v1", vdim: 4 });
  assert.notEqual(buildA.buildId, buildB.buildId, "two builds must get distinct buildIds");
  const mixed = loadArtifacts(buildA.bm25, buildB.vectors);
  assert.deepEqual(mixed.searcher.denseRank(vec(1, 0)), [], "buildId mismatch → empty dense list");
  assert.deepEqual(rankWithSearcher(mixed.searcher, "duty to consult", null), rankWithSearcher(mem, "duty to consult", null), "buildId mismatch must not affect bm25");

  // truncation: a short buffer must throw, never load zero-filled garbage
  assert.throws(() => loadArtifacts(Buffer.from(built.bm25.subarray(0, built.bm25.length - 1))), /truncated artifact/);

  console.log("✅ artifact roundtrip (bm25 + vectors + profiles + metadata)");
})().catch((e) => { console.error(e); process.exit(1); });
