// Draws known_item queries from the corpus rather than from memory.
//
// A known-item query is a citation or party name whose correct answer is one specific case, so it
// must be a string that actually resolves here. Hardcoding famous case names risks queries with no
// relevant case in the corpus: those score 0 for every system, drag the layer mean down uniformly,
// and look like a retrieval failure rather than a query-set defect.
//
// Ops-only, run once. Its output is pasted into eval-queries.ts and committed — the query set is
// versioned on purpose, so it must not be regenerated at eval time.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { seededShuffle } from "../src/lib/cases/caseqa-eval/rng";

const SEED = Number(process.env.EVAL_SEED ?? 1);
const WANT = Number(process.env.DRAW_KNOWN ?? 11);

// Already in the query set; drawing them again would shrink the layer without saying so.
const TAKEN = ["2014 SCC 44", "2004 SCC 73", "Delgamuukw", "Sparrow", "Guerin", "Mikisew Cree"];

// The party-name half of a style of cause: "X v. Y" -> "X". Bare enough to be a real lookup, not
// so bare it matches everything.
function partyName(styleOfCause: string): string | null {
  const left = styleOfCause.split(/\s+v\.?\s+/i)[0]?.trim() ?? "";
  // Strip parties that name a Crown or government rather than a specific litigant. The first
  // version stopped at R / Regina / The Queen / His Majesty / Her Majesty and let
  // "British Columbia (Ministry of Forests)" through — which matches FOUR cases in this corpus,
  // so it is a topical query wearing the known_item label. The layer's premise is that one exact
  // string names one case and BM25 must win on it; a party the Crown uses in a quarter of the
  // docket does not test that.
  const cleaned = left.replace(
    /^(R|Regina|The Queen|His Majesty|Her Majesty|Canada|British Columbia|Ontario|Alberta|Saskatchewan|Manitoba|Quebec|Yukon|Northwest Territories|Nunavut|Attorney General|Minister)\b.*/i,
    "",
  ).trim();
  return cleaned.length >= 6 && cleaned.length <= 60 ? cleaned : null;
}

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const cases = [];
  for (const p of profiles) {
    const c = await dynamoCaseRepo.getCase(p.id);
    if (c) cases.push(c);
  }
  console.log(`corpus: ${cases.length} core case(s)`);

  const drawn: { query: string; caseId: string; kind: "citation" | "party" }[] = [];
  for (const c of seededShuffle(cases, SEED)) {
    if (drawn.length >= WANT) break;
    // Alternate so the layer is not all citations: citation queries are pure lexical, party-name
    // queries are the harder half of the same layer.
    const wantCitation = drawn.length % 2 === 0;
    if (wantCitation && c.citation && !TAKEN.includes(c.citation)) {
      drawn.push({ query: c.citation, caseId: c.id, kind: "citation" });
      continue;
    }
    const party = partyName(c.styleOfCause ?? "");
    if (party && !TAKEN.some((t) => party.includes(t))) drawn.push({ query: party, caseId: c.id, kind: "party" });
  }

  console.log(`\ndrew ${drawn.length}/${WANT} (seed ${SEED}). Paste into eval-queries.ts:\n`);
  drawn.forEach((d, i) => {
    const qid = `known-${String(i + 7).padStart(3, "0")}`;
    console.log(`  { qid: "${qid}", query: ${JSON.stringify(d.query)}, layer: "known_item" },  // ${d.kind} → ${d.caseId}`);
  });
  if (drawn.length < WANT) console.log(`\n⚠ short by ${WANT - drawn.length} — widen the party-name filter or raise the tier.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
