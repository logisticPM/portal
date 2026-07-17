// ===========================================================================
// Task 5 — the first live end-to-end run against a REAL RAP PDF.
//
// Every measurement to date (docs/rap-extraction-findings.md, scripts/
// diag-truncation.ts) used a synthetic `.txt` fixture, which short-circuits
// pipeline.bedrock.ts's loadDocumentText on the `.txt` extension and BYPASSES
// TEXTRACT ENTIRELY. This script drives the real chunked pipeline
// (runExtractionBedrock) against a real multi-page PDF: real OCR, real page
// numbers, real RAP prose — the thing nothing so far has actually exercised.
//
// Ground truth for the target document (verified by hand, not the model):
// 17 pages, 22 forward-looking commitments ("Some key actions:" bullets) —
// 12 on page 13, 10 on page 15. The document ALSO contains 17 past-achievement
// bullets on p7/p8 that are NOT commitments; a model that scoops those up too
// would over-count against 22 for a defensible reason. This script reports the
// number and the page distribution and lets a human judge — it does not
// hardcode pass/fail on exactly 22.
//
// Safety: read-only. runExtractionBedrock (src/lib/rap/pipeline.bedrock.ts)
// never touches extractionRepo/rapRepo itself — it only calls Textract +
// Bedrock and returns an ExtractionResult in memory — so there is nothing here
// to write to a table. As defense in depth (mirroring the REPO_IMPL mock
// pattern used by scripts/finish-extraction.ts and scripts/make-test-job.ts,
// where REPO_IMPL=dynamo is what turns those scripts live), this script
// refuses to run if REPO_IMPL=dynamo is set in its environment — the intended
// invocation leaves REPO_IMPL unset, which defaults src/lib/rap's repo exports
// to the in-memory mock. No S3 object is uploaded, deleted, or modified: the
// only S3 call in the pipeline is Textract's StartDocumentAnalysis reading the
// existing object, plus GetDocumentAnalysis polling.
//
// Run (see .superpowers/sdd/task-5-brief.md Step 2):
//   AWS_PROFILE=isb BEDROCK_REGION=ca-central-1 \
//     RAP_UPLOAD_BUCKET=indigenomics-portal-ca-rapuploadsbucket-bbhvotne \
//     SMOKE_KEY=test/BankOfCanada_RAP.pdf \
//     npx tsx scripts/smoke-extract-bedrock.ts
// ===========================================================================
import { runExtractionBedrock } from "../src/lib/rap/pipeline.bedrock";
import type { ExtractedCommitment, ExtractedRap, Grounded } from "../src/lib/rap/types";

const EXPECTED_COMMITMENTS = 22;
const EXPECTED_PAGES = 17;

function basename(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1];
}

function truncate(s: string | null, n: number): string {
  if (s === null) return "(null)";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// The 7 grounded fields on ExtractedCommitment — walked generically so a
// schema change to the shape doesn't silently drop a field from the report.
const COMMITMENT_GROUNDED_FIELDS = [
  "pillarRaw",
  "action",
  "deliverable",
  "timeline",
  "owner",
  "metric",
  "commitmentType",
] as const;

// The header's grounded fields, printed in schema order. (pillarNormalized
// lives on ExtractedCommitment, not the header, and is handled separately
// below — it's a plain `Pillar | null`, not a Grounded<T>, so it must not be
// reported as satisfying a quote/page contract it was never given.)
const HEADER_GROUNDED_FIELDS = [
  "orgName",
  "sector",
  "jurisdiction",
  "rapTitle",
  "publicationDate",
  "periodCovered",
  "frameworkRefs",
  "governanceBody",
  "reviewCycle",
  "rapType",
  "pairLevel",
  "endorsementStatus",
] as const;

function isGrounded(v: unknown): v is Grounded<unknown> {
  return typeof v === "object" && v !== null && "value" in v && "quote" in v && "page" in v;
}

async function main() {
  const smokeKey = process.env.SMOKE_KEY;
  if (!smokeKey) {
    throw new Error("SMOKE_KEY env required (the S3 key of the real PDF to run against)");
  }
  if (/\.txt$/i.test(smokeKey)) {
    throw new Error(
      `SMOKE_KEY="${smokeKey}" is a .txt file. .txt bypasses Textract entirely ` +
        `(loadDocumentText short-circuits on the .txt extension) and would silently ` +
        `defeat the entire point of this script, which is to prove the real OCR path. ` +
        `Point SMOKE_KEY at a .pdf.`,
    );
  }
  if (!/\.pdf$/i.test(smokeKey)) {
    throw new Error(`SMOKE_KEY="${smokeKey}" is not a .pdf — this script only smoke-tests the PDF/Textract path.`);
  }
  if (process.env.REPO_IMPL === "dynamo") {
    throw new Error(
      "REPO_IMPL=dynamo is set. This script is read-only and must not run against a live table " +
        "(runExtractionBedrock itself never touches extractionRepo/rapRepo, but this is a hard " +
        "guard against the env being wired wrong). Unset REPO_IMPL and re-run.",
    );
  }

  const fileName = basename(smokeKey);
  const region = process.env.BEDROCK_REGION ?? "ca-central-1";

  console.log("=== smoke-extract-bedrock ===");
  console.log(`fileName:        ${fileName}`);
  console.log(`sourceS3Key:     ${smokeKey}`);
  console.log(`RAP_UPLOAD_BUCKET: ${process.env.RAP_UPLOAD_BUCKET ?? "(unset)"}`);
  console.log(`BEDROCK_REGION:  ${region} (pipeline.bedrock.ts resolves its region from this env var)`);
  console.log(`AWS_PROFILE:     ${process.env.AWS_PROFILE ?? "(unset)"}`);
  console.log("");

  const t0 = Date.now();
  let result: Awaited<ReturnType<typeof runExtractionBedrock>>;
  try {
    result = await runExtractionBedrock({ fileName, sourceS3Key: smokeKey });
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`\n--- EXTRACTION THREW after ${elapsed}s ---`);
    console.error(e);
    process.exit(1);
    return;
  }
  const elapsedSecs = (Date.now() - t0) / 1000;

  const extracted: ExtractedRap = result.extracted;
  const commitments: ExtractedCommitment[] = extracted.commitments ?? [];

  console.log(`--- RESULT (${elapsedSecs.toFixed(1)}s wall-clock) ---`);
  console.log(`engine:         ${result.engine}`);
  console.log(`schemaVersion:  ${result.schemaVersion}`);
  console.log(`classification: ${JSON.stringify(result.classification)}`);
  console.log("");

  // ---- header fields --------------------------------------------------
  console.log("--- header fields ---");
  const header = extracted as unknown as Record<string, unknown>;
  for (const key of HEADER_GROUNDED_FIELDS) {
    const g = header[key];
    if (!isGrounded(g)) {
      console.log(`  ${key}: (missing / not a Grounded field on the returned object)`);
      continue;
    }
    console.log(
      `  ${key}: value=${JSON.stringify(g.value)} page=${g.page} confidence=${g.confidence} flagged=${g.flagged} quote="${truncate(g.quote as string | null, 80)}"`,
    );
  }
  // pillars is DERIVED from the commitments (classify.ts derivePillars), not
  // extracted — it is a summary, so it has no verbatim span to ground. Printed
  // separately for that reason: it is not a Grounded field and must not be
  // reported as satisfying a quote/page contract it was never given.
  console.log(`derived pillars (from the commitments, not the model): ${JSON.stringify(extracted.pillars)}`);
  console.log("");

  // ---- commitments: counts + grounding contract ------------------------
  const total = commitments.length;
  console.log(`--- commitments ---`);
  console.log(`total commitments: ${total} (ground truth for this document: ${EXPECTED_COMMITMENTS} forward-looking ` +
    `"Some key actions:" bullets, 12 on p13 + 10 on p15; the doc also has 17 NON-commitment past-achievement ` +
    `bullets on p7/p8 that a model may legitimately also pick up — judge, don't hardcode)`);

  if (total === 0) {
    console.error("\n--- FAILURE: zero commitments returned ---");
    process.exit(1);
    return;
  }

  // Grounding contract, field-by-field across every commitment: a field
  // counts as satisfying the contract when quote != null AND page != null.
  // (pillarNormalized is excluded — it is not a Grounded<T> field.)
  let fieldInstances = 0;
  let fieldContractOk = 0;
  const perFieldOk: Record<string, number> = {};
  for (const c of commitments) {
    for (const key of COMMITMENT_GROUNDED_FIELDS) {
      const g = (c as unknown as Record<string, unknown>)[key];
      fieldInstances++;
      if (isGrounded(g) && g.quote !== null && g.page !== null) {
        fieldContractOk++;
        perFieldOk[key] = (perFieldOk[key] ?? 0) + 1;
      }
    }
  }
  console.log(
    `grounding contract (quote!=null && page!=null), across all ${COMMITMENT_GROUNDED_FIELDS.length} grounded ` +
      `fields x ${total} commitments = ${fieldInstances} instances: ${fieldContractOk}/${fieldInstances} satisfy it`,
  );
  console.log(`  per-field breakdown: ${JSON.stringify(perFieldOk)}`);

  // Same contract, but per-commitment on the primary "action" field only —
  // the field that best stands in for "this commitment is grounded at all".
  const actionOk = commitments.filter((c) => c.action.quote !== null && c.action.page !== null).length;
  console.log(`commitments whose action field alone satisfies quote+page: ${actionOk}/${total}`);

  // Commitments where EVERY grounded field satisfies the contract.
  const fullyGroundedCount = commitments.filter((c) =>
    COMMITMENT_GROUNDED_FIELDS.every((key) => {
      const g = (c as unknown as Record<string, unknown>)[key];
      return isGrounded(g) && g.quote !== null && g.page !== null;
    }),
  ).length;
  console.log(`commitments fully grounded on ALL ${COMMITMENT_GROUNDED_FIELDS.length} fields: ${fullyGroundedCount}/${total}`);
  console.log("");

  // ---- page distribution -------------------------------------------------
  const pageCounts = new Map<string, number>();
  for (const c of commitments) {
    const p = c.action.page === null ? "null" : String(c.action.page);
    pageCounts.set(p, (pageCounts.get(p) ?? 0) + 1);
  }
  const sortedPages = [...pageCounts.entries()].sort((a, b) => {
    const an = a[0] === "null" ? Infinity : Number(a[0]);
    const bn = b[0] === "null" ? Infinity : Number(b[0]);
    return an - bn;
  });
  console.log(`--- page distribution (by commitment.action.page; document is ${EXPECTED_PAGES} pages) ---`);
  for (const [page, count] of sortedPages) {
    console.log(`  page ${page}: ${count}`);
  }
  const outOfRange = commitments.filter(
    (c) => c.action.page !== null && (c.action.page < 1 || c.action.page > EXPECTED_PAGES),
  );
  const nullPages = commitments.filter((c) => c.action.page === null).length;
  console.log(`pages outside 1-${EXPECTED_PAGES}: ${outOfRange.length}${outOfRange.length ? ` (pages: ${outOfRange.map((c) => c.action.page).join(", ")})` : ""}`);
  console.log(`commitments with null action.page: ${nullPages}`);
  const allSamePage = sortedPages.length === 1 && sortedPages[0][0] !== "null";
  console.log(`all commitments on a single page (suspicious — likely a page-number hallucination): ${allSamePage}`);
  console.log("");

  // ---- validation issues --------------------------------------------------
  console.log(`--- validationIssues (${result.validationIssues.length}) ---`);
  for (const issue of result.validationIssues) {
    console.log(`  [${issue.rule}] ${issue.path}: ${issue.message}`);
  }
  if (result.validationIssues.length === 0) console.log("  (none)");
  console.log("");

  console.log(`--- verdicts (${result.verdicts.length}) ---`);
  console.log(result.verdicts.length === 0 ? "  (none — LLM-as-judge second pass not wired up yet, per pipeline.bedrock.ts TODO)" : JSON.stringify(result.verdicts, null, 2));
  console.log("");

  // ---- sample commitments, for a human to actually read -------------------
  console.log("--- sample commitments (first 5, plus 2 evenly spaced through the rest) ---");
  const sampleIdx = new Set<number>();
  for (let i = 0; i < Math.min(5, total); i++) sampleIdx.add(i);
  if (total > 5) {
    sampleIdx.add(Math.floor(total / 2));
    sampleIdx.add(total - 1);
  }
  for (const i of [...sampleIdx].sort((a, b) => a - b)) {
    const c = commitments[i];
    console.log(`  [${i}] action.value="${c.action.value}"`);
    console.log(`       action.page=${c.action.page} action.confidence=${c.action.confidence} action.flagged=${c.action.flagged}`);
    console.log(`       action.quote="${truncate(c.action.quote, 140)}"`);
    console.log(`       pillarRaw="${c.pillarRaw.value}" pillarNormalized="${c.pillarNormalized}" commitmentType="${c.commitmentType.value}"`);
  }
  console.log("");

  // ---- what this interface cannot tell us ----------------------------------
  console.log("--- NOT observable from runExtractionBedrock's return type (honest omission, not fabricated) ---");
  console.log("  chunk count: not returned — mergeExtraction/runExtractionBedrock discard chunk boundaries after merging");
  console.log("  per-chunk stop_reason: not returned — internal to extractChunkCommitments/callTool, not surfaced");
  console.log("  per-chunk output tokens: not returned — the stream loop in callTool never captures `usage` at all");
  console.log("  (per the task brief: do not refactor the pipeline or reimplement chunking here to get these)");
  console.log("");

  console.log(`=== DONE in ${elapsedSecs.toFixed(1)}s — ${total} commitments, ${actionOk}/${total} grounded (action field), region=${region} ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
