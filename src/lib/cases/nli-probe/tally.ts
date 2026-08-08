// Pure scoring for the rung-3 probe. Separated from the runner so the decision rule can be
// tested against hand-built matrices — the same reason judge/metrics are separate in
// caseqa-eval. A threshold that only ever runs on live data has never been checked.

import type { NliLabel } from "./prompt";

export type JudgeVerdict = "supported" | "overstated" | "contradicted" | "unrelated";
export const JUDGE_VERDICTS: readonly JudgeVerdict[] = ["supported", "overstated", "contradicted", "unrelated"];
export const NLI_LABELS: readonly NliLabel[] = ["entailment", "neutral", "contradiction"];

export type Cell = Record<NliLabel, number>;
export type Confusion = Record<JudgeVerdict, Cell>;

export const emptyConfusion = (): Confusion =>
  Object.fromEntries(JUDGE_VERDICTS.map((v) => [v, { entailment: 0, neutral: 0, contradiction: 0 }])) as Confusion;

export function addToConfusion(c: Confusion, verdict: JudgeVerdict, label: NliLabel): void {
  c[verdict][label] += 1;
}

export const rowTotal = (cell: Cell): number => cell.entailment + cell.neutral + cell.contradiction;

// Pre-registered 2026-08-07, BEFORE any probe response was read. Declared as constants so
// the rule cannot be quietly relaxed after seeing the numbers — the failure mode this
// project has repeatedly guarded against.
//
// FALSE_ALARM_MAX: a gate that flags claims the judge called SUPPORTED is worse than no
// gate, because every false alarm costs a true statement. 5% is the level at which a
// reviewer would still trust the flag.
// SYNTHETIC_RECALL_MIN: on MANUFACTURED negations, which are easier than natural ones.
// Failing 80% here means failing worse in the wild, so this is a necessary condition, not
// a sufficient one.
export const FALSE_ALARM_MAX = 0.05;
export const SYNTHETIC_RECALL_MIN = 0.8;

export type Decision = "ship" | "safe-but-weak" | "unusable";

// Reported alongside the raw counts, never instead of them. Order matters: false alarm is
// checked first because a noisy gate is unusable at ANY recall, while a quiet gate that
// misses things is merely disappointing.
export function decide(falseAlarmRate: number, syntheticRecall: number): Decision {
  if (falseAlarmRate > FALSE_ALARM_MAX) return "unusable";
  return syntheticRecall >= SYNTHETIC_RECALL_MIN ? "ship" : "safe-but-weak";
}

export const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

// Two very different things were being counted in one bucket, and the 2026-08-07 re-run is
// why this exists. An UNPARSED response is evidence: the checker was asked and produced
// something no parser accepts. A FAILED CALL is not evidence about anything — the request
// never reached the model (expired SSO token, throttle, network), so the row is missing for
// a reason unrelated to the thing being measured.
//
// That run lost 21 calls to an expired token, printed a matrix identical to the previous
// one, and exited 0 with "VERDICT: SHIP". Rates computed over the survivors of an auth
// failure are not rates. Any call failure invalidates the run, so the guard throws instead
// of annotating — a caveat printed under a headline number gets read as a caveat, and this
// is not a caveat.
export function assertNoCallFailures(callFailures: number, context: string): void {
  if (callFailures > 0) {
    throw new Error(
      `${callFailures} call(s) failed outright during ${context} — the run is void, not merely incomplete. ` +
      `Unlike an unparsed response, a failed call says nothing about the checker, so every rate below it ` +
      `would be computed over an arbitrary subset. Fix the cause (most often: expired credentials) and re-run; ` +
      `responses already cached will replay for free.`,
    );
  }
}

export function formatConfusion(c: Confusion): string {
  const w = 14;
  const head = "judge \\ nli".padEnd(w) + NLI_LABELS.map((l) => l.padStart(15)).join("") + "".padStart(9) + "total";
  const rows = JUDGE_VERDICTS.map((v) => {
    const t = rowTotal(c[v]);
    return v.padEnd(w) + NLI_LABELS.map((l) => `${c[v][l]} (${pct(c[v][l], t)})`.padStart(15)).join("") + String(t).padStart(14);
  });
  return [head, ...rows].join("\n");
}
