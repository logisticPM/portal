// The only LLM-judged part of this instrument, kept deliberately narrow: given ONE
// published sentence and ONE paragraph, is the sentence supported? That is a local
// entailment question, not open-ended legal judgment.
//
// Judged against the PARAGRAPH, not the model's quote, for two reasons (spec §6): the
// quote is discarded by design (CitationAnchor has no quote field), and the paragraph is
// what the product's link shows the reader. It is therefore more permissive than judging
// against the quote — a sentence supported by a DIFFERENT sentence of the same paragraph
// passes — and that is recorded as a limitation rather than hidden.

export type Verdict = "supported" | "overstated" | "contradicted" | "unrelated";
const VERDICTS: readonly Verdict[] = ["supported", "overstated", "contradicted", "unrelated"];

// Shared JSON extraction: models wrap output in prose and code fences.
function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

// null means THE JUDGE FAILED, and callers must count it separately. Returning a default
// verdict would turn a parse failure into evidence about the product.
export function parseVerdict(raw: string): Verdict | null {
  const j = firstJson(raw);
  const v = typeof j?.verdict === "string" ? j.verdict.trim().toLowerCase() : "";
  return (VERDICTS as readonly string[]).includes(v) ? (v as Verdict) : null;
}

export function parseAddressed(raw: string): boolean | null {
  const j = firstJson(raw);
  return typeof j?.addressed === "boolean" ? j.addressed : null;
}

export function buildFaithfulnessPrompt(claimText: string, paragraphText: string): string {
  return `You are checking one sentence from a legal-information website against the court paragraph it cites.

SENTENCE:
${claimText}

PARAGRAPH IT CITES:
${paragraphText}

Choose exactly one verdict:
- "supported" — the paragraph says this, allowing for plain-language rewording.
- "overstated" — directionally right, but the sentence drops a qualifier, or asserts more certainty or breadth than the paragraph does.
- "contradicted" — the sentence says something the paragraph denies or reverses.
- "unrelated" — the paragraph does not address what the sentence claims.

Judge ONLY against the paragraph above. Do not use outside legal knowledge.

Output STRICTLY this JSON, no markdown:
{"verdict":"supported|overstated|contradicted|unrelated"}`;
}

export function buildAddressedPrompt(question: string, styleOfCause: string, body: string): string {
  return `Decide whether a court decision addresses a question. This is a screening step: we need to know if the decision contains material an answer could be drawn from.

QUESTION:
${question}

DECISION (${styleOfCause}), as paragraphs:
${body}

Answer true only if the decision contains material that genuinely bears on the question. Topical adjacency is not enough.

Output STRICTLY this JSON, no markdown:
{"addressed":true|false}`;
}
