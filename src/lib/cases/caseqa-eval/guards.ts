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
    `targets rejected — no paragraph over the length floor ${p.noLongPara}` +
      ` · every long paragraph the wrong shape ${p.targetsRejectedByShape}`,
    `  individual paragraphs rejected as front matter ${p.paragraphsRejectedByShape}`,
    `  judged not substantive ${p.targetsRejectedByJudge} · substance screen unparseable ${p.targetJudgeUnparsed}`,
  ].join("\n");
}

// Guard 7 (spec §7.7, 2026-08-04). The caption bug survived an entire run because nothing
// printed what the instrument had chosen; the aggregate looked well-formed either way. The
// sample is part of the evidence, so it goes in the output next to the metrics computed from it.
// 120 to match spec §7.7. Enough to recognise a caption on sight — the one that got through
// begins "2002BCSC1199 Citation: William et al. v. Riverside Forest Products..." — while
// keeping a 40-target block readable.
const TARGET_PREVIEW_CHARS = 120;

export function formatChosenTargets(
  targets: readonly { caseId: string; paragraph: string; text: string }[],
): string {
  const rows = targets.map((t) => {
    const head = t.text.replace(/\s+/g, " ").slice(0, TARGET_PREVIEW_CHARS);
    return `  ${t.caseId.padEnd(16)} ${t.paragraph.padEnd(10)} ${JSON.stringify(head)}`;
  });
  return [`\n--- chosen targets (${targets.length}) ---`, ...rows].join("\n");
}
