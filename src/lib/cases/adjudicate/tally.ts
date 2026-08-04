// Pure scoring for the decline adjudication (spec 2026-08-04 §3, §8).
//
// Every denominator narrows, and each narrowing has a reason stated beside it. The final one
// may be very small — #228 found citedPara naming a candidate in only 9 of 15 — so each is
// printed with its numerator by the runner rather than as a bare percentage.

// Pre-registered in spec §3 BEFORE any data was seen. A threshold chosen afterwards is not a
// threshold; this is the discipline that made the CanLegalRAGBench negative clean.
export const FLIP_GATE = 1 / 3;
export const ABSTENTION_GATE = 1 / 2;

// Which candidate the judge's pick resolved to, once the A/B labelling is undone.
export type Side = "best" | "rival";
export type Answer = Side | "unsure" | null; // null = we could not parse the response

export interface PairRow {
  caseId: string;
  quote: string;
  bestPara: string;
  rivalPara: string;
  citedPara: string;
  // Both paragraphs' lengths and overlap scores (spec §9.5), carried straight from the drop
  // record so a reader can test a length- or overlap-heuristic explanation against any positive
  // result (spec §10: position bias is controlled by the order swap, length/salience are not).
  bestLen: number;
  rivalLen: number;
  bestOverlap: number;
  rivalOverlap: number;
  first: Answer;   // the ordering presented first
  second: Answer;  // the same pair with the candidates swapped
}

// The two distinct reasons `agreementRate` can be withheld (spec §8, amended 2026-08-04). The
// flip gate tripping is one; `comparable === 0` — citedPara naming neither candidate in every
// decided row, or there being no decided rows at all — is the other, and it is NOT remote: #228
// found citedPara naming neither candidate in 6 of 15 rows, so `comparable` starts at 9 before a
// single flip or abstention. A caller must not collapse these into one message: printing "the
// flip gate tripped" when it did not would make the run's own output assert spec §3's outcome 1
// while the data landed in outcome 2 or 3, which §13 requires the findings doc to get right.
export type AgreementWithheldReason = "flip_gate_tripped" | "no_comparable_rows";

export interface Tally {
  pairs: number;
  unparseable: number;
  // pairs - unparseable: the flip-rate denominator (spec §8, amended 2026-08-04). Printed
  // separately so the runner never has to re-derive it.
  readable: number;
  flipped: number;
  consistent: number;
  abstained: number;
  decided: number;           // consistent and not an abstention
  citedNamesNeither: number; // of `decided`: citedPara matches neither candidate
  comparable: number;        // decided - citedNamesNeither
  agreed: number;            // of `comparable`: judge's side is the one citedPara names
  flipRate: number;
  abstentionRate: number;
  flipGateTripped: boolean;
  abstentionGateTripped: boolean;
  // null when withheld — see `agreementWithheldReason` for which of the two causes applied.
  // Withheld rather than flagged, so a caller cannot print a number the spec says is not
  // interpretable.
  agreementRate: number | null;
  agreementWithheldReason: AgreementWithheldReason | null;
  p: number | null;
}

// Digit-run comparison, deliberately identical to the rule
// `2026-08-03-anchor-signals-results.md` used, so the two reports can be read side by side.
// It is looser than production's findCited — that report explains why a ceiling wants the
// generous reading.
const digits = (s: string) => s.match(/\d+/)?.[0] ?? null;
const same = (a: string, b: string) => {
  const x = digits(a), y = digits(b);
  return x !== null && x === y;
};

// Which candidate (if either) `citedPara` names, by the same digit-run rule as `same` above.
// Exported so the runner can print, per row, which side citedPara names and whether the judge
// agreed — spec §9.5 requires `agreed` to be printed rather than left for a reader to re-derive
// by applying this rule by eye against the aggregate.
export function citedSide(citedPara: string, bestPara: string, rivalPara: string): Side | null {
  if (same(citedPara, bestPara)) return "best";
  if (same(citedPara, rivalPara)) return "rival";
  return null;
}

// Exact for every n in play here; checked against BigInt for n <= 15 in the anchor-signals work.
const choose = (n: number, k: number) => { let v = 1; for (let i = 0; i < k; i++) v = (v * (n - i)) / (i + 1); return v; };
// Two-sided binomial against p=0.5, exact by doubling because Binomial(n, 0.5) is symmetric.
const pValue = (a: number, b: number) => {
  const n = a + b, k = Math.max(a, b);
  if (n === 0) return null;
  let tail = 0;
  for (let i = k; i <= n; i++) tail += choose(n, i);
  return Math.min(1, (2 * tail) / Math.pow(2, n));
};

// Spec §9.6. Which of the three mutually-exclusive buckets a row belongs in, computed FRESH from
// the row's own fields — a separate computation from the loop in `tally`, which also has to
// accumulate `decided`, `abstained`, `citedNamesNeither` and `agreed` and could in principle
// mis-bucket a row (e.g. a missing `continue`) without this ever noticing, since it looks only
// at `first`/`second` and touches none of the loop's counters.
type Bucket = "unparseable" | "flipped" | "consistent";
function classify(r: PairRow): Bucket {
  if (r.first === null || r.second === null) return "unparseable";
  if (r.first !== r.second) return "flipped";
  return "consistent";
}

// Spec §9.6: reconciliation must be computed independently of the branch that assigns the
// bucket. `consistent + flipped + unparseable === rows.length` is an IDENTITY — the loop below
// hits exactly one of those three increments before any later `continue`, so the three cases are
// exhaustive by construction and that sum can never disagree with `rows.length`. A sibling
// branch shipped exactly that unreachable assertion, and its test passed on the identity rather
// than the guard. This instead reclassifies every row from scratch via `classify` and compares
// the result against what the loop actually counted, so a bug that buckets a row inconsistently
// (double-counted, or counted under the wrong label) shows up as a disagreement between two
// independently-derived tallies rather than as an identity that trivially holds.
export function reconcileBuckets(
  rows: readonly PairRow[],
  counted: { unparseable: number; flipped: number; consistent: number },
): void {
  const recount: Record<Bucket, number> = { unparseable: 0, flipped: 0, consistent: 0 };
  for (const r of rows) recount[classify(r)]++;
  if (
    recount.unparseable !== counted.unparseable ||
    recount.flipped !== counted.flipped ||
    recount.consistent !== counted.consistent
  ) {
    throw new Error(
      `reconciliation failed: classifying every row independently gives ${JSON.stringify(recount)}, ` +
      `but the tally loop counted ${JSON.stringify(counted)} — a row was bucketed inconsistently`,
    );
  }
}

export function tally(rows: readonly PairRow[]): Tally {
  if (!rows.length) throw new Error("no pairs — this run measured nothing, refusing to print a scorecard");

  let unparseable = 0, flipped = 0, consistent = 0, abstained = 0, decided = 0,
      citedNamesNeither = 0, agreed = 0;

  for (const r of rows) {
    // Checked FIRST: an unreadable response is our failure, and asking whether it "flipped"
    // would treat a missing answer as a disagreement.
    if (r.first === null || r.second === null) { unparseable++; continue; }
    if (r.first !== r.second) { flipped++; continue; }
    consistent++;
    if (r.first === "unsure") { abstained++; continue; }
    decided++;
    const side = citedSide(r.citedPara, r.bestPara, r.rivalPara);
    // citedPara pointing somewhere else entirely cannot agree OR disagree with the judge.
    // #228 found 6 of 15 rows here — 15 - (cited=best 6 + cited=rival 3) = 6, cross-checked as
    // best±1 2 + rival±1 1 + elsewhere 3 + no-digits 0. Scoring them as disagreements would
    // manufacture a negative.
    if (side === null) { citedNamesNeither++; continue; }
    if (r.first === side) agreed++;
  }

  reconcileBuckets(rows, { unparseable, flipped, consistent });

  const comparable = decided - citedNamesNeither;
  const readable = rows.length - unparseable;
  // Spec §8 (amended 2026-08-04): the denominator is READABLE pairs, not all pairs. An
  // unparseable row can never enter the numerator (it is excluded above before flip/consistent
  // is even asked), so counting it in the denominator only dilutes the gate with our own parse
  // failures: 4 flipped + 5 unparseable + 6 consistent reads as 4/15 = 26.7% (gate not tripped)
  // but is 4/10 = 40% among the pairs we could actually read (gate tripped). Guarded against
  // readable === 0: that only happens when every pair was unparseable, in which case `flipped`
  // is necessarily 0 too (it can only come from a readable pair) — 0 rather than NaN keeps
  // `flipGateTripped` a real boolean instead of `NaN >= FLIP_GATE`.
  const flipRate = readable > 0 ? flipped / readable : 0;
  const flipGateTripped = flipRate >= FLIP_GATE;
  const abstentionRate = consistent ? abstained / consistent : 0;

  const agreementWithheldReason: AgreementWithheldReason | null =
    flipGateTripped ? "flip_gate_tripped" : comparable === 0 ? "no_comparable_rows" : null;

  return {
    pairs: rows.length, unparseable, readable, flipped, consistent, abstained, decided,
    citedNamesNeither, comparable, agreed,
    flipRate, abstentionRate,
    flipGateTripped, abstentionGateTripped: abstentionRate >= ABSTENTION_GATE,
    // Withheld entirely when either cause applies: spec §3 says the agreement metric is not
    // computed when the flip gate trips, and there is nothing to compute when no row is
    // comparable either way. Returning a number a caller might print regardless would defeat
    // the pre-registration.
    agreementRate: agreementWithheldReason ? null : agreed / comparable,
    agreementWithheldReason,
    p: agreementWithheldReason ? null : pValue(agreed, comparable - agreed),
  };
}
