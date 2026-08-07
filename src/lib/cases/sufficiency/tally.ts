// Pre-registered 2026-08-07, BEFORE any rater response was read. Constants rather than inline
// literals so the rule cannot be quietly relaxed after seeing the numbers — the discipline this
// project has kept on every instrument, and the one that made #237's result honest when the
// pre-registered rule passed and the finding was still negative.

export interface ArmCounts { sufficient: number; insufficient: number }

// The product's CURRENT false-refusal rate is 0.0% (2026-08-06 run, 38 answerable questions,
// zero refusals of any kind). Every refusal this gate introduces is therefore a NEW cost that
// did not exist before, paid on questions the product answers correctly today. 5% is the level
// at which the trade is worth making.
export const FALSE_REFUSAL_MAX = 0.05;

// Against a measured baseline of 93.8% (15 of 16 unanswerable questions answered).
export const PROJECTED_FALSE_ANSWER_MAX = 0.20;
export const BASELINE_FALSE_ANSWER = 0.938;

const rate = (n: number, d: number): number => (d === 0 ? 0 : n / d);

// Arm S: the questions are answerable by construction. The rater calling one `insufficient`
// would make the product refuse a question it answers correctly today.
export const falseRefusalRate = (c: ArmCounts): number =>
  rate(c.insufficient, c.sufficient + c.insufficient);

// Arm X: the gate only blocks what it calls insufficient, so everything it calls `sufficient`
// reaches the answerer and is answered at today's rate. This is an UPPER BOUND on the resulting
// false-answer rate — a question the gate passes can still be refused downstream by
// verifyClaims, as one was — and the bound is what the threshold is set against.
export const projectedFalseAnswerRate = (c: ArmCounts): number =>
  rate(c.sufficient, c.sufficient + c.insufficient);

export type Decision = "ship" | "tune-do-not-ship" | "inert" | "unusable";

// Order matters and is not arbitrary. False refusal is checked first because it is the cost the
// product does not currently pay at all; a gate that refuses good questions is a regression
// however well it catches bad ones. "inert" is the #237 gate-A outcome: safe, correct, and not
// worth building.
export function decide(falseRefusal: number, projectedFalseAnswer: number): Decision {
  const refusalOk = falseRefusal <= FALSE_REFUSAL_MAX;
  const catchOk = projectedFalseAnswer <= PROJECTED_FALSE_ANSWER_MAX;
  if (refusalOk && catchOk) return "ship";
  if (!refusalOk && catchOk) return "tune-do-not-ship";
  if (refusalOk && !catchOk) return "inert";
  return "unusable";
}

// An UNPARSED response is evidence: the rater was asked and produced something no parser
// accepts. A FAILED CALL is not evidence about anything — the request never reached the model.
// Rates computed over the survivors of an outage are not rates, so this throws rather than
// annotating: a caveat printed under a headline number gets read as a caveat.
export function assertNoCallFailures(callFailures: number, context: string): void {
  if (callFailures > 0) {
    throw new Error(
      `${callFailures} call(s) failed outright during ${context} — the run is void, not merely ` +
      `incomplete. Unlike an unparsed response, a failed call says nothing about the rater, so ` +
      `every rate below it would be computed over an arbitrary subset. Fix the cause (most often: ` +
      `expired credentials) and re-run; responses already cached will replay for free.`,
    );
  }
}
