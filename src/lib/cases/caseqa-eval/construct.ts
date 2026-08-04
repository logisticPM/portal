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

// A question shorter than this cannot carry the "describe a situation, then ask" shape the
// prompt requires, so it is a construction failure rather than a hard question.
export const MIN_QUESTION_CHARS = 40;

// The runner's only other validity test is `!question`, which catches an empty response but
// not a TRUNCATED one — and a question cut mid-sentence is unanswerable for reasons that have
// nothing to do with the product, so scoring it would attribute a harness failure to the
// answerer. Terminal punctuation is the cheap truncation signal: a mid-sentence cut ends on a
// word or a comma. The `?` test is separate because a truncated response can still contain a
// question mark from an earlier sentence.
export function isWellFormedQuestion(question: string): boolean {
  const q = question.trim();
  return q.length >= MIN_QUESTION_CHARS && q.includes("?") && /[.?!]$/.test(q);
}

export interface CaseLike { id: string; chunks?: { paragraph: string; text: string }[] }

// Stage 1 of target eligibility (spec §3, 2026-08-04). Front and back matter are laid out as
// SHORT LINES — one field, party, counsel or table-of-contents entry per line — while body
// prose is long lines. Measured across six judgments: front/back matter 25-131, body 292-2042.
// 200 sits inside that gap.
//
// Deliberately tuned to avoid FALSE REJECTIONS rather than to catch everything, because the
// judged stage 2 is the backstop and throwing away real body prose costs sample size for
// nothing.
//
// Two other signals were measured and REJECTED — do not reintroduce them:
//  - front-matter keywords (Docket, Registry, BETWEEN, Coram, Counsel, ...) fail BOTH ways:
//    2008-scc-41 chunk 34 and 2024-scc-39 chunk 2 are body reasoning and match, while
//    2021-onca-779 chunk 2 is a table of contents and does not.
//  - sentence density does not separate at all: front matter 6-9 per 1,000 chars, body 6-17.
export const MIN_TARGET_AVG_LINE = 200;

// `filter(Boolean)` rather than a trim-based filter, matching EXACTLY how the corpus was
// measured — a whitespace-only line is counted, which lowers the average and therefore errs
// toward rejection. Changing this definition invalidates the thresholds above.
export function isProseShaped(text: string): boolean {
  const lines = text.split("\n").filter(Boolean);
  if (!lines.length) return false;
  return text.length / lines.length >= MIN_TARGET_AVG_LINE;
}

export interface Target { caseId: string; paragraph: string; text: string }

// Why the counts ride along instead of being recomputed by the runner: the two skip reasons
// are only distinguishable HERE, inside the loop that applies them. `noLongPara` is a fact
// about the corpus; `rejectedByShape` is the front-matter filter doing its job. Spec §7.6
// requires them apart, because if stage 1 starts rejecting most cases the threshold is wrong
// and that must be visible rather than absorbed into a shrunken sample.
export interface TargetDraw {
  targets: Target[];
  noLongPara: number;      // no paragraph reached MIN_TARGET_PARA_CHARS
  rejectedByShape: number; // had a long paragraph, none of them prose-shaped
}

// One target paragraph per case, for up to `count` cases. Cases with no eligible paragraph are
// skipped rather than substituted, so the shortfall is visible in the counts the runner prints
// instead of being quietly backfilled.
export function pickTargets(cases: readonly CaseLike[], seed: number, count: number): TargetDraw {
  const targets: Target[] = [];
  let noLongPara = 0, rejectedByShape = 0;
  // Case-level shuffle uses the bare `seed` (unchanged); the paragraph shuffle below is keyed
  // per-case (`i`, this case's position in that shuffled order).
  for (const [i, c] of seededShuffle(cases, seed).entries()) {
    if (targets.length >= count) break;
    const longEnough = (c.chunks ?? []).filter((ch) => ch.text.length >= MIN_TARGET_PARA_CHARS);
    if (!longEnough.length) { noLongPara++; continue; }
    // Stage 1: a long chunk can still be a caption, a party list or a table of contents.
    const eligible = longEnough.filter((ch) => isProseShaped(ch.text));
    if (!eligible.length) { rejectedByShape++; continue; }
    // Per-case seed, NOT the bare `seed`: a Fisher-Yates swap sequence for a given seed depends
    // only on the RNG stream and the array length, so reusing the same seed for every case's
    // paragraph shuffle meant every case with the SAME eligible-paragraph count picked the
    // paragraph at the SAME original index — zero within-group variance, and the number of
    // independent position draws collapsed to the number of distinct eligible-counts rather
    // than the number of cases. Offsetting by the case's own index makes each case's draw
    // independent while staying fully deterministic for a fixed `seed`.
    const ch = seededShuffle(eligible, seed + i + 1)[0];
    targets.push({ caseId: c.id, paragraph: ch.paragraph, text: ch.text });
  }
  return { targets, noLongPara, rejectedByShape };
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
