// Why are there cases WITH full text that are NOT core?
//
// Read-only diagnostic. ZERO LLM calls, zero writes. Answers phase 1 of the core-gap
// question: of the cases that have full text but sit in substrate, how many does the
// inclusion filter reject, and how many does it ACCEPT (meaning they were never labeled,
// or were labeled and the two models found no consensus).
//
// Phase 1 cannot split "labeled, no consensus" from "never labeled": LABEL_MODELS has no
// default and the cache filename is sha256(modelId + prompt), so with the model ids
// unknown the cache cannot be probed. `cases:promote` emits that split itself via PRISMA
// (`no_model_consensus`), so phase 2 is a promote run, not a smarter probe.
//
// IMPORTANT: profiles do NOT carry chunks (cases-table stores chunks as separate items),
// and includeCandidate reads chunk text. Running it on a profile would report
// "no_indigenous_signal" for every case purely because there is no text to match — the
// exact artifact that made the 2026-06-30 datasheet read core=6. So each candidate is
// re-read with getCase().
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { includeCandidate } from "../src/lib/cases/ingest/include";
import { enrichment } from "../src/lib/cases/enrichment";
import type { CourtLevel } from "../src/lib/cases/types";

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "0") + "%";

async function main() {
  const all = await dynamoCaseRepo.listCases({ tier: "all" });
  const core = all.filter((c) => c.corpusTier === "core");
  const sub = all.filter((c) => c.corpusTier !== "core");
  const coreNoText = core.filter((c) => !c.fullTextAvailable);
  const gap = sub.filter((c) => c.fullTextAvailable);
  const subNoText = sub.filter((c) => !c.fullTextAvailable);

  console.log(`corpus: ${all.length} total · core ${core.length} · substrate ${sub.length}`);
  console.log(`  core without full text:      ${coreNoText.length}  (curated flagships bypass the chunk gate)`);
  console.log(`  substrate WITHOUT full text: ${subNoText.length}  (blocked on fetch, not on the filter)`);
  console.log(`  substrate WITH full text:    ${gap.length}  ← the gap this run explains\n`);

  const reasons: Record<string, number> = {};
  const accepted: string[] = [];
  const byLevelAccepted: Partial<Record<CourtLevel, number>> = {};
  const byLevelRejected: Partial<Record<CourtLevel, number>> = {};
  const samples: Record<string, string[]> = {};
  let flagship = 0, noChunks = 0, done = 0;

  for (const prof of gap) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (++done % 200 === 0) console.log(`  … ${done}/${gap.length}`);
    if (!c) continue;
    // A flagship would have been promoted unconditionally, so finding one here means the
    // promote step never ran over it — worth separating from any filter verdict.
    if (enrichment[c.citation]) { flagship++; continue; }
    // fullTextAvailable true but no chunk items = an inconsistency between the flag and
    // the stored data, not a filter decision. Counted, never silently folded in.
    if (!c.chunks?.length) { noChunks++; continue; }

    const v = includeCandidate(c);
    if (v.include) {
      accepted.push(c.id);
      byLevelAccepted[c.level] = (byLevelAccepted[c.level] ?? 0) + 1;
    } else {
      const r = v.reason ?? "unknown";
      reasons[r] = (reasons[r] ?? 0) + 1;
      byLevelRejected[c.level] = (byLevelRejected[c.level] ?? 0) + 1;
      (samples[r] ??= []).length < 3 && samples[r].push(`${c.id}  ${c.styleOfCause.slice(0, 90)}`);
    }
  }

  const rejected = Object.values(reasons).reduce((a, b) => a + b, 0);
  console.log(`\n=== of ${gap.length} substrate cases with full text ===`);
  console.log(`  filter ACCEPTS  ${String(accepted.length).padStart(5)}  ${pct(accepted.length, gap.length)}  → never labeled, or labeled with no consensus (phase 2)`);
  console.log(`  filter REJECTS  ${String(rejected).padStart(5)}  ${pct(rejected, gap.length)}  → genuinely out of scope by the current rule`);
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${r.padEnd(24)} ${String(n).padStart(5)}`);
  }
  console.log(`  curated flagship, unpromoted ${String(flagship).padStart(4)}  (promote never ran over these)`);
  console.log(`  fullTextAvailable but 0 chunks ${String(noChunks).padStart(3)}  (flag/data inconsistency)`);

  console.log(`\n=== accepted-but-not-core, by court level (who is missing from core) ===`);
  for (const [l, n] of Object.entries(byLevelAccepted).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${l.padEnd(22)} ${String(n).padStart(5)}   (core today: ${core.filter((c) => c.level === l).length})`);
  }

  console.log(`\n=== rejected, by court level ===`);
  for (const [l, n] of Object.entries(byLevelRejected).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${l.padEnd(22)} ${String(n).padStart(5)}`);
  }

  for (const [r, ex] of Object.entries(samples)) {
    console.log(`\n### rejected: ${r}`);
    for (const s of ex) console.log(`  - ${s}`);
  }
}
main().catch((e) => { console.error("❌ cases-core-gap failed:", e); process.exit(1); });
