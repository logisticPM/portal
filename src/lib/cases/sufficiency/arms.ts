// Arm L of the sufficiency measurement (spec §4).
//
// The eval's unanswerable pairs are cross-case, and their "does not address" label was produced
// by an LLM screen running on the JUDGE model (cases-caseqa-eval.ts). Scoring a rater against
// that label measures agreement between two judges, not accuracy. Arm L avoids the screen
// entirely: take a question that IS answerable — ground truth by construction, because the
// target paragraph was chosen first and the question written from it — and delete that
// paragraph. Insufficiency is then created, not certified.
//
// It is also the hardest possible negative: everything that remains is the same judgment, same
// parties, same area of law, same vocabulary. A rater that passes arm L is doing more than
// topic matching.
//
// The known weakness, stated rather than hidden: a judgment can state the same proposition in
// more than one paragraph, so deleting the target does not STRICTLY guarantee the question
// became unanswerable. That residual is measured by the runner (an independent model is asked
// whether the stripped body still addresses the question) and published as a contamination
// bound. It is not subtracted out.

export interface Chunk { paragraph: string; text: string }

// Returns a NEW array. The caller goes on to use the original for arm S, and an in-place
// removal would silently turn arm S into arm L.
export function stripTarget<T extends Chunk>(chunks: readonly T[], targetParagraph: string): { kept: T[] } {
  const hits = chunks.filter((c) => c.paragraph === targetParagraph).length;
  if (hits !== 1) {
    throw new Error(
      `leave-one-out needs exactly one chunk with paragraph "${targetParagraph}", found ${hits}. ` +
      `Zero means the caller and the corpus disagree about what the target is; more than one means ` +
      `the deletion would not be the controlled single-paragraph removal this arm is defined as.`,
    );
  }
  return { kept: chunks.filter((c) => c.paragraph !== targetParagraph) };
}

// assembleInput has a 240,000-char budget and re-picks which chunks survive when the input
// shrinks, so what it emits after a removal is not simply "the same minus one". This confirms
// the removal actually reached the assembled text rather than trusting that it did.
//
// Matches the `[para <id>]` tag that assembleInput emits, NOT a bare id: judgments routinely
// refer to their own paragraph numbers in prose, and a bare-id check would report the target as
// present whenever another paragraph cited it.
export function assertTargetAbsent(assembledBody: string, targetParagraph: string): void {
  const tag = `[para ${targetParagraph}]`;
  if (assembledBody.includes(tag)) {
    throw new Error(`leave-one-out body still contains ${tag} — the removal did not take`);
  }
}
