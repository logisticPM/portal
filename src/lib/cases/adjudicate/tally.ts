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
  first: Answer;   // the ordering presented first
  second: Answer;  // the same pair with the candidates swapped
}

export interface Tally {
  pairs: number;
  unparseable: number;
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
  // null when the flip gate trips. Withheld rather than flagged, so a caller cannot print a
  // number the spec says is not interpretable.
  agreementRate: number | null;
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
    const namesBest = same(r.citedPara, r.bestPara), namesRival = same(r.citedPara, r.rivalPara);
    // citedPara pointing somewhere else entirely cannot agree OR disagree with the judge.
    // #228 found 4 of 15 rows here; scoring them as disagreements would manufacture a negative.
    if (!namesBest && !namesRival) { citedNamesNeither++; continue; }
    if ((r.first === "best" && namesBest) || (r.first === "rival" && namesRival)) agreed++;
  }

  if (consistent + flipped + unparseable !== rows.length) {
    throw new Error(`${rows.length} pairs but ${consistent}+${flipped}+${unparseable} accounted for — a row reached no bucket`);
  }

  const comparable = decided - citedNamesNeither;
  const flipRate = flipped / rows.length;
  const flipGateTripped = flipRate >= FLIP_GATE;
  const abstentionRate = consistent ? abstained / consistent : 0;

  return {
    pairs: rows.length, unparseable, flipped, consistent, abstained, decided,
    citedNamesNeither, comparable, agreed,
    flipRate, abstentionRate,
    flipGateTripped, abstentionGateTripped: abstentionRate >= ABSTENTION_GATE,
    // Withheld entirely when the flip gate trips: spec §3 says the agreement metric is not
    // computed in that case, and returning a number a caller might print anyway would defeat
    // the pre-registration.
    agreementRate: flipGateTripped || !comparable ? null : agreed / comparable,
    p: flipGateTripped ? null : pValue(agreed, comparable - agreed),
  };
}
