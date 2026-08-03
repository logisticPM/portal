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
  built: number; gimmes: number; writerFails: number;
  pairs: number; discardedPairs: number; addressedFails: number;
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
    `unanswerable pairs ${p.pairs} · discarded ${p.discardedPairs} (unparseable screen ${p.addressedFails})`,
  ].join("\n");
}
