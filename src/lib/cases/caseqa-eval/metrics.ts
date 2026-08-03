// Pure scoring. Every denominator is stated in a comment beside it, because the difference
// between "of those attempted" and "of those decided" is the difference between two
// defensible numbers and one misleading one.
import type { Verdict } from "./judge";

export type Outcome = "answered" | "refused" | "errored";

export interface ClaimRecord {
  text: string;
  sourceParagraph: string;
  // null means the JUDGE failed to return a parseable verdict — counted as `unparsed`,
  // never folded into a verdict bucket.
  verdict: Verdict | null;
}

export interface AnswerableRecord {
  kind: "answerable";
  caseId: string; qid: string;
  targetParagraph: string;       // ground truth by construction
  outcome: Outcome;
  failKind?: string;             // when refused
  citedParagraphs: string[];     // when answered
  claims: ClaimRecord[];
  droppedClaims: number;
  bestOverlap?: number;
}

export interface UnanswerableRecord {
  kind: "unanswerable";
  caseId: string; qid: string;
  outcome: Outcome;
  failKind?: string;
  claims: ClaimRecord[];
  droppedClaims: number;
}

export type EvalRecord = AnswerableRecord | UnanswerableRecord;

export interface BucketMetrics {
  attempted: number; answered: number; refused: number; errored: number;
  failKinds: Record<string, number>;
}

// One faithfulness tally. Denominator is `judged` (supported+overstated+contradicted+unrelated),
// NOT judged+unparsed: an unparsed verdict is the judge's failure, not evidence about the
// product. `counts` never gets a null/unparsed bucket — unparsed is tracked only as a count.
export interface FaithfulnessTally {
  judged: number; unparsed: number; counts: Record<Verdict, number>; supportedRate: number;
}

// Split by bucket: a claim published in answer to an UNANSWERABLE question is a false answer
// by construction and skews `unrelated` almost by definition. Blending it into one rate would
// let a bad false-answer rate masquerade as a faithfulness problem, with nothing in the output
// to tell the two apart (spec §4). `combined` is kept for the headline total.
export interface Faithfulness {
  answerable: FaithfulnessTally;
  unanswerable: FaithfulnessTally;
  combined: FaithfulnessTally;
}

export interface Metrics {
  answerable: BucketMetrics & { responsive: number; responsivenessAtPara: number; falseRefusalRate: number };
  unanswerable: BucketMetrics & { falseAnswerRate: number };
  faithfulness: Faithfulness;
  droppedClaims: number;
}

const emptyBucket = (): BucketMetrics =>
  ({ attempted: 0, answered: 0, refused: 0, errored: 0, failKinds: {} });

function tally(b: BucketMetrics, r: EvalRecord) {
  b.attempted++;
  if (r.outcome === "answered") b.answered++;
  else if (r.outcome === "refused") b.refused++;
  else if (r.outcome === "errored") b.errored++;
  else throw new Error(`unknown outcome ${JSON.stringify(r.outcome)} on ${r.qid} — refusing to reconcile`);
  if (r.failKind) b.failKinds[r.failKind] = (b.failKinds[r.failKind] ?? 0) + 1;
}

interface FaithfulnessAcc { judged: number; unparsed: number; counts: Record<Verdict, number> }
const emptyFaithAcc = (): FaithfulnessAcc =>
  ({ judged: 0, unparsed: 0, counts: { supported: 0, overstated: 0, contradicted: 0, unrelated: 0 } });

function tallyClaims(f: FaithfulnessAcc, claims: readonly ClaimRecord[]) {
  for (const c of claims) {
    if (c.verdict === null) f.unparsed++;
    else { f.counts[c.verdict]++; f.judged++; }
  }
}

// of JUDGED, not of all claims: an unparsed verdict is our failure, not the model's.
const withRate = (f: FaithfulnessAcc): FaithfulnessTally =>
  ({ ...f, supportedRate: f.judged ? f.counts.supported / f.judged : 0 });

export function score(records: readonly EvalRecord[]): Metrics {
  if (!records.length) throw new Error("no records — this run measured nothing, refusing to print a scorecard");

  const answerable = emptyBucket(), unanswerable = emptyBucket();
  const faithA = emptyFaithAcc(), faithU = emptyFaithAcc();
  let responsive = 0, droppedClaims = 0;

  for (const r of records) {
    droppedClaims += r.droppedClaims;
    if (r.kind === "answerable") {
      tally(answerable, r);
      tallyClaims(faithA, r.claims);
      // Responsive means the target is AMONG the cited paragraphs. Not "only" the target:
      // an answer that also cites neighbours is fuller, not wrong, and exclusivity would
      // penalise it for a failure mode we are not measuring.
      if (r.outcome === "answered" && r.citedParagraphs.includes(r.targetParagraph)) responsive++;
    } else if (r.kind === "unanswerable") {
      tally(unanswerable, r);
      tallyClaims(faithU, r.claims);
    }
    // No fallthrough tally for any other `kind`: guard 4 below is what catches that.
  }

  // Guard 4. NOT the per-bucket sum: tally() increments `attempted` and exactly one outcome
  // counter or throws, so answered+refused+errored===attempted is an identity and an assertion
  // on it can never fire. What CAN diverge is a record reaching neither bucket — which is what
  // a new `kind` added to EvalRecord without a branch here would do, silently shrinking every
  // denominator.
  if (answerable.attempted + unanswerable.attempted !== records.length) {
    throw new Error(`${records.length} records but ${answerable.attempted} answerable + ` +
      `${unanswerable.attempted} unanswerable were tallied — a record reached neither bucket`);
  }

  // `decided` excludes errored: a call that failed to complete is not a product judgment.
  const decidedA = answerable.answered + answerable.refused;
  const decidedU = unanswerable.answered + unanswerable.refused;

  const combined: FaithfulnessAcc = {
    judged: faithA.judged + faithU.judged,
    unparsed: faithA.unparsed + faithU.unparsed,
    counts: {
      supported: faithA.counts.supported + faithU.counts.supported,
      overstated: faithA.counts.overstated + faithU.counts.overstated,
      contradicted: faithA.counts.contradicted + faithU.counts.contradicted,
      unrelated: faithA.counts.unrelated + faithU.counts.unrelated,
    },
  };

  return {
    answerable: { ...answerable, responsive,
      // of ANSWERED, not of attempted: a refusal cannot cite anything.
      responsivenessAtPara: answerable.answered ? responsive / answerable.answered : 0,
      falseRefusalRate: decidedA ? answerable.refused / decidedA : 0 },
    unanswerable: { ...unanswerable,
      falseAnswerRate: decidedU ? unanswerable.answered / decidedU : 0 },
    faithfulness: { answerable: withRate(faithA), unanswerable: withRate(faithU), combined: withRate(combined) },
    droppedClaims,
  };
}
