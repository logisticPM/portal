// Stage 2 of target eligibility (spec §3, §7 guard 6), extracted from the runner so it can
// have the test this module's own header (guards.ts) promises every guard should have: "as
// pure functions so each can have a test that fails when the guard is removed. A guard buried
// in an I/O runner cannot have one." Before this fix, everything guard 6 asserts about stage 2
// — null counted apart from `false` and never defaulted, `false` incrementing the right
// counter, no backfill on rejection, survivors being exactly the accepted candidates — was a
// ~12-line loop inside `main()` in scripts/cases-caseqa-eval.ts, which the test file never
// imports. Only `parseSubstantive` and the prompt text were tested there: the parser, not the
// wiring around it. Concretely, someone could collapse
//   if (substantive === null) { targetJudgeUnparsed++; continue; }
//   if (!substantive) { targetsRejectedByJudge++; continue; }
// into one branch — typecheck passes, the suite passes, and "substance screen unparseable"
// prints 0 forever, a counter that can never fire.
//
// `screen(candidate)` is injected exactly the way `buildUnanswerablePairs`'s `screen` is
// injected in pairing.ts, so this stays free of any model/IO dependency and a test can supply
// a fake that returns true, false or null without a judge model, a network call, or DynamoDB.
export interface SubstanceScreenResult<T> {
  targets: T[];
  targetsRejectedByJudge: number; // stage 2 said not substantive
  targetJudgeUnparsed: number;    // stage 2's verdict could not be parsed — NOT the same event
}

export async function screenSubstantiveTargets<T>(
  candidates: readonly T[],
  screen: (candidate: T) => Promise<boolean | null>,
): Promise<SubstanceScreenResult<T>> {
  const targets: T[] = [];
  let targetsRejectedByJudge = 0, targetJudgeUnparsed = 0;
  for (const candidate of candidates) {
    const substantive = await screen(candidate);
    // Unparseable is counted apart from a `false` and never defaulted: defaulting to true
    // readmits the front matter this stage exists to exclude, and defaulting to false shrinks
    // the sample on the strength of a judge failure. Neither is a claim we have earned.
    if (substantive === null) { targetJudgeUnparsed++; continue; }
    if (!substantive) { targetsRejectedByJudge++; continue; }
    // No backfill: a rejected candidate is not replaced by drawing another one. The sample
    // stays a function of the seed (via stage 1's candidate list) rather than of the rejection
    // rate — the same rule pickTargets already applies to a case with no eligible paragraph.
    targets.push(candidate);
  }
  return { targets, targetsRejectedByJudge, targetJudgeUnparsed };
}
