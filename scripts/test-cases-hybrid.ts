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
