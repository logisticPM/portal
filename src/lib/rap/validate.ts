// ===========================================================================
// Deterministic validation + flagging. Takes the model's raw grounded output
// and (a) sets Grounded.flagged on every field, (b) collects ValidationIssue[].
// This is the gate between extraction and either auto-publish or human review:
// a field is flagged if it's low-confidence, ungrounded, or fails a format /
// cross-field check. Pure; never calls the model.
//
//   flagged  ⇒ confidence < threshold  OR  value present but no quote
//            OR a format/cross-field rule fails.
// ===========================================================================
import { CONFIDENCE_THRESHOLD, parseDueDate } from "./publish";
import type { ExtractedRap, Grounded, ValidationIssue } from "./types";

const isoish = /^\d{4}(-\d{2}(-\d{2})?)?$/; // YYYY or YYYY-MM or YYYY-MM-DD

// Different engines ground differently:
//   • Claude (tool-use) returns a verbatim QUOTE → requireQuote=true: a value
//     with no quote is a no_quote failure (catches hallucination).
//   • BDA returns CONFIDENCE + bounding box, not a text span → requireQuote=false:
//     trust is confidence-only, so a null quote is expected, not a failure.
export interface ValidateOptions {
  threshold?: number;
  requireQuote?: boolean;
}

// base flag rule, shared by every grounded field
function baseFlag<T>(g: Grounded<T>, threshold: number, requireQuote: boolean): boolean {
  return g.confidence < threshold || (requireQuote && g.value !== null && g.quote === null);
}

// returns a flagged copy of g, pushing a no_quote issue when ungrounded (quote-mode only)
function flag<T>(
  g: Grounded<T>, path: string, issues: ValidationIssue[], threshold: number, requireQuote: boolean,
): Grounded<T> {
  const flagged = baseFlag(g, threshold, requireQuote);
  if (requireQuote && g.value !== null && g.quote === null) {
    issues.push({ path, rule: "no_quote", message: "value present but no source span" });
  }
  return { ...g, flagged };
}

// flag + a date_format check for fields that should parse to a date
function flagDate(
  g: Grounded<string>, path: string, issues: ValidationIssue[], threshold: number, requireQuote: boolean,
): Grounded<string> {
  const out = flag(g, path, issues, threshold, requireQuote);
  if (g.value !== null && parseDueDate(g.value) === null) {
    issues.push({ path, rule: "date_format", message: `unparseable date: "${g.value}"` });
    return { ...out, flagged: true };
  }
  return out;
}

export interface ValidatedExtraction {
  extracted: ExtractedRap; // same payload with flagged set per field
  issues: ValidationIssue[];
}

export function validateAndFlag(e: ExtractedRap, opts: ValidateOptions = {}): ValidatedExtraction {
  const threshold = opts.threshold ?? CONFIDENCE_THRESHOLD;
  const requireQuote = opts.requireQuote ?? true;
  const issues: ValidationIssue[] = [];
  const f = <T>(g: Grounded<T>, path: string) => flag(g, path, issues, threshold, requireQuote);
  const fd = (g: Grounded<string>, path: string) => flagDate(g, path, issues, threshold, requireQuote);

  const period = e.periodCovered.value;
  if (period && (!isoish.test(period.start) || !isoish.test(period.end))) {
    issues.push({ path: "periodCovered", rule: "date_format", message: "period start/end not ISO-ish" });
  }

  const extracted: ExtractedRap = {
    ...e,
    orgName: f(e.orgName, "orgName"),
    sector: f(e.sector, "sector"),
    jurisdiction: f(e.jurisdiction, "jurisdiction"),
    rapTitle: f(e.rapTitle, "rapTitle"),
    publicationDate: fd(e.publicationDate, "publicationDate"),
    periodCovered: f(e.periodCovered, "periodCovered"),
    frameworkRefs: f(e.frameworkRefs, "frameworkRefs"),
    pillars: f(e.pillars, "pillars"),
    governanceBody: f(e.governanceBody, "governanceBody"),
    reviewCycle: f(e.reviewCycle, "reviewCycle"),
    rapType: f(e.rapType, "rapType"),
    pairLevel: f(e.pairLevel, "pairLevel"),
    endorsementStatus: f(e.endorsementStatus, "endorsementStatus"),
    commitments: e.commitments.map((c, i) => {
      const base = `commitments[${i}]`;
      const timeline = fd(c.timeline, `${base}.timeline`);
      // cross-field: a deliverable's due date should fall within the RAP period
      if (timeline.value && period?.end) {
        const due = parseDueDate(timeline.value);
        if (due && due > `${period.end.slice(0, 4)}-12-31`) {
          issues.push({ path: `${base}.timeline`, rule: "cross_field", message: "timeline is after the RAP period end" });
          timeline.flagged = true;
        }
      }
      return {
        ...c,
        pillarRaw: f(c.pillarRaw, `${base}.pillarRaw`),
        action: f(c.action, `${base}.action`),
        deliverable: f(c.deliverable, `${base}.deliverable`),
        timeline,
        owner: f(c.owner, `${base}.owner`),
        metric: f(c.metric, `${base}.metric`),
        commitmentType: f(c.commitmentType, `${base}.commitmentType`),
      };
    }),
  };

  return { extracted, issues };
}
