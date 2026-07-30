// quantize.ts unit tests. Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { toBinary, toInt8, hamming, dotInt8, BITS_PER_BYTE } from "../src/lib/cases/search/quantize";
import { dot } from "../src/lib/cases/search/hybrid";
import { buildArtifacts, loadArtifacts, parseVectorsBuffer, VECTORS_KEY, VECTORS_FORMAT_VERSION } from "../src/lib/cases/search/artifact";
import type { RetrievalUnit } from "../src/lib/cases/search/hybrid";
import type { LegalCase } from "../src/lib/cases/types";

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
  //
  // The corpus MUST be clustered. An i.i.d.-uniform random corpus is not a valid test bed for
  // quantization and we measured why: at 1024 dims, pairwise cosines of random unit vectors
  // concentrate near 0 (sd ≈ 1/√1024 ≈ 0.031), so the "true top-10" are separated by ~0.003 —
  // far below any quantizer's resolution. Measured on such a corpus: int8 rescoring over the FULL
  // corpus (no binary stage at all) reaches only Recall@10 0.8480, and the whole pipeline 0.8120.
  // That is the test asking the quantizer to resolve differences finer than its own precision,
  // which is both impossible and irrelevant to how it is used. Real text embeddings cluster —
  // related passages score 0.4–0.9 — so the rank-to-rank gaps the quantizer must preserve are an
  // order of magnitude larger. This corpus mimics that geometry.
  // NOISE scales a random UNIT noise direction, not each component. Getting this wrong makes the
  // corpus unclustered: a component of a 1024-d unit vector is only ~±0.031, so per-component
  // noise of ±0.5 would swamp the centre ~16× and reproduce the flat i.i.d. case exactly. With a
  // unit noise direction, cos(v, centre) ≈ 1/√(1+NOISE²) ≈ 0.80 and cluster-mates land ≈ 0.64 —
  // the 0.4–0.9 range real text embeddings occupy.
  const DIM = 1024, N = 2000, Q = 50, RESCORE = 200, CLUSTERS = 100, NOISE = 0.75;
  const centers = Array.from({ length: CLUSTERS }, () => unit(DIM, rnd));
  const clustered = (): Float32Array => {
    const c = centers[Math.min(CLUSTERS - 1, Math.floor(rnd() * CLUSTERS))];
    const noise = unit(DIM, rnd);
    const v = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) v[i] = c[i] + NOISE * noise[i];
    let n = 0; for (let i = 0; i < DIM; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1; for (let i = 0; i < DIM; i++) v[i] /= n;
    return v;
  };
  const corpus = Array.from({ length: N }, clustered);
  const binBlock = new Uint8Array(N * (DIM / 8));
  const i8Block = new Int8Array(N * DIM);
  corpus.forEach((c, i) => { binBlock.set(toBinary(c), i * (DIM / 8)); i8Block.set(toInt8(c), i * DIM); });

  let hits = 0, total = 0, hitsInt8Full = 0, coverage = 0;
  for (let t = 0; t < Q; t++) {
    const query = clustered();
    const exactRanked = corpus.map((c, i) => ({ i, s: dot(query, c) })).sort((x, y) => y.s - x.s);
    const exact = exactRanked.slice(0, 10).map((r) => r.i);
    const qb = toBinary(query), qi2 = toInt8(query);
    const byHam = Array.from({ length: N }, (_, i) => ({ i, d: hamming(qb, 0, binBlock, i * (DIM / 8), DIM / 8) }))
      .sort((x, y) => x.d - y.d);
    const head = byHam.slice(0, RESCORE);
    coverage += exact.filter((i) => head.some((h) => h.i === i)).length;
    const rescored = head.map(({ i }) => ({ i, s: dotInt8(qi2, i8Block, i * DIM, DIM) }))
      .sort((x, y) => y.s - x.s).slice(0, 10).map((r) => r.i);
    hits += exact.filter((i) => rescored.includes(i)).length;
    total += exact.length;
    // int8 over the whole corpus — the ceiling the two-stage pipeline is allowed to cost against.
    const int8Full = corpus.map((_, i) => ({ i, s: dotInt8(qi2, i8Block, i * DIM, DIM) }))
      .sort((x, y) => y.s - x.s).slice(0, 10).map((r) => r.i);
    hitsInt8Full += exact.filter((i) => int8Full.includes(i)).length;
  }
  const recall10 = hits / total;
  const recallInt8Full = hitsInt8Full / total;
  console.log(`   synthetic Recall@10 (binary+int8 rescore vs exact float32) = ${recall10.toFixed(4)}`);
  console.log(`   · int8-over-full-corpus ceiling = ${recallInt8Full.toFixed(4)} · binary top-${RESCORE} coverage of true top-10 = ${(coverage / total).toFixed(4)}`);
  // The binary candidate stage must cost almost nothing relative to scoring every vector with
  // int8 — that is the property the two-stage design rests on, and it is harder to game than an
  // absolute number.
  assert.ok(recall10 >= recallInt8Full - 0.02,
    `binary candidate generation must not lose recall vs int8-over-everything (${recall10.toFixed(4)} vs ${recallInt8Full.toFixed(4)})`);
  // A loose floor only — enough to catch a gross bug (wrong bit order, wrong row offsets, sign
  // error), not a quality gate. The ABSOLUTE Recall@10 ≥ 0.95 gate deliberately lives in
  // scripts/cases-quant-eval.ts, measured on REAL corpus vectors, because the absolute number here
  // is a function of a cluster geometry this test invents: with 20 members per cluster, true ranks
  // 10 and 11 are both cluster-mates differing by ~0.005 cosine, which is again near the
  // quantizer's resolution floor. Measured here: 0.9320, exactly equal to the int8-over-everything
  // ceiling, with binary top-200 coverage 1.0000 — i.e. the two-stage design costs nothing and the
  // residual is inherent int8 error. CONSEQUENCE FOR THE REAL GATE: if cases-quant-eval also lands
  // near 0.93, raising DENSE_RESCORE_N will NOT help (coverage is already perfect) — the fix is a
  // finer rescoring tier (int8 resident, or fetch true float32 for the top-50 from DynamoDB).
  assert.ok(recall10 >= 0.85, `sanity floor: Recall@10 ${recall10.toFixed(4)} is low enough to indicate a bug, not quantization error`);

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

  console.log("✅ test-cases-quantize passed");
})().catch((e) => { console.error(e); process.exit(1); });
