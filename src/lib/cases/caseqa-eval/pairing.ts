// Candidate selection for unanswerable pairing (spec §3: "a case drawn — same seed — from the
// 40 excluding its own source case"), extracted so the part that was actually broken can be
// unit-tested without a judge model, a network call, or DynamoDB.
//
// The original inline loop in the runner picked `built.find((x) => x.caseId !== b.caseId &&
// !pairs.some((p) => p.caseId === x.caseId))` for every source question `b`. Two defects:
//   1. `!pairs.some(...)` marks a candidate excluded only once it is SUCCESSFULLY paired.
//      A candidate the judge REJECTS (addressed, or unparseable) is never marked, and
//      `built.find` always rescans from index 0 — so the same rejected candidate is handed
//      to every subsequent source until one happens to accept it.
//   2. Taking "the lowest unused index" is not a draw. It produces a pure adjacent swap
//      (0<->1, 2<->3, ...), confining candidates to shuffle positions 0..19 and never
//      touching 20..39, and it is what the reviewer's "one broad judgment reads as addressed
//      for almost everything" scenario turns into 18 of 20 paid judge calls re-screening the
//      same case for 1 successful pair.
// This version (a) draws a candidate via `seededShuffle`, per-source-offset the same way
// `pickTargets` offsets its per-case paragraph draw in construct.ts, and (b) marks a candidate
// ATTEMPTED — excluded from every future draw — the moment it is drawn, regardless of outcome.
import { seededShuffle } from "./rng";

export interface PairSource { caseId: string; qid: string; question: string }
export interface Pair { caseId: string; qid: string; question: string }

export interface PairingResult {
  pairs: Pair[];
  // A candidate was drawn and the judge said it either DOES address the source question, or
  // failed to say either way. Both are discards, not answers to the opposite question — see
  // the runner's original comment: counting an addressed pair as unanswerable would inflate
  // false-answer rate with correct answers.
  discardedPairs: number;
  addressedFails: number;   // subset of discardedPairs: the judge was unparseable, not "true"
  // A source question for which every OTHER case had already been attempted (paired or
  // rejected) by an earlier source before a usable candidate was found. Distinct from the two
  // above because nothing was screened for this source at all — no judge call was spent.
  exhausted: number;
}

// `screen(source, candidate)` decides whether `candidate` addresses `source`'s question.
// `null` means the judge failed to return a parseable verdict. Injected so this function stays
// free of any model/IO dependency — the runner supplies the real judge call.
export async function buildUnanswerablePairs<T extends PairSource>(
  built: readonly T[],
  count: number,
  seed: number,
  screen: (source: T, candidate: T) => Promise<boolean | null>,
): Promise<PairingResult> {
  const attempted = new Set<string>();
  const pairs: Pair[] = [];
  let discardedPairs = 0, addressedFails = 0, exhausted = 0;

  const sources = built.slice(0, count);
  for (const [i, source] of sources.entries()) {
    // Per-source seed, NOT the bare `seed`: reusing one seed for every source's candidate
    // shuffle would give every source the identical original ordering (a Fisher-Yates swap
    // sequence for a fixed seed depends only on array length), collapsing the "seeded draw"
    // back into a fixed walk — precisely the degeneracy this module exists to remove.
    // Offsetting by the source's own position keeps each draw independent while remaining
    // fully deterministic for a given `seed`.
    const order = seededShuffle(built, seed + i + 1);
    const candidate = order.find((x) => x.caseId !== source.caseId && !attempted.has(x.caseId));
    if (!candidate) { exhausted++; continue; }
    // Marked the moment it is drawn — win or lose — so it can never be handed to a later
    // source. This one line is the fix: the old code only reached its equivalent on success.
    attempted.add(candidate.caseId);

    const addressed = await screen(source, candidate);
    if (addressed === null) { addressedFails++; discardedPairs++; continue; }
    if (addressed) { discardedPairs++; continue; }
    pairs.push({ caseId: candidate.caseId, qid: `un-${pairs.length + 1}`, question: source.question });
  }
  return { pairs, discardedPairs, addressedFails, exhausted };
}
