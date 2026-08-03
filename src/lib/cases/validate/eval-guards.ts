// Did the eval measure anything at all?
//
// On 2026-08-02 the runner printed a complete scorecard of zeros and exited 0, because it
// ranked against an empty unit list. Every number was arithmetically correct and
// collectively meaningless. A zero has to be EARNED — a retriever that misses every judged
// case — not defaulted to by an instrument with no input.
//
// Pure and separately importable: cases-eval.ts ends in run(), so an inline guard could
// only be exercised by running the whole credentialed eval.
export interface EvalEvidence {
  caseCount: number;          // cases in the loaded index
  emptyRankedLists: number;   // (query, mode) pairs that returned []
  totalRankedLists: number;   // (query, mode) pairs attempted
  metrics: number[];          // every aggregate metric about to be printed
}

export function evalAbortReason(e: EvalEvidence): string | null {
  if (e.caseCount === 0) {
    return "index is empty (0 cases) — nothing to score. Check INDEX_BUCKET/INDEX_FILE and CASES_TABLE.";
  }
  // Ordered before the all-zero check so the message names the cause rather than the
  // symptom; the all-zero check would also fire here and say less.
  if (e.totalRankedLists > 0 && e.emptyRankedLists === e.totalRankedLists) {
    return `every ranked list came back empty (${e.emptyRankedLists}/${e.totalRankedLists}) — the retriever found nothing for any query. ` +
      "This is a broken index, not a score of zero.";
  }
  if (e.metrics.length > 0 && e.metrics.every((m) => m === 0)) {
    return "every metric is exactly 0 across every mode — the ranked lists share nothing with any judgment. " +
      "A real corpus cannot miss all judged cases in all modes; suspect the instrument, not the retriever.";
  }
  return null;
}
