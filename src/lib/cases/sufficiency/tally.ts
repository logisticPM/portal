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

// Wilson score interval — the right one for proportions near 0 or 1, where the normal
// approximation produces negative lower bounds. Both this experiment's bars sit near 0.
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// Reported ALONGSIDE the point-estimate rule in `decide`, never instead of it. #239 judged on
// point estimates; switching to an interval rule now would move the goalposts mid-experiment,
// even though it moves them in the harder direction.
//
// What this adds is honesty about power: at n=80 a perfect arm S clears a 5% bar and ONE failure
// does not, so most outcomes in between settle nothing. Saying so up front prevents a later
// argument that 1 of 80 is "basically 5%".
export type Confidence = "clears" | "fails" | "inconclusive-at-this-n";

export function classify(k: number, n: number, bar: number): Confidence {
  const [lo, hi] = wilson(k, n);
  if (lo <= bar && bar <= hi) return "inconclusive-at-this-n";
  return hi < bar ? "clears" : "fails";
}

export interface DevResult { configId: string; armS: ArmCounts; armX: ArmCounts }

// Pre-registered (spec §6): lowest arm-S false refusal AMONG those whose arm-X leakage clears
// its bar. The order is not cosmetic — leakage is the defect the gate exists to fix, so a
// configuration that lets questions through is disqualified no matter how few good questions it
// refuses. Ties break on configId so the same dev data always yields the same choice.
export function selectOnDev(results: readonly DevResult[]): { chosen: DevResult | null; reason: string } {
  if (results.length === 0) return { chosen: null, reason: "no configurations were evaluated" };
  const qualified = results.filter((r) => projectedFalseAnswerRate(r.armX) <= PROJECTED_FALSE_ANSWER_MAX);
  if (qualified.length === 0) {
    const best = Math.min(...results.map((r) => projectedFalseAnswerRate(r.armX)));
    return {
      chosen: null,
      reason: `no configuration kept leakage at or below ${(PROJECTED_FALSE_ANSWER_MAX * 100).toFixed(0)}% ` +
        `(best was ${(best * 100).toFixed(1)}%) — the bar is not relaxed, so there is nothing to test`,
    };
  }
  const sorted = [...qualified].sort((a, b) =>
    falseRefusalRate(a.armS) - falseRefusalRate(b.armS) ||
    projectedFalseAnswerRate(a.armX) - projectedFalseAnswerRate(b.armX) ||
    a.configId.localeCompare(b.configId));
  const chosen = sorted[0];
  return {
    chosen,
    reason: `${chosen.configId}: false refusal ${(falseRefusalRate(chosen.armS) * 100).toFixed(1)}%, ` +
      `leakage ${(projectedFalseAnswerRate(chosen.armX) * 100).toFixed(1)}% — lowest false refusal of ` +
      `${qualified.length} configuration(s) that cleared the leakage bar, out of ${results.length} evaluated`,
  };
}
