// Leave-one-out fidelity measurement for the quantized artifact (spec 2026-07-30). Uses the
// corpus's OWN stored vectors as queries, so it needs NO graded relevance labels — it measures
// representation fidelity (does quantized ranking agree with exact float32?), not retrieval
// quality. That matters because our graded set is 18 queries, below the smallest topic-set size
// the IR methodology literature even simulates (25), and cannot resolve deltas under ~0.05.
//
// GATE: Recall@10 with rescoring must be >= 0.95 before dense is re-enabled in production.
// If it fails, note that raising DENSE_RESCORE_N will NOT help when binary coverage is already
// ~1.0 — the fix is a finer rescoring tier (int8 resident, or fetch true float32 for the head
// from DynamoDB, which remains the source of truth for the vectors).
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
  let scanned = 0;
  do {
    const r = await ddbDoc.send(new ScanCommand({
      TableName: TABLE, ExclusiveStartKey: start,
      ProjectionExpression: "vec", FilterExpression: "attribute_exists(vec)",
    }));
    for (const it of r.Items ?? []) if (it.vec) vecs.push(unpackF32(it.vec as Uint8Array, DIM));
    start = r.LastEvaluatedKey;
    if (vecs.length - scanned >= 20000) { scanned = vecs.length; console.log(`  scanned ${vecs.length} vectors…`); }
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
  let hitR10 = 0, hitR50 = 0, hitBinOnly = 0, coverage = 0, tot10 = 0, tot50 = 0, q = 0;
  for (let qi = 0; qi < N && q < QUERIES; qi += step, q++) {
    const query = vecs[qi];
    const exact = vecs.map((v, i) => ({ i, s: i === qi ? -Infinity : dot(query, v) }))
      .sort((x, y) => y.s - x.s);
    const gold10 = new Set(exact.slice(0, 10).map((r) => r.i));
    const gold50 = new Set(exact.slice(0, 50).map((r) => r.i));
    const qb = toBinary(query), qint = toInt8(query);
    const byHam = Array.from({ length: N }, (_, i) => ({ i, d: i === qi ? Infinity : hamming(qb, 0, bin, i * binBytes, binBytes) }))
      .sort((x, y) => x.d - y.d);
    const head = byHam.slice(0, RESCORE_N);
    coverage += head.filter((h) => gold10.has(h.i)).length;
    hitBinOnly += byHam.slice(0, 10).filter((h) => gold10.has(h.i)).length;
    const rescored = head.map(({ i }) => ({ i, s: dotInt8(qint, i8, i * DIM, DIM) }))
      .sort((x, y) => y.s - x.s);
    hitR10 += rescored.slice(0, 10).filter((r) => gold10.has(r.i)).length; tot10 += gold10.size;
    hitR50 += rescored.slice(0, 50).filter((r) => gold50.has(r.i)).length; tot50 += gold50.size;
  }
  const r10 = hitR10 / tot10, r50 = hitR50 / tot50, rBin = hitBinOnly / tot10, cov = coverage / tot10;
  console.log(`queries ${q} · rescore_n ${RESCORE_N}`);
  console.log(`  binary top-${RESCORE_N} coverage of true top-10 = ${cov.toFixed(4)}`);
  console.log(`  Recall@10 binary-only      = ${rBin.toFixed(4)}`);
  console.log(`  Recall@10 binary+int8      = ${r10.toFixed(4)}   (gate >= ${GATE})`);
  console.log(`  Recall@50 binary+int8      = ${r50.toFixed(4)}`);
  if (r10 < GATE) {
    console.error(`❌ GATE FAILED: Recall@10 ${r10.toFixed(4)} < ${GATE}.`);
    if (cov > 0.98) console.error(`   Coverage is ${cov.toFixed(4)} — raising DENSE_RESCORE_N will NOT help. Use a finer rescoring tier (int8 resident, or exact float32 for the head from DynamoDB).`);
    else console.error(`   Coverage is ${cov.toFixed(4)} — candidate generation is the bottleneck; try a larger DENSE_RESCORE_N.`);
    process.exit(1);
  }
  console.log(`✅ gate passed — safe to re-enable dense (flip BRIEF_EMBED_PROVIDER / CASES_EMBED_PROVIDER to bedrock)`);
}

main().catch((e) => { console.error("❌ cases-quant-eval failed:", e); process.exit(1); });
