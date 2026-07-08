// ===========================================================================
// Alignment verification harness — `npm run verify:alignment`.
// Pure checks (score, normalize, marshaller) need no DB. Repo-parity + scenario
// sections (added in later tasks) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { cosine, structuredScore, combine } from "../src/lib/alignment/score";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
  // --- cosine ---
  check("cosine: identical vectors = 1", Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([1, 0])) - 1) < 1e-6);
  check("cosine: orthogonal = 0", Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))) < 1e-6);
  check("cosine: zero-vector = 0", cosine(new Float32Array([0, 0]), new Float32Array([1, 0])) === 0);

  // --- structured score ---
  const full = structuredScore({ sectorMatch: true, regionMatch: true, identityTier: "nation", ownershipPct: 100 });
  const none = structuredScore({ sectorMatch: false, regionMatch: false, identityTier: "self_declared", ownershipPct: 20 });
  const partial = structuredScore({ sectorMatch: true, regionMatch: false, identityTier: "ccab", ownershipPct: 80 });
  check("structured: full > partial > none", full > partial && partial > none && none >= 0);
  check("structured: full match caps at 1", full <= 1 && Math.abs(full - 1) < 1e-9);
  check("structured: sector+region+nation is high", full >= 0.8);

  // --- combine ---
  check("combine: weights structured + semantic", Math.abs(combine(1, 1) - 1) < 1e-6 && combine(0, 0) === 0);
  check("combine: monotonic in semantic", combine(0.5, 0.9) > combine(0.5, 0.1));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ verify-alignment crashed:", e);
  process.exit(1);
});
