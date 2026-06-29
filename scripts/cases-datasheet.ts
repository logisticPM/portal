// Emits a Datasheets-for-Datasets datasheet from the current corpus + PRISMA log (spec §7).
import { promises as fs } from "node:fs";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { RUBRIC_VERSION } from "../src/lib/cases/ingest/rubric";
import { THEME_QUERIES, SEED_CITATIONS, DATE_FROM, DATE_TO } from "../src/lib/cases/ingest/sources";

async function main() {
  const core = await dynamoCaseRepo.listCases();                       // core-only
  const sub = await dynamoCaseRepo.listCases({ tier: "substrate" });
  let prisma = "{}"; try { prisma = await fs.readFile("scripts/.cache/prisma.json", "utf8"); } catch {}
  const byTheme: Record<string, number> = {};
  for (const c of core) for (const t of c.themes) byTheme[t] = (byTheme[t] ?? 0) + 1;
  const needsReview = core.filter((c) => c.labelMeta?.needsReview).length;

  const md = `# Datasheet — Indigenomics Economic Justice Legal Cases Corpus

_Generated ${new Date().toISOString().slice(0, 10)} · rubric ${RUBRIC_VERSION}_

## Motivation
Indigenous economic-justice case law made searchable + analytically actionable (Focus Area 2).

## Composition
- Core (curated, labeled): **${core.length}** · Substrate (full-text, RAG): **${sub.length}**
- By theme (core): ${JSON.stringify(byTheme)}
- Core cases flagged needs-review (LLM disagreement): **${needsReview}**

## Collection process
- Frame: **A2AJ** (api.a2aj.ca). Theme queries: ${JSON.stringify(THEME_QUERIES)}. Seeds: ${SEED_CITATIONS.length}. Window: ${DATE_FROM}–${DATE_TO}. Depth-1 forward snowball.
- PRISMA counts: ${prisma}

## ⚠️ Coverage ceiling (limitations)
A2AJ **does not scrape CanLII** and is **federal-court-skewed**; this corpus is an A2AJ-bounded slice, **not** all Canadian Indigenous economic-justice case law. Much provincial-court litigation is absent. Texts are unofficial automated copies.

## Labeling
- Themes: dual-LLM cross-labeling (only agreed labels kept; disagreements → needs-review). Inter-LLM agreement = consistency, not accuracy.
- Outcomes: only curated/flagship cases carry a real winType; others are "unclassified" (never auto-faked).

## Validation
Run \`npm run cases:validate\` against a human gold sample for per-theme P/R/F1, inter-coder kappa/PABAK, and corpus-purity Wilson CI. Absent a gold file, the corpus is **exploratory / unvalidated**.

## Uses / Distribution / Maintenance
Internal demo + analytics. Respect each record's \`upstreamLicense\` (many non-commercial). Re-run \`cases:ingest\` to refresh (idempotent).
`;
  await fs.mkdir("docs/research", { recursive: true });
  await fs.writeFile("docs/research/cases-datasheet.md", md);
  console.log("✅ wrote docs/research/cases-datasheet.md");
}
main().catch((e) => { console.error("❌ cases-datasheet failed:", e); process.exit(1); });
