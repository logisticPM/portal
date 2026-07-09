// ===========================================================================
// pipeline.mock — STAND-IN for the real extraction pipeline (Bedrock Data
// Automation / Textract→Claude). Returns a deterministic ExtractionResult so
// the upload → review → publish flow and the dashboard can be built and demoed
// WITHOUT calling AWS. Step 2 of the build plan replaces this with the real
// BDA blueprint / Claude tool-use call behind the SAME signature.
//
// Two canned outputs keyed off the file name so the demo can show BOTH paths:
//   • a CLEAN extraction  → auto-publishes (no human)
//   • a FLAGGED extraction → lands in the review queue
// ===========================================================================
import type { ExtractionResult, Grounded, PairLevel, RapType } from "./types";
import { RAP_SCHEMA_VERSION } from "./types";

// small helper to build a grounded field
function g<T>(value: T | null, quote: string | null, page: number | null, confidence: number): Grounded<T> {
  return { value, quote, page, confidence, flagged: confidence < 0.85 || (value !== null && quote === null) };
}

// A high-confidence, fully-grounded extraction (RBC-style finance RAP).
function cleanResult(): ExtractionResult {
  return {
    engine: "bda",
    schemaVersion: RAP_SCHEMA_VERSION,
    classification: { jurisdiction: "CA", sector: "finance", rapType: null, confidence: 0.96 },
    extracted: {
      orgName: g("Royal Bank of Canada", "Royal Bank of Canada (RBC)", 1, 0.99),
      sector: g("finance", "financial services", 2, 0.97),
      jurisdiction: g("CA", "Canada", 1, 0.99),
      rapTitle: g("Pathways to Economic Prosperity", "Pathways to Economic Prosperity", 1, 0.98),
      publicationDate: g("2025-06-20", "June 2025", 1, 0.92),
      periodCovered: g({ start: "2025-01-01", end: "2027-12-31" }, "2025–2027", 3, 0.9),
      frameworkRefs: g(["trc_cta_92", "undrip"], "Call to Action 92 ... UNDRIP", 4, 0.94),
      pillars: g(["economy", "employment", "community", "environment", "governance"], "five pathways", 5, 0.95),
      governanceBody: g("Indigenous Advisory Council", "Indigenous Advisory Council", 6, 0.93),
      reviewCycle: g("biennial", "reviewed every two years", 6, 0.91),
      rapType: g<RapType>(null, null, null, 0.5),
      pairLevel: g<PairLevel>(null, null, null, 0.5),
      endorsementStatus: g<string>(null, null, null, 0.5),
      commitments: [
        {
          pillarRaw: g("Economy", "Economy", 7, 0.96),
          pillarNormalized: "economy",
          action: g("Increase procurement from Indigenous-owned businesses", "increase spend with Indigenous-owned suppliers", 7, 0.95),
          deliverable: g("Grow annual Indigenous procurement spend", "grow our annual procurement spend", 7, 0.92),
          timeline: g("2027", "by 2027", 7, 0.9),
          owner: g("Chief Procurement Officer", "Chief Procurement Officer", 7, 0.88),
          metric: g("$100M", "$100 million annually", 7, 0.9),
          commitmentType: g("procurement", "procurement", 7, 0.97),
        },
      ],
      sectorFields: {
        finance: {
          capitalCommitment: g(1_000_000_000, "$1 billion in capital", 8, 0.9),
          financialLiteracyPrograms: g("Indigenous financial literacy program", "financial literacy programming", 8, 0.88),
        },
      },
      extras: [],
    },
    validationIssues: [],
    verdicts: [],
  };
}

// A lower-confidence extraction with a flagged field + a validation issue, to
// exercise the human-review path.
function flaggedResult(): ExtractionResult {
  return {
    engine: "textract+claude",
    schemaVersion: RAP_SCHEMA_VERSION,
    classification: { jurisdiction: "CA", sector: "telecom", rapType: null, confidence: 0.81 },
    extracted: {
      orgName: g("TELUS Communications Inc.", "TELUS", 1, 0.97),
      sector: g("telecom", "telecommunications", 1, 0.95),
      jurisdiction: g("CA", "Canada", 1, 0.98),
      rapTitle: g("Indigenous Reconciliation & Connectivity Report", "Indigenous Reconciliation and Connectivity Report", 1, 0.9),
      publicationDate: g("2025-11-19", "November 2025", 1, 0.86),
      periodCovered: g({ start: "2025-01-01", end: "2025-12-31" }, "2025", 2, 0.84), // flagged (low conf)
      frameworkRefs: g(["trc_cta_92"], "Call to Action 92", 3, 0.88),
      pillars: g(["relationships", "respect", "opportunities", "governance"], "four pillars", 4, 0.9),
      governanceBody: g("Indigenous Reconciliation team", "Indigenous Reconciliation team", 5, 0.82), // flagged
      reviewCycle: g("annual", "annual report", 5, 0.9),
      rapType: g<RapType>(null, null, null, 0.5),
      pairLevel: g("silver", "PAIR Silver", 6, 0.93),
      endorsementStatus: g<string>(null, null, null, 0.5),
      commitments: [
        {
          pillarRaw: g("Opportunities", "Opportunities", 7, 0.92),
          pillarNormalized: "opportunities",
          action: g("Connect Indigenous communities to high-speed internet", "connect Indigenous lands to broadband", 7, 0.9),
          deliverable: g("Bring connectivity to Indigenous communities", "connect remaining communities", 7, 0.83), // flagged
          timeline: g("2026", "by 2026", 7, 0.88),
          owner: g<string>(null, null, null, 0.4),
          metric: g("85 communities", "85 communities", 7, 0.86),
          commitmentType: g("partnership", "connectivity partnership", 7, 0.8), // flagged
        },
      ],
      sectorFields: {
        telecom: {
          connectivityTarget: g("Indigenous lands connected to broadband", "broadband to Indigenous lands", 8, 0.87),
          communitiesConnected: g(85, "85 communities", 8, 0.86),
        },
      },
      extras: [
        { label: "land restoration", value: "500 ha (Piikani + Blood Tribe)", quote: "500 hectares restored", page: 9 },
      ],
    },
    validationIssues: [
      { path: "commitments[0].owner", rule: "no_quote", message: "owner value present but no source span" },
    ],
    verdicts: [
      { path: "governanceBody", quoteSupportsValue: true, note: null },
    ],
  };
}

// The pipeline entry point. Real build swaps the body for BDA/Claude; signature
// stays identical so actions.ts doesn't change.
export async function runExtraction(input: { fileName: string; sourceS3Key: string }): Promise<ExtractionResult> {
  return /flag|telus|review/i.test(input.fileName) ? flaggedResult() : cleanResult();
}
