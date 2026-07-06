// ===========================================================================
// The extraction CONTRACT between the AI and our ExtractedRap shape.
//
//   • CLAUDE_TOOL          — a tool-use input_schema that FORCES Claude on
//                            Bedrock to return schema-valid, GROUNDED JSON
//                            (every field carries value + quote + page +
//                            confidence). Forcing tool use is what makes the
//                            output parse-safe and the grounding mandatory.
//   • EXTRACTION_SYSTEM     — the rule set: locate & quote, never invent; no
//                            quote ⇒ value null; never compute, only extract.
//
// The same field list is what a Bedrock Data Automation blueprint would encode;
// BDA returns confidence natively, so for the BDA path you map its output into
// the same Grounded<T> shape instead of using this tool schema.
// ===========================================================================
import type { CommitmentType, FrameworkRef, Jurisdiction, PairLevel, Pillar, Sector } from "./types";

export const SECTORS: Sector[] = [
  "mining_extractive", "finance_banking", "telecom", "energy", "government", "retail", "transport", "other",
];
export const PILLARS: Pillar[] = [
  "relationships", "respect", "opportunities", "governance", "employment", "community", "environment", "economy", "education", "other",
];
export const COMMITMENT_TYPES: CommitmentType[] = [
  "procurement", "employment", "education_training", "cultural_awareness", "community_investment", "governance", "environmental", "partnership", "other",
];
const FRAMEWORK_REFS: FrameworkRef[] = ["undrip", "trc_cta_92", "ocap", "pair", "other"];
const JURISDICTIONS: Jurisdiction[] = ["AU", "CA", "other"];
const RAP_TYPES = ["reflect", "innovate", "stretch", "elevate"];
const PAIR_LEVELS: PairLevel[] = ["committed", "bronze", "silver", "gold"];

// A grounded field: the value plus the verbatim span proving it. `value` and
// `quote` are nullable; the prompt requires quote=null ⇒ value=null.
const grounded = (valueSchema: object) => ({
  type: "object",
  properties: {
    value: { ...valueSchema, description: "the extracted value, or null if not stated in the document" },
    quote: { type: ["string", "null"], description: "verbatim text span from the document supporting the value; null if not found" },
    page: { type: ["integer", "null"], description: "1-indexed page the quote appears on" },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "0..1 how certain the extraction is" },
  },
  required: ["value", "quote", "page", "confidence"],
  additionalProperties: false,
});

const gString = grounded({ type: ["string", "null"] });
const gEnum = (values: string[]) => grounded({ type: ["string", "null"], enum: [...values, null] });

export const EXTRACTION_TOOL_NAME = "record_rap_extraction";

export const CLAUDE_TOOL = {
  name: EXTRACTION_TOOL_NAME,
  description: "Record the structured fields extracted from a Reconciliation Action Plan document.",
  input_schema: {
    type: "object",
    properties: {
      orgName: gString,
      sector: gEnum(SECTORS),
      jurisdiction: gEnum(JURISDICTIONS),
      rapTitle: gString,
      publicationDate: gString, // ISO 8601 if determinable
      periodCovered: grounded({
        type: ["object", "null"],
        properties: { start: { type: "string" }, end: { type: "string" } },
        required: ["start", "end"],
      }),
      frameworkRefs: grounded({ type: ["array", "null"], items: { type: "string", enum: FRAMEWORK_REFS } }),
      pillars: grounded({ type: ["array", "null"], items: { type: "string", enum: PILLARS } }),
      governanceBody: gString,
      reviewCycle: gString,
      rapType: gEnum(RAP_TYPES),
      pairLevel: gEnum(PAIR_LEVELS),
      endorsementStatus: gString,
      commitments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pillarRaw: gString,
            pillarNormalized: { type: ["string", "null"], enum: [...PILLARS, null] },
            action: gString,
            deliverable: gString,
            timeline: gString,
            owner: gString,
            metric: gString,
            commitmentType: gEnum(COMMITMENT_TYPES),
          },
          required: ["pillarRaw", "pillarNormalized", "action", "deliverable", "timeline", "owner", "metric", "commitmentType"],
          additionalProperties: false,
        },
      },
      extras: {
        type: "array",
        description: "fields found in the document that don't map to any field above — do not force-fit",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            quote: { type: "string" },
            page: { type: ["integer", "null"] },
          },
          required: ["label", "value", "quote", "page"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "orgName", "sector", "jurisdiction", "rapTitle", "publicationDate", "periodCovered",
      "frameworkRefs", "pillars", "governanceBody", "reviewCycle", "rapType", "pairLevel",
      "endorsementStatus", "commitments", "extras",
    ],
    additionalProperties: false,
  },
} as const;

export const EXTRACTION_SYSTEM = `You extract structured data from Reconciliation Action Plan (RAP) documents.

Rules — follow exactly:
1. LOCATE AND QUOTE. For every field, return the verbatim text span ("quote") you took the value from, plus its page. You are transcribing, not summarizing.
2. NO QUOTE ⇒ NO VALUE. If you cannot find a supporting span, set quote=null AND value=null. Never guess, infer, or recall from outside the document.
3. NEVER COMPUTE. Do not add, total, average, or convert. Copy the figure as written (e.g. "$1.8 billion"); downstream code parses numbers.
4. NORMALIZE THEMES. Map each commitment's own pillar wording (pillarRaw) onto the closest canonical pillar (pillarNormalized). Keep the original wording in pillarRaw.
5. USE EXTRAS. Anything meaningful that doesn't fit a defined field goes in "extras" with its own quote — do not force it into an unrelated field.
6. CALIBRATE confidence honestly (0..1): high only when the span unambiguously states the value.

Call the ${EXTRACTION_TOOL_NAME} tool exactly once with your result.`;
