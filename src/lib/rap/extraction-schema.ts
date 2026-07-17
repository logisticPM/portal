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
import { CANONICAL_SECTORS, CANONICAL_TYPES } from "@/lib/taxonomy";

export const SECTORS: Sector[] = CANONICAL_SECTORS;
export const PILLARS: Pillar[] = [
  "relationships", "respect", "opportunities", "governance", "employment", "community", "environment", "economy", "education", "other",
];
export const COMMITMENT_TYPES: CommitmentType[] = CANONICAL_TYPES;
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

// ---------------------------------------------------------------------------
// Shared field definitions. CLAUDE_TOOL (the original single-call schema) and
// the two split tools (HEADER_TOOL, COMMITMENTS_TOOL — see below) are built
// from the SAME objects, partitioned rather than retyped, so the grounded
// {value, quote, page, confidence} shape can't drift between them.
// ---------------------------------------------------------------------------

// Every ExtractedRap field except `commitments` and `extras`.
const HEADER_FIELD_PROPERTIES = {
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
} as const;

const HEADER_FIELD_REQUIRED = [
  "orgName", "sector", "jurisdiction", "rapTitle", "publicationDate", "periodCovered",
  "frameworkRefs", "pillars", "governanceBody", "reviewCycle", "rapType", "pairLevel",
  "endorsementStatus",
] as const;

// fields found in the document that don't map to any field above — do not force-fit
const EXTRAS_FIELD = {
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
} as const;

const COMMITMENTS_FIELD = {
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
} as const;

export const CLAUDE_TOOL = {
  name: EXTRACTION_TOOL_NAME,
  description: "Record the structured fields extracted from a Reconciliation Action Plan document.",
  input_schema: {
    type: "object",
    properties: {
      ...HEADER_FIELD_PROPERTIES,
      commitments: COMMITMENTS_FIELD,
      extras: EXTRAS_FIELD,
    },
    required: [
      "orgName", "sector", "jurisdiction", "rapTitle", "publicationDate", "periodCovered",
      "frameworkRefs", "pillars", "governanceBody", "reviewCycle", "rapType", "pairLevel",
      "endorsementStatus", "commitments", "extras",
    ],
    additionalProperties: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Split schemas (Task 2). The extraction pipeline dies on real documents
// because CLAUDE_TOOL forces one tool call to emit every commitment at once —
// the fix (Task 3) is one header call plus N per-chunk commitment calls. The
// header call runs over the whole document: the failure mode being fixed is
// output-token burn from large commitment arrays, and a header-only call's
// output is small regardless of how much input it reads. These two tools are
// CLAUDE_TOOL's field set partitioned, not redefined — every value keeps the
// Grounded<T> = {value, quote, page, confidence} shape.
// ---------------------------------------------------------------------------

// Widened to `string` (not inferred as a literal): HEADER_TOOL.name and
// COMMITMENTS_TOOL.name are compared for inequality (see the split-schema
// test), and TS flags that comparison as an error when both sides are
// disjoint string-literal types.
export const HEADER_TOOL_NAME: string = "record_rap_header";

export const HEADER_TOOL = {
  name: HEADER_TOOL_NAME,
  description: "Record the header-level structured fields extracted from a Reconciliation Action Plan document (everything except individual commitments).",
  input_schema: {
    type: "object",
    properties: {
      ...HEADER_FIELD_PROPERTIES,
      extras: EXTRAS_FIELD,
    },
    required: [...HEADER_FIELD_REQUIRED, "extras"],
    additionalProperties: false,
  },
} as const;

export const COMMITMENTS_TOOL_NAME: string = "record_rap_commitments";

export const COMMITMENTS_TOOL = {
  name: COMMITMENTS_TOOL_NAME,
  description: "Record the commitments extracted from a chunk of a Reconciliation Action Plan document.",
  input_schema: {
    type: "object",
    properties: {
      commitments: COMMITMENTS_FIELD,
    },
    required: ["commitments"],
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
