// Spec §9.1 as a pure function, so it can have a test that fails when it is removed. A guard
// buried in an I/O runner cannot have one, and on a sibling branch that gap let a counter ship
// that could never fire.

// The whole measurement is "does an INDEPENDENT reader agree with the summarizer's citedPara".
// If the summarizer adjudicates, the answer is self-consistency and the report would present it
// as corroboration — the failure mode #228 was written to avoid, reintroduced one layer up.
export function assertJudgeIsNotSummarizer(judge: string, summarizer: string): void {
  if (judge === summarizer) {
    throw new Error(`the judge must not be the summarizer (${summarizer}) — it would be grading ` +
      `its own bookkeeping, and the result would be self-consistency presented as corroboration`);
  }
}
