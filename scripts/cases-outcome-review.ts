// Read-only. Compresses every classified case to one reviewable line: the model's
// verdict beside the disposition sentence it should have come from. Reviewing 561
// of these in one pass is what makes full coverage (rather than a sample) feasible —
// the AGREED rows are the ones that feed a published count, and correlated model
// error is exactly what a sample would miss.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { dispositionSentence } from "../src/lib/cases/ingest/outcome-rubric";

const ONLY = process.env.REVIEW_WINTYPE; // optional filter, e.g. party_win

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  let shown = 0, noSentence = 0;

  for (const prof of profiles) {
    if (prof.outcomeMeta?.method !== "dual_llm") continue;
    if (ONLY && prof.outcome.winType !== ONLY) continue;
    const c = await dynamoCaseRepo.getCase(prof.id);
    const s = c?.chunks ? dispositionSentence(c.chunks) : null;
    if (!s) noSentence++;
    console.log([
      prof.id.padEnd(20),
      prof.outcome.winType.padEnd(13),
      (prof.outcomeMeta.confidence ?? "?").padEnd(5),
      s ? `"${s.slice(0, 150)}"` : "(no disposition sentence found)",
    ].join(" "));
    shown++;
  }
  console.log(`\n${shown} reviewed · ${noSentence} with no disposition sentence (read these first)`);
}
main().catch((e) => { console.error("❌ cases-outcome-review failed:", e); process.exit(1); });
