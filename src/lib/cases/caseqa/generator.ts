// Single-case Q&A generation (spec 2026-07-19). Reuses the summarizer's extractive engine:
// assemble the judgment, ask the question, keep ONLY claims whose quote is verbatim in a real
// paragraph. 0 verified claims ⇒ refuse. Single-source; fabrication cannot pass verifyClaims.
import type { LegalCase, CaseChunk } from "../types";
import type { LlmModel } from "../ingest/llm";
import type { CaseQaAnswer, QaFailKind as QaFailKindT } from "./types";
import { assembleInput, parseClaims, verifyClaims, RETRY_SUFFIX } from "../ingest/summarizer";

export function buildAskPrompt(c: LegalCase, question: string, body: string): string {
  return `You are answering a question about ONE Canadian court decision, for a reader WITHOUT legal training. Use ONLY the judgment text below — never outside knowledge.

Case: ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})

QUESTION: ${question}

Below is the judgment text as paragraphs, each tagged [para <id>].

Produce STRICTLY this JSON (no markdown, no commentary):
{"claims":[{"text":"...","quote":"...","paragraph":"..."}]}

Rules:
- 1 to 6 claims that together answer the QUESTION.
- Each "text": 1-2 plain-language sentences a non-lawyer understands. No legalese.
- Each "quote": a VERBATIM excerpt copied character-for-character from one paragraph below (at least 15 characters).
- Each "paragraph": the id from that paragraph's [para <id>] tag.
- Do NOT invent facts, give advice, or use anything outside this judgment.
- If the judgment does not address the question, output exactly {"claims":[]}.

JUDGMENT TEXT:
${body}`;
}

// A quote at or above this shares a contiguous run of at least 80% of its length with real
// judgment text — the model was quoting the judgment and mistyped it, not inventing.
//
// Calibrated against the 2026-07-31 drop forensics, not picked by feel: one substituted word
// splits a quote and leaves the longer surviving fragment at roughly 0.5, so 0.8 sits well
// clear of ordinary one-word garbling, while the bulk of real near misses measured 0.95+.
export const NEAR_MISS_OVERLAP = 0.8;

export type QaFailKind = QaFailKindT;
export type QaResult =
  | { status: "done"; answer: CaseQaAnswer; dropped: number }
  | { status: "failed"; failReason: string; failKind: QaFailKindT; bestOverlap?: number };

const REASON: Record<QaFailKindT, string> = {
  no_full_text: "this judgment has no full text to answer from",
  unparseable: "the model did not return a readable answer — please try again",
  not_addressed: "this judgment does not appear to address that question",
  // Deliberately says nothing about whether the judgment covers the question, because we
  // do not know: the model answered and we could not tie the answer to the text.
  unverifiable: "an answer was drafted but could not be matched to this judgment's text, so it was not shown — please try again",
};

// One parse + verify pass. `measureOverlap` is on so a total verification failure can be
// told apart from a fabrication; the cost is bounded because overlap is only computed for
// claims that are already being dropped.
function attempt(raw: string, c: LegalCase, chunks: CaseChunk[]) {
  const claims = parseClaims(raw);
  if (!claims) return { parsed: false as const };
  const { anchors, dropped, drops } = verifyClaims(claims, chunks, c.provenance.sourceUrl, { measureOverlap: true });
  const bestOverlap = drops.reduce((m, d) => (d.overlapMeasured && d.bestOverlap > m ? d.bestOverlap : m), 0);
  return { parsed: true as const, claimCount: claims.length, anchors, dropped, bestOverlap };
}

export async function answerCaseQuestion(
  c: LegalCase, chunks: CaseChunk[], question: string, model: LlmModel,
): Promise<QaResult> {
  if (!chunks.length) return { status: "failed", failKind: "no_full_text", failReason: REASON.no_full_text };
  const prompt = buildAskPrompt(c, question, assembleInput(chunks, c.outcome.holding));

  const first = attempt(await model.call(prompt), c, chunks);
  if (first.parsed) {
    if (first.anchors.length > 0) return { status: "done", answer: { claims: first.anchors }, dropped: first.dropped };
    // The model itself said the judgment is silent. That is a correct refusal, and retrying
    // it would spend a call to be told the same thing.
    if (first.claimCount === 0) return { status: "failed", failKind: "not_addressed", failReason: REASON.not_addressed };
    if (first.bestOverlap < NEAR_MISS_OVERLAP) {
      return { status: "failed", failKind: "unverifiable", failReason: REASON.unverifiable, bestOverlap: first.bestOverlap };
    }
    // Fall through: a near miss earns exactly one more call.
  }

  const second = attempt(await model.call(prompt + RETRY_SUFFIX), c, chunks);
  if (!second.parsed) {
    return { status: "failed", failKind: "unparseable", failReason: REASON.unparseable };
  }
  if (second.anchors.length > 0) return { status: "done", answer: { claims: second.anchors }, dropped: second.dropped };
  if (second.claimCount === 0) return { status: "failed", failKind: "not_addressed", failReason: REASON.not_addressed };
  return { status: "failed", failKind: "unverifiable", failReason: REASON.unverifiable, bestOverlap: second.bestOverlap };
}
