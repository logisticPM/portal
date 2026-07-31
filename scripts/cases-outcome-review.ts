// Read-only. One reviewable line per classified case: the label beside the reasoning
// that produced it, so a reviewer can check the polarity without opening the judgment.
// Replaces the old disposition-sentence extraction, which was unreliable — it returned
// "I granted Mr." for one real case, the sentence splitter breaking on the abbreviation.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { impliedDirection } from "../src/lib/cases/ingest/outcome-rubric";

const ONLY = process.env.REVIEW_WINTYPE;

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  let shown = 0, noDerivation = 0, flagged = 0;

  for (const prof of profiles) {
    const meta = prof.outcomeMeta;
    if (meta?.method !== "dual_llm") continue;
    if (ONLY && prof.outcome.winType !== ONLY) continue;
    const der = prof.outcome.derivation;
    if (!der) noDerivation++;
    if (meta.needsReview) flagged++;
    console.log([
      prof.id.padEnd(20),
      prof.outcome.winType.padEnd(13),
      (meta.confidence ?? "?").padEnd(5),
      meta.needsReview ? "REVIEW" : "      ",
      der
        ? `moving=${der.movingPartyIsIndigenous ? "nation" : "other "} ${der.granted.padEnd(8)} => ${impliedDirection(der)}`
        : "(no agreed derivation)",
      prof.styleOfCause.slice(0, 46),
    ].join(" "));
    shown++;
  }
  console.log(`\n${shown} reviewed · ${flagged} flagged needsReview · ${noDerivation} without an agreed derivation`);
  console.log(`Read the flagged ones first: a label whose implied direction reads wrong is the bug this run exists to find.`);
}
main().catch((e) => { console.error("❌ cases-outcome-review failed:", e); process.exit(1); });
