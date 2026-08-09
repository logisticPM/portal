// The dev/test split, and the guard that it stayed a split.
//
// Why this exists: after #239 we have data, so tuning against the same questions and reporting
// the improvement is fitting to the test set. All tuning looks at dev; the chosen configuration
// runs on test once. That only works if test is genuinely untouched, which is a property of
// this file.
//
// Determinism is load-bearing in a way that is easy to miss: the dev run and the test run are
// SEPARATE PROCESSES, each recomputing the split from the same seed. If they disagreed, the
// "held-out" set would contain questions the tuning already saw, and no number in the report
// would mean what it says.
import { seededShuffle } from "../caseqa-eval/rng";

export interface Split<T> { dev: T[]; test: T[] }

export function splitDevTest<T>(items: readonly T[], seed: number, devCount: number): Split<T> {
  if (!Number.isInteger(devCount) || devCount < 0 || devCount > items.length) {
    throw new Error(`devCount ${devCount} is not a valid split of ${items.length} item(s)`);
  }
  // Shuffled, not sliced off the front: pickTargets walks the corpus in a stable order, so an
  // unshuffled split would correlate dev and test with whatever that order encodes (court, year,
  // ingestion batch) and the two halves would not be exchangeable.
  const shuffled = seededShuffle(items, seed);
  return { dev: shuffled.slice(0, devCount), test: shuffled.slice(devCount) };
}

// Cheap, and checks the one property everything else rests on. Called by the runner on every
// run rather than trusted from the slice arithmetic above, because the inputs are rebuilt from
// the corpus each time and a construction change could reorder or duplicate them.
export function assertDisjoint<T>(s: Split<T>, key: (t: T) => string): void {
  const dev = new Set(s.dev.map(key));
  const overlap = s.test.map(key).filter((k) => dev.has(k));
  if (overlap.length) {
    throw new Error(
      `dev and test overlap on ${overlap.length} item(s): ${overlap.slice(0, 5).join(", ")}` +
      `${overlap.length > 5 ? ", ..." : ""} — every number in this experiment depends on them being disjoint`,
    );
  }
}

// Does this persisted run header describe a DEV run that recorded its held-out split?
//
// Exists as a named, tested predicate because the inline version of it was wrong in the way that
// is hardest to notice: it read `h.mode`, while persist() writes `kind`. `undefined !== "dev"` is
// true for every row ever written, so the guard skipped every file, reported "SPLIT NOT VERIFIED",
// and let the run continue. It was the fix for a blocking review finding and it verified nothing.
//
// The test that pins this builds its input the way persist() builds one, so a field rename on
// either side breaks it. A predicate that can silently match nothing is worse than no predicate,
// because the caller reports a clean "not verified" and carries on.
export interface DevRunHeader { kind: "dev"; testS: string[]; testX: string[] }

export function isDevHeader(h: unknown): h is DevRunHeader {
  if (!h || typeof h !== "object") return false;
  const r = h as Record<string, unknown>;
  return r.kind === "dev" && Array.isArray(r.testS) && Array.isArray(r.testX);
}
