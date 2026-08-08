// Rung 0 of the verification ladder: does this judgment contain enough to answer this question
// AT ALL? Every existing check — verifyClaims (rungs 1-2) and the rung-3 NLI probe — compares a
// CLAIM to a PARAGRAPH and has never seen the question. That is why the product returned
// {"claims":[]} zero times in 54 questions (2026-08-06 answer-quality run) while answering 15 of
// 16 questions about judgments that do not address them.
//
// Sufficiency is NOT groundedness. Joren et al. (ICLR 2025, arXiv:2411.06037) separate them:
// context can be relevant, on-topic, and quotable while still not containing the answer. Their
// prompted rater beat both an NLI baseline and a finetuned rater, which is why this is a prompt
// and not a classifier — and independently corroborates #237's finding that entailment is the
// wrong tool for this family of question.

export interface Sufficiency { sufficient: boolean; reason: string }

function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

// null means THE RATER FAILED, and callers must count it separately — never default a label.
// Defaulting to false would inflate the gate's catch rate; defaulting to true would inflate its
// safety. Both invent evidence out of a broken response.
export function parseSufficiency(raw: string): Sufficiency | null {
  const j = firstJson(raw);
  if (typeof j?.sufficient !== "boolean") return null;
  return { sufficient: j.sufficient, reason: typeof j.reason === "string" ? j.reason.trim() : "" };
}

export function buildSufficiencyPrompt(question: string, styleOfCause: string, body: string): string {
  return `You are deciding ONE thing about a Canadian court decision: does its text contain enough information to answer a question?

You are NOT being asked whether an answer would be well written, whether the decision is about the right area of law, or whether any particular sentence is accurate. Only whether the answer is IN THERE.

CASE: ${styleOfCause}

QUESTION:
${question}

Answer "sufficient": true only if the judgment text below contains the information needed to give a definitive answer to that question.

Answer "sufficient": false if the text lacks that information, addresses it only incompletely or inconclusively, or is contradictory about it.

Being relevant is not enough. A passage can be on the same topic, discuss the same area of law, and use the same words as the question while still not containing the answer — that is insufficient, not sufficient. Ask what a reader could actually conclude from this text alone.

Give your reasoning FIRST, then the label.

Output STRICTLY this JSON, no markdown:
{"reason":"one or two sentences","sufficient":true|false}

JUDGMENT TEXT:
${body}`;
}

// The tuning grid's prompt axis (spec 2026-08-07 §5).
//
// P0 is the prompt #239 measured, and it must stay BYTE-IDENTICAL: its 92 cached responses are
// the published baseline, and the cache key is sha256(modelId + "\n" + prompt), so a single
// changed character silently turns the baseline into a different experiment. A golden fixture
// pins it.
//
// P1 and P2 exist because all ten of #239's false refusals gave the same reason — "does not
// provide a definitive answer" — which is P0's own word. That is an observation, not a measured
// cause, which is exactly why it is being tested rather than assumed.

export type VariantId = "P0" | "P1" | "P2";
export const VARIANT_IDS: readonly VariantId[] = ["P0", "P1", "P2"];

// P1: drops "definitive" and says plainly that answering the substance is enough. The failure
// P0 exhibits is refusing text that answers the question but does not settle every sub-part or
// state a general rule.
export function buildSufficiencyPromptP1(question: string, styleOfCause: string, body: string): string {
  return `You are deciding ONE thing about a Canadian court decision: does its text contain enough information to answer a question?

You are NOT being asked whether an answer would be well written, whether the decision is about the right area of law, or whether any particular sentence is accurate. Only whether the answer is IN THERE.

CASE: ${styleOfCause}

QUESTION:
${question}

Answer "sufficient": true if the judgment text below answers the substance of that question — enough that a reader could come away knowing the answer.

It does not have to resolve every sub-part of a multi-part question, and it does not have to state a general rule. Text that answers the question as it was actually asked is sufficient.

Answer "sufficient": false if the text does not contain the answer at all, or only touches the topic without saying anything that answers the question.

Being relevant is not enough. A passage can be on the same topic, discuss the same area of law, and use the same words as the question while still not containing the answer — that is insufficient.

Give your reasoning FIRST, then the label.

Output STRICTLY this JSON, no markdown:
{"reason":"one or two sentences","sufficient":true|false}

JUDGMENT TEXT:
${body}`;
}

// P2: P1 plus the reminder that a judgment answering in its own vocabulary still answers. The
// questions are lay-language rewrites of a paragraph, so a rater matching surface form rather
// than substance would refuse text that does answer.
export function buildSufficiencyPromptP2(question: string, styleOfCause: string, body: string): string {
  return `You are deciding ONE thing about a Canadian court decision: does its text contain enough information to answer a question?

You are NOT being asked whether an answer would be well written, whether the decision is about the right area of law, or whether any particular sentence is accurate. Only whether the answer is IN THERE.

CASE: ${styleOfCause}

QUESTION:
${question}

Answer "sufficient": true if the judgment text below answers the substance of that question — enough that a reader could come away knowing the answer.

It does not have to resolve every sub-part of a multi-part question, and it does not have to state a general rule. Text that answers the question as it was actually asked is sufficient.

The question is written in everyday language and the judgment is not. Do not require the text to use the question's words, or to address it in the same order or framing. Ask whether the substance is present, however the court phrased it.

Answer "sufficient": false if the text does not contain the answer at all, or only touches the topic without saying anything that answers the question.

Being relevant is not enough. A passage can be on the same topic, discuss the same area of law, and use the same words as the question while still not containing the answer — that is insufficient.

Give your reasoning FIRST, then the label.

Output STRICTLY this JSON, no markdown:
{"reason":"one or two sentences","sufficient":true|false}

JUDGMENT TEXT:
${body}`;
}

export const VARIANTS: Record<VariantId, (question: string, styleOfCause: string, body: string) => string> = {
  P0: buildSufficiencyPrompt,
  P1: buildSufficiencyPromptP1,
  P2: buildSufficiencyPromptP2,
};
