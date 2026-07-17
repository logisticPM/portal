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
import { CONFIDENCE_THRESHOLD, isRecurringTimeline, parseDueDate } from "./publish";
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
  // The document text the model was ACTUALLY SHOWN. When given (with
  // requireQuote), every quote is checked to really occur in it — see
  // quoteOccursIn. Omit it and quotes are taken on trust, which is what the
  // gate did for its whole life.
  //
  // Pass the text from loadDocumentText, NOT the original PDF: that text
  // carries injected "[p.N]" markers and has running header/footer boilerplate
  // dropped, so it is deliberately not a byte-copy of the source. Checking
  // against the original would false-negative on every field.
  sourceText?: string;
}

// Compare on WORDS: lowercase, drop everything that isn't alphanumeric, collapse
// runs of space. Deliberately tolerant, because two harmless things drift and one
// harmful thing doesn't:
//   • the chunker trims paragraphs and rejoins sentences with a literal " ", so
//     whitespace is not preserved (F3);
//   • OCR punctuation drifts — Textract emits a curly apostrophe where the model
//     echoes a straight one — and failing a real quote over that would train
//     everyone to ignore the flag;
//   • a FABRICATION differs in words, so it is caught regardless.
// Validated on live data (docs/rap-extraction-findings.md §4a): 32/32 real quotes
// pass this, and it catches 21/32 welded ones in the arm that fabricated.
const normalizeForQuoteMatch = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// An ELIDED quote ("A … B") is honest provenance, not fabrication, and must not
// be treated as one. A multi-valued field (pillars, frameworkRefs) has no single
// verbatim span by construction, so the model marks the join with an ellipsis —
// it is telling us "I took this from two places". Checking each fragment keeps
// that honest, while a SILENT weld — the real failure, measured live in §4a —
// carries no ellipsis, so it is still matched whole and still caught. Without
// this, `pillars` would flag on essentially every RAP, and a flag that always
// fires is a flag everyone learns to ignore.
function quoteOccursIn(quote: string, sourceText: string): boolean {
  const haystack = normalizeForQuoteMatch(sourceText);
  const fragments = quote
    .split(/\s*(?:…|\.\.\.)\s*/)
    .map(normalizeForQuoteMatch)
    .filter(Boolean);
  // an empty/punctuation-only quote is no_quote's problem, not this rule's
  if (fragments.length === 0) return true;
  return fragments.every((f) => haystack.includes(f));
}

// base flag rule, shared by every grounded field
function baseFlag<T>(g: Grounded<T>, threshold: number, requireQuote: boolean): boolean {
  return g.confidence < threshold || (requireQuote && g.value !== null && g.quote === null);
}

// returns a flagged copy of g, pushing a no_quote issue when ungrounded (quote-mode
// only) and a quote_not_found issue when the quote doesn't occur in sourceText
function flag<T>(
  g: Grounded<T>, path: string, issues: ValidationIssue[], threshold: number, requireQuote: boolean,
  sourceText?: string,
): Grounded<T> {
  let flagged = baseFlag(g, threshold, requireQuote);
  if (requireQuote && g.value !== null && g.quote === null) {
    issues.push({ path, rule: "no_quote", message: "value present but no source span" });
  }
  // The quote says "I am a verbatim span of the document." Check it. Without this
  // the gate only ever asked whether a quote was PRESENT, so a model that welded
  // two unrelated spans into a plausible sentence passed cleanly.
  if (requireQuote && sourceText !== undefined && g.quote !== null && !quoteOccursIn(g.quote, sourceText)) {
    issues.push({
      path,
      rule: "quote_not_found",
      message: `quote does not occur in the document: "${g.quote.slice(0, 80)}${g.quote.length > 80 ? "…" : ""}"`,
    });
    flagged = true;
  }
  return { ...g, flagged };
}

// flag + a date_format check for fields that should parse to a date.
//
// `allowRecurring` is for `timeline` only: a commitment may legitimately recur
// ("Annual") instead of falling due, and reporting that as a malformed date
// flagged the field and blocked isClean() on essentially every real RAP. The raw
// wording is preserved either way (Commitment.timelineText), so nothing is lost
// by not flagging. publicationDate does NOT pass it — a publication date that
// says "Annually" is genuinely wrong.
function flagDate(
  g: Grounded<string>, path: string, issues: ValidationIssue[], threshold: number, requireQuote: boolean,
  sourceText?: string, allowRecurring = false,
): Grounded<string> {
  const out = flag(g, path, issues, threshold, requireQuote, sourceText);
  if (allowRecurring && isRecurringTimeline(g.value)) return out;
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
  const sourceText = opts.sourceText;
  const issues: ValidationIssue[] = [];
  const f = <T>(g: Grounded<T>, path: string) => flag(g, path, issues, threshold, requireQuote, sourceText);
  const fd = (g: Grounded<string>, path: string) => flagDate(g, path, issues, threshold, requireQuote, sourceText);
  // timeline may recur; publicationDate may not
  const fdT = (g: Grounded<string>, path: string) => flagDate(g, path, issues, threshold, requireQuote, sourceText, true);

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
    governanceBody: f(e.governanceBody, "governanceBody"),
    reviewCycle: f(e.reviewCycle, "reviewCycle"),
    rapType: f(e.rapType, "rapType"),
    pairLevel: f(e.pairLevel, "pairLevel"),
    endorsementStatus: f(e.endorsementStatus, "endorsementStatus"),
    commitments: e.commitments.map((c, i) => {
      const base = `commitments[${i}]`;
      const timeline = fdT(c.timeline, `${base}.timeline`);
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
