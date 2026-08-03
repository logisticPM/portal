// Known-answer construction: pick the paragraph FIRST, then write the question for it.
// That ordering is what makes responsiveness, false-refusal and false-answer objective —
// the target paragraph is ground truth by construction, with no human and no judge.
import { normWs, longestCommonSubstringLen } from "../ingest/summarizer";
import { seededShuffle } from "./rng";

// Below this, a paragraph is procedural boilerplate — "Appeal dismissed.", "Costs to the
// respondent." — that no lay question can be built from. Including them would score
// construction failures as product failures.
export const MIN_TARGET_PARA_CHARS = 300;

// A constructed question sharing this much verbatim text with its target is a lexical
// gimme: the retriever would match on string overlap and responsiveness would measure
// nothing. 40 chars is well past incidental phrases like "the duty to consult" (19).
export const GIMME_MIN_RUN = 40;

export interface CaseLike { id: string; chunks?: { paragraph: string; text: string }[] }
export interface Target { caseId: string; paragraph: string; text: string }

// One target paragraph per case, for up to `count` cases. Cases with no paragraph over the
// floor are skipped rather than substituted, so the shortfall is visible in the count the
// runner prints instead of being quietly backfilled.
export function pickTargets(cases: readonly CaseLike[], seed: number, count: number): Target[] {
  const out: Target[] = [];
  for (const c of seededShuffle(cases, seed)) {
    if (out.length >= count) break;
    const eligible = (c.chunks ?? []).filter((ch) => ch.text.length >= MIN_TARGET_PARA_CHARS);
    if (!eligible.length) continue;
    // A second shuffle with the same seed: deterministic, and independent of the case order
    // because seededShuffle copies rather than advancing one shared stream.
    const ch = seededShuffle(eligible, seed)[0];
    out.push({ caseId: c.id, paragraph: ch.paragraph, text: ch.text });
  }
  return out;
}

// Normalised on both sides before matching, or "the   Crown" would slip past a check that
// "the Crown" fails.
export function isLexicalGimme(question: string, paragraphText: string, minRun = GIMME_MIN_RUN): boolean {
  return longestCommonSubstringLen(normWs(question), normWs(paragraphText)) >= minRun;
}

export interface CaseHeader { styleOfCause: string; citation: string; court: string; year: number }

export function buildQuestionPrompt(c: CaseHeader, target: { paragraph: string; text: string }): string {
  return `You are writing ONE realistic question for a legal-information website, of the kind a member of the public with no legal training would type.

The question must be answerable from the PARAGRAPH below, taken from ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year}).

PARAGRAPH [${target.paragraph}]:
${target.text}

Rules:
- Write in the FIRST PERSON, the way a worried non-lawyer writes. Describe a concrete situation, then ask.
- 2 to 4 sentences.
- Do NOT quote or copy any phrase from the paragraph. Use everyday words for the legal ideas.
- Do NOT mention the case name, the citation, the court, or any paragraph number.
- The paragraph must genuinely answer your question.

Output ONLY the question text. No preamble, no quotation marks, no JSON.`;
}
