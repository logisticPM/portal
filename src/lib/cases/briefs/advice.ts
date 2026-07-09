// Advice-deflection guard (spec 2026-07-09). PURE + deterministic: does a question
// ask for situation-specific legal advice (first/second person), as opposed to general
// legal information ("what have courts decided")? Used ONLY as a display surface — a
// visible "information, not advice" banner on the result page. Never a gate: a miss just
// skips the banner (the standing disclaimer always shows, and the prompt-level deflection
// still applies). Deliberately conservative — favours false negatives over false positives.
const ADVICE_PATTERNS: RegExp[] = [
  /\bwhat should (i|we)\b/,
  /\bshould (i|we)\b/,
  /\bcan (i|we) (sue|claim|win|challenge|appeal|force|stop|block)\b/,
  /\bdo (i|we) have (a |an |any )?(case|claim|right|grounds|standing)\b/,
  /\bwhat (are|were) (my|our) (option|options|right|rights|chance|chances)\b/,
  /\bhow (do|can|would|should) (i|we)\b/,
  /\bwill (i|we) (win|lose|succeed)\b/,
  /\bis (my|our) (case|claim|situation|land|band|nation|community)\b/,
  /\b(am i|are we) (entitled|allowed|able|likely|liable|required|eligible)\b/,
];

export function isAdviceSeeking(question: string): boolean {
  const q = question.toLowerCase();
  return ADVICE_PATTERNS.some((re) => re.test(q));
}
