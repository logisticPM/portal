import assert from "node:assert/strict";
import type { CaseChunk } from "../src/lib/cases/types";
import {
  OUTCOME_RUBRIC_VERSION, WINTYPE_RUBRIC, ALL_WINTYPES, ALL_OUTCOMETYPES,
  dispositionWindow, dispositionSentence, outcomePrompt, parseOutcome,
} from "../src/lib/cases/ingest/outcome-rubric";

const p = (n: number, text: string): CaseChunk => ({ paragraph: `para-${n}`, text });
const long = (n: number, fill: string) => p(n, fill.repeat(400)); // ~2400 chars each

// --- dispositionWindow ---
// Short case: everything, exactly once, no omission line.
{
  const chunks = [p(1, "The applicant seeks judicial review."), p(2, "The application is dismissed.")];
  const out = dispositionWindow("A v. B", chunks);
  assert.match(out, /\[FULL TEXT\]/);
  assert.doesNotMatch(out, /\[OPENING\]|\[DISPOSITION\]|omitted/);
  assert.equal(out.split("para-2:").length - 1, 1, "para-2 must appear exactly once");
  assert.match(out, /\[CASE\] A v\. B/);
}
// Long case: head + tail with an omission line; the LAST paragraph must survive.
{
  const chunks = [
    ...Array.from({ length: 8 }, (_, i) => long(i + 1, "opening ")),
    p(9, "For these reasons, the appeal is allowed."),
  ];
  const out = dispositionWindow("C v. D", chunks);
  assert.match(out, /\[OPENING\]/);
  assert.match(out, /\[DISPOSITION\]/);
  assert.match(out, /\[\.\.\. \d+ paragraphs? omitted \.\.\.\]/);
  assert.match(out, /para-9: For these reasons, the appeal is allowed\./,
    "the disposition paragraph is the whole point — it must always be present");
  assert.match(out, /para-1:/, "head must be present");
}
// A final paragraph larger than the tail budget keeps its END, not its start.
{
  const chunks = [long(1, "x "), p(2, "y ".repeat(4000) + "THE APPEAL IS ALLOWED.")];
  const out = dispositionWindow("E v. F", chunks);
  assert.match(out, /THE APPEAL IS ALLOWED\./, "must not truncate away the disposition");
}
// Mirror rule: a FIRST paragraph larger than the head budget keeps its START and is
// still included. Dropping it would lose the party names that winType is relative to.
{
  const chunks = [
    p(1, "PARTIES: Alpha Nation v. Beta. " + "z ".repeat(3000)),
    long(2, "mid "),
    p(3, "The appeal is dismissed."),
  ];
  const out = dispositionWindow("M v. N", chunks);
  assert.match(out, /\[OPENING\]/, "an oversized opening must be truncated, not dropped");
  assert.match(out, /para-1: PARTIES: Alpha Nation v\. Beta\./, "the opening keeps its START");
  assert.match(out, /para-3: The appeal is dismissed\./);
}

// --- dispositionSentence ---
assert.equal(
  dispositionSentence([p(1, "Background here."), p(2, "The appeal is dismissed with costs.")]),
  "The appeal is dismissed with costs.");
assert.equal(
  dispositionSentence([p(1, "The appeal is allowed."), p(2, "Costs are granted to the applicant.")]),
  "Costs are granted to the applicant.", "prefers the LAST disposition match");
assert.equal(dispositionSentence([p(1, "Nothing decisive here.")]), null);
assert.equal(dispositionSentence([]), null);

// --- outcomePrompt ---
{
  const prompt = outcomePrompt("G v. H", [p(1, "The application is dismissed.")]);
  for (const k of ALL_WINTYPES) assert.ok(prompt.includes(k), `prompt must list winType ${k}`);
  assert.ok(prompt.includes(OUTCOME_RUBRIC_VERSION), "prompt must carry the rubric version");
  assert.ok(prompt.includes("The application is dismissed."), "prompt must carry the case text");
}

// --- parseOutcome (raw model output, prose and all) ---
assert.deepEqual(
  parseOutcome('Here is my answer:\n{"winType":"party_win","outcomeType":"remand"}\nHope that helps.'),
  { winType: "party_win", outcomeType: "remand" }, "must tolerate prose around the JSON");
assert.deepEqual(parseOutcome('{"winType":"nonsense","outcomeType":"remand"}'),
  { winType: "unclassified", outcomeType: "remand" }, "unknown enum values fall back");
assert.deepEqual(parseOutcome("not json at all"),
  { winType: "unclassified", outcomeType: "unclassified" });
assert.ok(ALL_OUTCOMETYPES.includes("procedural"));
assert.ok(WINTYPE_RUBRIC.party_win.length > 0);

console.log("✅ test-cases-outcome (rubric) passed");
