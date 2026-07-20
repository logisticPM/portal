// Single-case Q&A generation (spec 2026-07-19). Reuses the summarizer's extractive engine:
// assemble the judgment, ask the question, keep ONLY claims whose quote is verbatim in a real
// paragraph. 0 verified claims ⇒ refuse. Single-source; fabrication cannot pass verifyClaims.
import type { LegalCase, CaseChunk } from "../types";
import type { LlmModel } from "../ingest/llm";
import type { CaseQaAnswer } from "./types";
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

export type QaResult =
  | { status: "done"; answer: CaseQaAnswer; dropped: number }
  | { status: "failed"; failReason: string };

export async function answerCaseQuestion(
  c: LegalCase, chunks: CaseChunk[], question: string, model: LlmModel,
): Promise<QaResult> {
  if (!chunks.length) return { status: "failed", failReason: "this judgment has no full text to answer from" };
  const body = assembleInput(chunks, c.outcome.holding);
  const prompt = buildAskPrompt(c, question, body);
  let claims = parseClaims(await model.call(prompt));
  if (!claims) claims = parseClaims(await model.call(prompt + RETRY_SUFFIX));
  if (!claims) return { status: "failed", failReason: "the model did not return a readable answer — please try again" };
  const { anchors, dropped } = verifyClaims(claims, chunks, c.provenance.sourceUrl);
  if (anchors.length === 0) return { status: "failed", failReason: "this judgment does not appear to address that question" };
  return { status: "done", answer: { claims: anchors }, dropped };
}
