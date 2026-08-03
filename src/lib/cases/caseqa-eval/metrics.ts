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
export interface Metrics {
  answerable: BucketMetrics & { responsive: number; responsivenessAtPara: number; falseRefusalRate: number };
  unanswerable: BucketMetrics & { falseAnswerRate: number };
  faithfulness: { judged: number; unparsed: number; counts: Record<Verdict, number>; supportedRate: number };
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

export function score(records: readonly EvalRecord[]): Metrics {
  if (!records.length) throw new Error("no records — this run measured nothing, refusing to print a scorecard");

  const answerable = emptyBucket(), unanswerable = emptyBucket();
  let responsive = 0, droppedClaims = 0, unparsed = 0;
  const counts: Record<Verdict, number> = { supported: 0, overstated: 0, contradicted: 0, unrelated: 0 };

  for (const r of records) {
    droppedClaims += r.droppedClaims;
    for (const c of r.claims) {
      if (c.verdict === null) unparsed++;
      else counts[c.verdict]++;
    }
    if (r.kind === "answerable") {
      tally(answerable, r);
      // Responsive means the target is AMONG the cited paragraphs. Not "only" the target:
      // an answer that also cites neighbours is fuller, not wrong, and exclusivity would
      // penalise it for a failure mode we are not measuring.
      if (r.outcome === "answered" && r.citedParagraphs.includes(r.targetParagraph)) responsive++;
    } else tally(unanswerable, r);
  }

  for (const [name, b] of [["answerable", answerable], ["unanswerable", unanswerable]] as const) {
    if (b.answered + b.refused + b.errored !== b.attempted) {
      throw new Error(`${name}: ${b.answered}+${b.refused}+${b.errored} does not reconcile with ${b.attempted} attempted`);
    }
  }

  // `decided` excludes errored: a call that failed to complete is not a product judgment.
  const decidedA = answerable.answered + answerable.refused;
  const decidedU = unanswerable.answered + unanswerable.refused;
  const judged = counts.supported + counts.overstated + counts.contradicted + counts.unrelated;

  return {
    answerable: { ...answerable, responsive,
      // of ANSWERED, not of attempted: a refusal cannot cite anything.
      responsivenessAtPara: answerable.answered ? responsive / answerable.answered : 0,
      falseRefusalRate: decidedA ? answerable.refused / decidedA : 0 },
    unanswerable: { ...unanswerable,
      falseAnswerRate: decidedU ? unanswerable.answered / decidedU : 0 },
    faithfulness: { judged, unparsed, counts,
      // of JUDGED, not of all claims: an unparsed verdict is our failure, not the model's.
      supportedRate: judged ? counts.supported / judged : 0 },
    droppedClaims,
  };
}
