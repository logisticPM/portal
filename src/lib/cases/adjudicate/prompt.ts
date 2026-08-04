// Blinded adjudication of the claims the uniqueness guard declines (spec 2026-08-04).
//
// The judge sees the quotation and two candidate paragraphs labelled A and B, and NOTHING
// else. It does not learn which candidate our overlap scoring preferred, what the model cited,
// the overlap numbers, the case, or the paragraph ids. Every one of those would turn an
// independent read into a confirmation of the thing being tested — which is the whole reason
// this measurement is worth running after #228 found citedPara at chance level.

export type Pick = "A" | "B" | "unsure";

function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

// null means WE could not read the response. It is not an abstention: `unsure` is the judge
// telling us the pair is undecidable from the text, which spec §2 treats as a result in its own
// right, and folding a parse failure into it would inflate that result with our own bugs.
export function parsePick(raw: string): Pick | null {
  const v = firstJson(raw)?.pick;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s === "a" ? "A" : s === "b" ? "B" : s === "unsure" ? "unsure" : null;
}

export function buildAdjudicationPrompt(quote: string, paraA: string, paraB: string): string {
  return `A sentence was quoted from a court decision, but the quotation was copied imperfectly — a word may be altered or the ending clipped. Two paragraphs from that decision are candidates for where it came from.

QUOTATION:
${quote}

PARAGRAPH A:
${paraA}

PARAGRAPH B:
${paraB}

Which paragraph is the quotation from? Judge only by comparing the wording. If both paragraphs could equally be the source, or you genuinely cannot tell them apart on this evidence, answer "unsure" — that is a real and useful answer here, not a failure, and guessing is worse than abstaining.

Output STRICTLY this JSON, no markdown:
{"pick":"A"|"B"|"unsure"}`;
}
