// Presentation logic for the extraction review queue's validation issues.
//
// `ValidationIssue` is a flat `{path, rule, message}` with no severity or
// category (see types.ts). Rendering that list verbatim confuses reviewers: a
// single unreadable PDF (`source_text_damaged`) cascades into a dozen
// `quote_not_found` lines, and because the list is unordered the *root cause*
// renders LAST — after the reviewer has already read a dozen "quote does not
// occur in the document" alarms and assumed the AI hallucinated.
//
// This module is the display-only seam that fixes that: it classifies each rule
// as document-level vs field-level, gives each a plain-language label, and
// groups the field-level issues so N identical `quote_not_found`s collapse into
// one line. It NEVER changes what blocks auto-publish (`isClean` in publish.ts)
// or what the extractor produces — only how the reviewer sees it.
//
// Kept out of ReviewPanel.tsx so it can be unit-tested without rendering React
// (mirrors queue-view.ts). Tests: scripts/test-validation-display.ts.
import type { ExtractedRap, Grounded, ValidationIssue, ValidationRule } from "./types";
import { labelFor } from "../taxonomy";

export type IssueCategory = "document" | "field";

// The two `$document`-pathed rules describe the *document* (the extracted text
// was damaged, or too few pages carried text) and explain a cluster of
// field-level flags. Every other rule is about one specific field.
const DOCUMENT_RULES: ReadonlySet<ValidationRule> = new Set<ValidationRule>([
  "source_text_damaged",
  "low_page_coverage",
]);

export function categoryForRule(rule: ValidationRule): IssueCategory {
  return DOCUMENT_RULES.has(rule) ? "document" : "field";
}

// Short, human label per rule — the raw code (`quote_not_found`) means nothing
// to a reviewer. Unknown/reserved rules fall back to the code itself so nothing
// renders blank if the enum grows.
const RULE_LABELS: Record<ValidationRule, string> = {
  no_quote: "No supporting quote",
  quote_not_found: "The AI's quote wasn't found word-for-word",
  source_text_damaged: "Document text may be damaged",
  low_page_coverage: "Low text coverage — document may be partly scanned",
  date_format: "Unrecognized date",
  currency_format: "Unrecognized currency amount",
  out_of_range: "Value out of expected range",
  cross_field: "Timeline outside the RAP period",
};

export function plainLabel(rule: ValidationRule): string {
  return RULE_LABELS[rule] ?? rule;
}

// The document-level issues carry a raw pipeline diagnostic (e.g. character
// offsets "226, 305, …") that means nothing to a reviewer. Pull out only the
// useful signal — the count of damaged characters — and phrase what it means and
// what to do. Returns the raw message for any rule we don't specifically reword.
export function damagedCharCount(message: string): number | null {
  const m = message.match(/contains\s+(\d+)\s+unmappable/i);
  return m ? Number(m[1]) : null;
}

export function docIssueHeading(rule: ValidationRule): string {
  if (rule === "source_text_damaged") return "Some text didn't extract cleanly";
  if (rule === "low_page_coverage") return "This PDF may be partly scanned";
  return plainLabel(rule);
}

export function docIssueExplanation(issue: ValidationIssue): string {
  if (issue.rule === "source_text_damaged") {
    const n = damagedCharCount(issue.message);
    const count = n != null ? `Around ${n} character${n === 1 ? "" : "s"}` : "Some characters";
    return `${count} in this PDF didn't convert to text cleanly, because the document's embedded fonts are missing standard mappings for some symbols. The AI may well have read those spots correctly, but its quotes can't be matched exactly against the garbled text — open the PDF and check the flagged fields against what's actually on the page.`;
  }
  if (issue.rule === "low_page_coverage") {
    return "Only a few pages of this PDF had text the system could read, so it may be a scanned or image-based document. Anything the AI missed might simply live in the pages that didn't extract — open the PDF to check directly.";
  }
  return issue.message;
}

// A bare path like `commitments[34].pillarRaw` tells a reviewer nothing about
// what to check or where. Resolve it back to the extracted field so the UI can
// show the value the AI read, the quote it cited, and the page — the actual
// starting point for a manual check.
export interface ResolvedField {
  label: string; // human label, e.g. "Commitment 35 · Pillar"
  g: Grounded<unknown>; // the extracted field (value / quote / page / flagged)
  page: number | null; // convenience mirror of g.page (the PDF anchor)
  displayValue: string; // human-readable value (enum labels, framework names, joined lists)
}

// Full framework names with the acronym in parentheses — reviewers shouldn't
// have to decode "undrip"/"pair". frameworkRefs is the only enum-array field.
export const FRAMEWORK_LABELS: Record<string, string> = {
  undrip: "UN Declaration on the Rights of Indigenous Peoples (UNDRIP)",
  trc_cta_92: "Truth & Reconciliation Commission Call to Action 92 (TRC CtA 92)",
  ocap: "Ownership, Control, Access & Possession (OCAP®)",
  pair: "Partnership Accreditation in Indigenous Relations (PAIR)",
  other: "Other framework",
};

// Plain-language explanations for the review page's terse markers, surfaced as
// hover/focus tooltips (see components/InfoTip). Keyed by marker, not by field —
// the same "no source span" copy explains that marker wherever it appears (the
// server ExtractedView and the client FlaggedFieldsEditor both import this).
export const MARKER_HELP: Record<string, string> = {
  noSourceSpan:
    "The AI gave a value but didn't cite a specific sentence in the document. This is normal for the BDA engine, which grounds fields by confidence rather than a verbatim quote — open the source PDF and check the value against the page yourself.",
  reviewFlag:
    "The percentage is the engine's confidence in this field. “review” means it fell below the auto-publish threshold, so a person should confirm the value before it publishes.",
  periodCovered:
    "The reporting period the RAP covers (start → end). An empty value means the AI couldn't find start and end dates in the document — enter them if the document states a period, or leave it blank if the RAP is genuinely open-ended.",
  engine:
    "Which extraction engine read this document. “bda” is Amazon Bedrock Data Automation (the production engine); it grounds fields by confidence, and source quotes are recovered afterwards by matching the AI's values back to the document's text.",
  needsBusinessNumber:
    "This document can't be published until its organization is resolved to a 9-digit Business Number (below) — that's the identity the published record is keyed to.",
};

// One-line explanation per validation rule, for the group-heading tooltips.
// Complements groupHint() in ReviewPanel (which only covers quote_not_found).
export const RULE_HELP: Partial<Record<ValidationRule, string>> = {
  date_format:
    "The AI's value couldn't be read as a calendar date. Enter a real date if the document states one, or confirm it's an open-ended timeline (e.g. “ongoing”) and verify it as-is.",
  quote_not_found:
    "The AI's supporting quote didn't match the document text word-for-word — usually a light paraphrase, an inferred value, or damaged text, not a fabrication. Open the PDF to confirm.",
  no_quote:
    "The AI gave a value but no supporting quote from the document. Locate the value in the source PDF before trusting it.",
  currency_format:
    "The AI's value couldn't be read as a currency amount. Check the figure against the document.",
  out_of_range:
    "The value is outside the range expected for this field. Confirm it against the document.",
  cross_field:
    "This commitment's timeline falls outside the RAP's stated reporting period. Check whether the date or the period is wrong.",
};

// Render a field's value the way a reviewer reads it, not the way it's stored:
// enum codes → curated labels, framework codes → full names, lists → joined.
// Falls back to String()/JSON so nothing renders blank.
function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  // periodCovered is an object {start, end}; JSON.stringify'd it read as the
  // reviewer-hostile `{"start":"","end":""}`. Render it as a span, and say
  // plainly when the AI found no period at all.
  if (key === "periodCovered" && typeof value === "object") {
    const { start, end } = value as { start?: string; end?: string };
    if (!start && !end) return "— (no reporting period found)";
    return `${start || "?"} → ${end || "?"}`;
  }
  if (key === "frameworkRefs" && Array.isArray(value)) {
    return value.map((f) => FRAMEWORK_LABELS[String(f)] ?? String(f)).join(", ");
  }
  if (key === "sector" || key === "commitmentType") return labelFor(key, String(value));
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Human labels per field key — labelFor() in taxonomy.ts only maps enum VALUES,
// not field NAMES, so this is the field-name map. Mirrors the labels ExtractedView
// already uses where they overlap.
const FIELD_LABELS: Record<string, string> = {
  // commitment-level
  pillarRaw: "Pillar",
  action: "Action",
  deliverable: "Deliverable",
  timeline: "Timeline",
  owner: "Owner",
  metric: "Metric / target",
  commitmentType: "Type",
  // top-level
  orgName: "Organization",
  rapTitle: "RAP title",
  sector: "Sector",
  jurisdiction: "Jurisdiction",
  publicationDate: "Published",
  periodCovered: "Period covered",
  frameworkRefs: "Framework references",
  governanceBody: "Governance body",
  reviewCycle: "Review cycle",
  rapType: "RAP type",
  pairLevel: "PAIR level",
  endorsementStatus: "Endorsement status",
};

// Does a value look like a Grounded field? Validation only ever flags Grounded
// fields, but guard defensively so a resolver miss falls back to the raw path
// rather than throwing.
export function isGrounded(v: unknown): v is Grounded<unknown> {
  return typeof v === "object" && v !== null && "value" in v && "quote" in v && "page" in v;
}

const COMMITMENT_PATH = /^commitments\[(\d+)\]\.(\w+)$/;

/**
 * Resolve a ValidationIssue `path` to the extracted field it points at, with a
 * human label. Returns null for the synthetic `$document` path, unknown keys, or
 * non-Grounded keys (pillarNormalized, pillars, extras, sectorFields) — the UI
 * then falls back to showing the raw path. Pure; reads `extracted` only.
 */
export function pathToField(extracted: ExtractedRap, path: string): ResolvedField | null {
  const m = COMMITMENT_PATH.exec(path);
  if (m) {
    const i = Number(m[1]);
    const key = m[2];
    const commitment = extracted.commitments[i] as unknown as Record<string, unknown> | undefined;
    const field = commitment?.[key];
    if (!isGrounded(field)) return null;
    const fieldLabel = FIELD_LABELS[key] ?? key;
    return {
      label: `Commitment ${i + 1} · ${fieldLabel}`,
      g: field,
      page: field.page,
      displayValue: formatFieldValue(key, field.value),
    };
  }

  // Top-level key.
  const field = (extracted as unknown as Record<string, unknown>)[path];
  if (!isGrounded(field)) return null;
  return {
    label: FIELD_LABELS[path] ?? path,
    g: field,
    page: field.page,
    displayValue: formatFieldValue(path, field.value),
  };
}

export interface FieldEntry {
  path: string; // original dotted path (fallback label if unresolved)
  resolved: ResolvedField | null;
}

export interface FieldGroup {
  rule: ValidationRule;
  label: string;
  fields: FieldEntry[]; // the fields that tripped this rule, resolved to their data
  count: number;
}

export interface IssueSummary {
  document: ValidationIssue[]; // document-level issues, rendered first as the root cause
  fieldGroups: FieldGroup[]; // field-level issues grouped by rule
  fieldCount: number; // total field-level issues (for the triage badge)
  hasDamage: boolean; // a source_text_damaged issue is present → the quote failures are expected
}

/**
 * Split document-level from field-level issues and group the field-level ones by
 * rule, preserving first-seen order for both the groups and the fields within
 * them. Each field is resolved to its extracted data (value/quote/page) when
 * `extracted` is supplied. `hasDamage` lets the UI tell the reviewer that
 * `quote_not_found` failures are a *consequence* of the damaged text, not
 * independent alarms. Pure: does not mutate `issues`.
 */
export function summarizeIssues(issues: ValidationIssue[], extracted?: ExtractedRap | null): IssueSummary {
  const document: ValidationIssue[] = [];
  const groupByRule = new Map<ValidationRule, FieldGroup>();

  for (const issue of issues) {
    if (categoryForRule(issue.rule) === "document") {
      document.push(issue);
      continue;
    }
    let group = groupByRule.get(issue.rule);
    if (!group) {
      group = { rule: issue.rule, label: plainLabel(issue.rule), fields: [], count: 0 };
      groupByRule.set(issue.rule, group);
    }
    group.fields.push({ path: issue.path, resolved: extracted ? pathToField(extracted, issue.path) : null });
    group.count++;
  }

  const fieldGroups = [...groupByRule.values()];
  const fieldCount = fieldGroups.reduce((n, g) => n + g.count, 0);
  const hasDamage = issues.some((i) => i.rule === "source_text_damaged");

  return { document, fieldGroups, fieldCount, hasDamage };
}
