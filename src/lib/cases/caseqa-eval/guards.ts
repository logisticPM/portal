// Guards 1 and 5 from spec §7, as pure functions so each can have a test that fails when
// the guard is removed. A guard buried in an I/O runner cannot have one, and this project
// has already shipped a runner that printed a full scorecard of zeros and exited 0.

export interface ModelRoles { writer: string; answerer: string; judge: string }

// A model grading its own output measures self-consistency; a model answering its own
// question measures nothing at all. Names the colliding roles, because "not distinct" on
// its own sends the reader back to the env vars to work out which.
export function assertDistinctModels(m: ModelRoles): void {
  const pairs: [keyof ModelRoles, keyof ModelRoles][] = [["writer", "answerer"], ["writer", "judge"], ["answerer", "judge"]];
  const clashes = pairs.filter(([a, b]) => m[a] === m[b]).map(([a, b]) => `${a}=${b}`);
  if (clashes.length) {
    throw new Error(`writer, answerer and judge must be three distinct models — collision(s): ${clashes.join(", ")} ` +
      `(writer=${m.writer} answerer=${m.answerer} judge=${m.judge})`);
  }
}

export interface Provenance extends ModelRoles {
  seed: number;
  // The corpus snapshot the sample was drawn against (spec §7 guard 5). EVAL_SEED reproduces
  // the SAMPLE only relative to a fixed corpus: listCases({tier:"core"}) is unbounded, so if
  // the corpus gains cases, the same seed shuffles a longer list into a completely different
  // 40 and every metric moves for reasons unrelated to the product. `asOf` is what lets a
  // reader tell "the prompt got worse" from "the corpus changed underneath me".
  asOf: string;
  casesWithChunks: number; targets: number;
  built: number; gimmes: number; writerFails: number; writerMalformed: number;
  pairs: number; discardedPairs: number; addressedFails: number;
  // Named per FIX B/D (2026-08-03 review): a skip path with no counter is a skip path a
  // reader cannot see. `pairingExhausted` is a source question for which every candidate
  // case had already been drawn (paired or rejected) before a usable one was found.
  // `targetDroppedByBudget` is an answerable question excluded because its own ground-truth
  // paragraph fell outside assembleInput's 240k-char budget and so never reached the
  // answerer — see the check beside `assembleInput` in the runner.
  pairingExhausted: number;
  targetDroppedByBudget: number;
  // Target eligibility, spec §7.6 (2026-08-04). FOUR counters, not one total: `noLongPara` is
  // a fact about the corpus, `targetsRejectedByShape` is stage 1 working, and the two judge
  // counters separate "the judge said no" from "the judge could not be parsed". If stage 2
  // starts rejecting most of what stage 1 passes, the deterministic threshold is wrong — and
  // a single merged number would absorb exactly that signal instead of showing it.
  noLongPara: number;
  targetsRejectedByShape: number;
  // Paragraph-level, and the only counter that shows stage 1 working in the common case: the
  // caption lives in a case whose other paragraphs are fine, so it is excluded without the
  // case-level counter ever moving.
  paragraphsRejectedByShape: number;
  targetsRejectedByJudge: number;
  targetJudgeUnparsed: number;
  // FIX 2 (2026-08-04 review). pickTargets stops as soon as it has enough targets, so cases
  // after that point are never inspected — the five counters above describe a PREFIX of
  // casesWithChunks, not the corpus. A run where the first 43 shuffled cases happen to be clean
  // prints all-zero rejection counts, indistinguishable from "the corpus has no front matter"
  // without this number, and a reader otherwise cannot reconcile e.g. 500 cases / 40 targets /
  // 0 rejections — 460 cases unaccounted for.
  casesExamined: number;
}

// The target-eligibility counters (spec §7.6), factored out so the runner can print them BEFORE
// its "no eligible target survived" throw (FIX 5, 2026-08-04 review) using the exact same
// labels as the full provenance line below — full Provenance isn't assembled yet at that point
// (built, gimmes, pairs, ... all come from stages that haven't run), so printing just these
// counters, worded identically, is what keeps the early diagnostic and the later line from
// drifting apart.
export interface TargetEligibilityCounts {
  casesExamined: number;
  noLongPara: number;
  targetsRejectedByShape: number;
  paragraphsRejectedByShape: number;
  targetsRejectedByJudge: number;
  targetJudgeUnparsed: number;
}

export function formatTargetEligibility(c: TargetEligibilityCounts): string {
  return [
    `target eligibility — cases examined ${c.casesExamined} (a prefix: sampling stops once` +
      ` enough targets are found, so cases after that point are never inspected)`,
    `  cases: no paragraph over the length floor ${c.noLongPara}` +
      ` · every long paragraph rejected by the line-shape test ${c.targetsRejectedByShape}`,
    // FIX 6 (2026-08-04 review): this used to be indented directly under the case-level shape
    // count above, which reads as a breakdown of it — with realistic numbers (1 and 47) that
    // reads as "47 out of 1", actively misleading. It is a DIFFERENT population (paragraphs,
    // not cases) counted across a different scope, so it is labelled as such rather than
    // nested, and the legitimate overlap is stated: `paragraphsRejectedByShape` runs before
    // `rejectedByShape` for a given case, so a fully-rejected case's paragraphs are counted in
    // both, and a reader who sums the two would double-count them.
    // FIX 8: "rejected by the line-shape test" describes what the TEST measured (line length),
    // not the conclusion ("front matter") stage 1 is not equipped to reach on its own.
    `  paragraphs — rejected by the line-shape test ${c.paragraphsRejectedByShape}` +
      ` (a different unit than the case counts above; overlaps with them for a fully-rejected case)`,
    `  cases: judged not substantive ${c.targetsRejectedByJudge}` +
      ` · substance screen unparseable ${c.targetJudgeUnparsed}`,
  ].join("\n");
}

// Printed BEFORE any metric. Every discard is named as well as counted: a question set that
// shrank from 40 to 12 produces perfectly well-formed percentages, and the only way a reader
// can tell is if the shrinkage is on the page next to them.
export function formatProvenance(p: Provenance): string {
  return [
    ``,
    `writer   ${p.writer}`,
    `answerer ${p.answerer}`,
    `judge    ${p.judge}`,
    `seed ${p.seed} · corpus as of ${p.asOf} · core cases with chunks ${p.casesWithChunks} · targets ${p.targets}`,
    `questions built ${p.built} · rejected as lexical gimmes ${p.gimmes} · writer returned nothing ${p.writerFails}`,
    `  writer returned a malformed/truncated question ${p.writerMalformed}`,
    `answerable dropped — target paragraph outside assembleInput's budget: ${p.targetDroppedByBudget}`,
    `unanswerable pairs ${p.pairs} · discarded ${p.discardedPairs} (unparseable screen ${p.addressedFails})` +
      ` · candidates exhausted (no undrawn case left) ${p.pairingExhausted}`,
    formatTargetEligibility(p),
  ].join("\n");
}

// Guard 7 (spec §7.7, 2026-08-04). The caption bug survived an entire run because nothing
// printed what the instrument had chosen; the aggregate looked well-formed either way. The
// sample is part of the evidence, so it goes in the output next to the metrics computed from it.
// 120 to match spec §7.7. Enough to recognise a caption on sight — the one that got through
// begins "2002BCSC1199 Citation: William et al. v. Riverside Forest Products..." — while
// keeping a 40-target block readable. Exported (FIX 9, 2026-08-04 review) so the test can pin
// it to exactly 120 rather than only bracketing it with a "120 present, 200 absent" pair of
// `includes` checks, which leaves anything in [120, 199] able to drift the constant unnoticed.
export const TARGET_PREVIEW_CHARS = 120;

export function formatChosenTargets(
  targets: readonly { caseId: string; paragraph: string; text: string }[],
): string {
  const rows = targets.map((t) => {
    const head = t.text.replace(/\s+/g, " ").slice(0, TARGET_PREVIEW_CHARS);
    return `  ${t.caseId.padEnd(16)} ${t.paragraph.padEnd(10)} ${JSON.stringify(head)}`;
  });
  // FIX 10 (2026-08-04 review, spec §7.7): this block prints BEFORE question construction, so
  // a target later dropped as a lexical gimme, a malformed/truncated question, or outside
  // assembleInput's budget still appears here. It is a superset of what gets measured, and the
  // header says so — otherwise the row count here does not reconcile with `built` and a reader
  // has no way to tell that apart from a bug.
  return [`\n--- chosen targets (${targets.length}) — a SUPERSET of what gets measured: a` +
    ` target later dropped as a lexical gimme, a malformed question, or outside the assembly` +
    ` budget still appears below ---`, ...rows].join("\n");
}
