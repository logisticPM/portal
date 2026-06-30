import assert from "node:assert/strict";
import { rrf, dot, metaText, hybridRank, type RetrievalUnit } from "../src/lib/cases/search/hybrid";
import { assembleUnits } from "../src/lib/cases/search/build-index";
import { StubEmbedder } from "../src/lib/cases/search/embedder";

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

// --- assembleUnits: one meta unit per case + one chunk unit per chunk ---
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

// --- stub end-to-end: embed unit texts + query, dense path exercised (async → IIFE) ---
(async () => {
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
  console.log("✅ hybrid + index-assembly tests passed");
})().catch((e) => { console.error("❌ test failed:", e); process.exit(1); });
