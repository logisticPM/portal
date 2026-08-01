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
import type { ValidationIssue, ValidationRule } from "./types";

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
  quote_not_found: "Couldn't verify against the source text",
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

export interface FieldGroup {
  rule: ValidationRule;
  label: string;
  paths: string[]; // the field paths that tripped this rule, e.g. commitments[0].owner
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
 * rule, preserving first-seen order for both the groups and the paths within
 * them. `hasDamage` lets the UI tell the reviewer that `quote_not_found`
 * failures are a *consequence* of the damaged text, not independent alarms.
 * Pure: does not mutate `issues`.
 */
export function summarizeIssues(issues: ValidationIssue[]): IssueSummary {
  const document: ValidationIssue[] = [];
  const groupByRule = new Map<ValidationRule, FieldGroup>();

  for (const issue of issues) {
    if (categoryForRule(issue.rule) === "document") {
      document.push(issue);
      continue;
    }
    let group = groupByRule.get(issue.rule);
    if (!group) {
      group = { rule: issue.rule, label: plainLabel(issue.rule), paths: [], count: 0 };
      groupByRule.set(issue.rule, group);
    }
    group.paths.push(issue.path);
    group.count++;
  }

  const fieldGroups = [...groupByRule.values()];
  const fieldCount = fieldGroups.reduce((n, g) => n + g.count, 0);
  const hasDamage = issues.some((i) => i.rule === "source_text_damaged");

  return { document, fieldGroups, fieldCount, hasDamage };
}
