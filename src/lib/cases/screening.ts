// PRISMA-style screening outcome for the most recent promotion run.
//
// GENERATED — `npm run cases:promote` rewrites this file. Do not hand-edit; commit the
// regenerated file alongside the run that produced it.
//
// Why a committed constant and not a live computation: the screen reads chunk text, so
// recomputing it means re-reading every substrate case's chunks — minutes of DynamoDB
// reads on a page load. Why not the .cache copy the script already writes: that directory
// is gitignored and never deployed, so the deployed page would show nothing. The `asOf`
// date is rendered next to the figures precisely so a stale file is visible as stale
// rather than passing as current.
export interface Screening {
  asOf: string;              // ISO date of the run
  substrate: number;         // records screened
  promoted: number;          // passed the screen AND the two labellers agreed
  excluded: Record<string, number>;
}

export const SCREENING: Screening = {
  asOf: "2026-08-01",
  substrate: 4892,
  promoted: 3,
  excluded: {
    no_indigenous_signal: 4432,
    no_economic_theme: 114,
    no_model_consensus: 343,
  },
};

// What the screen let through: cases that show BOTH an Indigenous-party signal and an
// economic-justice theme. `no_model_consensus` sits inside this population — those cases
// ARE on topic; the two labellers simply could not agree on which theme, so they are held
// out of core rather than labelled on one model's word.
export function onTopic(s: Screening = SCREENING): number {
  return s.promoted + (s.excluded.no_model_consensus ?? 0);
}

export function screenedOut(s: Screening = SCREENING): number {
  return Object.entries(s.excluded)
    .filter(([k]) => k !== "no_model_consensus")
    .reduce((n, [, v]) => n + v, 0);
}
