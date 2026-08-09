// Relevance judging for the retrieval gold (spec 2026-08-09 §2).
//
// Rubric text is UNCHANGED from the 2026-06-30 spec. What changed is the judge: the original,
// `claude-opus-4-8`, returns "invalid model identifier" and "not available for this account" as of
// 2026-08-09, so the existing 140 judgments cannot be extended, reproduced, or audited by their own
// judge. Keeping the rubric identical means the grades still mean what the old datasheet says they
// mean; the gold's `judge` field carries the part that differs.
//
// The judge grades ONE (query, case) pair and never sees a ranking, a position, or which system
// surfaced the case. A judge that knew it was adjudicating between systems could favour one.

export const REL_RUBRIC_ID = "rel-v1";

export interface RelJudgment { rel: number; why: string }

export interface JudgeCase {
  caseId: string; styleOfCause: string; citation: string;
  court: string; year: number; holding: string;
}

function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

// null means THE JUDGE FAILED, counted separately by the caller. Never default to 0: an unjudged
// pair already scores 0 by the pooling convention, so a defaulted 0 is indistinguishable from a
// real "not relevant" while being evidence of nothing — and it biases every system's precision
// upward in the same direction.
export function parseRel(raw: string): RelJudgment | null {
  const j = firstJson(raw);
  const rel = j?.rel;
  if (typeof rel !== "number" || !Number.isInteger(rel) || rel < 0 || rel > 2) return null;
  return { rel, why: typeof j?.why === "string" ? j.why.trim() : "" };
}

export function buildRelPrompt(query: string, c: JudgeCase): string {
  return `You are grading how relevant ONE Canadian court decision is to ONE search query, for a search-quality evaluation.

QUERY:
${query}

CASE:
  ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})
  Holding: ${c.holding}

Grade on this scale:
- "2" — the case is a direct answer to the query, or the controlling authority for what it asks.
- "1" — the case materially addresses the query's subject but is secondary: it applies, extends or distinguishes the leading authority, or is a lower court on the same doctrine.
- "0" — off topic, or the query's subject appears only as an incidental mention.

Judge the case against the query only. Do not consider how well written the decision is, how recent it is, or how important it is generally.

Give your reasoning FIRST, then the grade.

Output STRICTLY this JSON, no markdown:
{"why":"one sentence","rel":2|1|0}`;
}
