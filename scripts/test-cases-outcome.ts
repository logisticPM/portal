import assert from "node:assert/strict";
import { impliedDirection, contradictsDerivation } from "../src/lib/cases/ingest/outcome-rubric";
import type { OutcomeDerivation } from "../src/lib/cases/types";
import type { CaseChunk } from "../src/lib/cases/types";
import {
  OUTCOME_RUBRIC_VERSION, WINTYPE_RUBRIC, ALL_WINTYPES, ALL_OUTCOMETYPES,
  dispositionWindow, outcomePrompt, parseOutcome,
} from "../src/lib/cases/ingest/outcome-rubric";
import type { LlmModel } from "../src/lib/cases/ingest/llm";
import { textFromConverse, DUAL_LLM_MAX_TOKENS } from "../src/lib/cases/ingest/llm";
import { mergeOutcome, classifyOutcome } from "../src/lib/cases/ingest/outcome-labeler";

const p = (n: number, text: string): CaseChunk => ({ paragraph: `para-${n}`, text });
const long = (n: number, fill: string) => p(n, fill.repeat(400)); // 400 * fill.length chars

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
// Single chunk, oversized: head and tail come from the SAME paragraph. The opening
// must still appear — losing it would lose the party names that winType is relative to.
{
  const chunks = [p(1, "PARTIES: Alpha Nation v. Canada. " + "f ".repeat(5000) + " THE APPEAL IS ALLOWED.")];
  const out = dispositionWindow("Alpha Nation v. Canada", chunks);
  assert.match(out, /\[OPENING\]/, "a single oversized chunk must still yield an opening");
  assert.match(out, /PARTIES: Alpha Nation v\. Canada\./, "party names must survive");
  assert.match(out, /THE APPEAL IS ALLOWED\./, "disposition must survive");
  assert.doesNotMatch(out, /omitted/, "nothing is omitted when there is only one paragraph");
}
// No chunks at all.
{
  const out = dispositionWindow("O v. P", []);
  assert.match(out, /\[CASE\] O v\. P/);
  assert.match(out, /\(no paragraphs available\)/);
}

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
  { winType: "party_win", outcomeType: "remand", derivation: null }, "must tolerate prose around the JSON");
assert.deepEqual(parseOutcome('{"winType":"nonsense","outcomeType":"remand"}'),
  { winType: "unclassified", outcomeType: "remand", derivation: null }, "unknown enum values fall back");
assert.deepEqual(parseOutcome("not json at all"),
  { winType: "unclassified", outcomeType: "unclassified", derivation: null });
assert.ok(ALL_OUTCOMETYPES.includes("procedural"));
assert.ok(WINTYPE_RUBRIC.party_win.length > 0);

// --- textFromConverse ---
// Normal: join text parts, skip structured reasoning blocks.
assert.equal(
  textFromConverse("m", [{ reasoningContent: { reasoningText: { text: "thinking..." } } }, { text: '{"a":1}' }], "end_turn", 2048),
  '{"a":1}', "reasoning blocks are skipped, text is kept");
assert.equal(textFromConverse("m", [{ text: "a" }, { text: "b" }], "end_turn", 2048), "ab");
// Empty but a clean stop is a legitimate empty answer, not an error.
assert.equal(textFromConverse("m", [], "end_turn", 2048), "");
// THE POINT: a model that spent its whole budget reasoning must NOT look like abstention.
assert.throws(
  () => textFromConverse("kimi", [{ reasoningContent: { reasoningText: { text: "..." } } }], "max_tokens", 256),
  /truncated/,
  "empty text + max_tokens must throw, or truncation is indistinguishable from abstention");
// Truncated but text present: usable, no throw.
assert.equal(textFromConverse("m", [{ text: '{"a":1}' }], "max_tokens", 256), '{"a":1}');
assert.ok(DUAL_LLM_MAX_TOKENS >= 2048, "the reasoning-first prompt needs room");

const d = (mine: boolean, granted: OutcomeDerivation["granted"]): OutcomeDerivation =>
  ({ movingPartyIsIndigenous: mine, granted });

// --- impliedDirection: all four corners ---
assert.equal(impliedDirection(d(true, "granted")), "prevailed");
assert.equal(impliedDirection(d(true, "refused")), "did_not_prevail");
assert.equal(impliedDirection(d(false, "granted")), "did_not_prevail");
assert.equal(impliedDirection(d(false, "refused")), "prevailed");
assert.equal(impliedDirection(d(true, "partly")), "partly");

// --- contradictsDerivation: exactly two contradictions exist ---
// The nation moved and was refused, yet the label claims it won. THE inversion.
assert.equal(contradictsDerivation("party_win", d(true, "refused")), true);
// The Crown moved and was refused, yet the label claims the nation lost.
assert.equal(contradictsDerivation("loss", d(false, "refused")), true);
// Consistent pairings.
assert.equal(contradictsDerivation("party_win", d(false, "refused")), false);
assert.equal(contradictsDerivation("loss", d(true, "refused")), false);
// doctrine_win is BY DEFINITION relief-refused-but-principle-advanced (Haida), so it
// can never contradict "did not prevail". This is a deliberate escape hatch.
assert.equal(contradictsDerivation("doctrine_win", d(true, "refused")), false);
// Abstention and mixed never contradict anything.
assert.equal(contradictsDerivation("unclassified", d(true, "refused")), false);
assert.equal(contradictsDerivation("mixed", d(true, "refused")), false);
assert.equal(contradictsDerivation("party_win", d(true, "partly")), false);

// --- prompt + version ---
assert.equal(OUTCOME_RUBRIC_VERSION, "2026-07-31.1", "rubric version must be bumped — the prompt changed");
{
  const pr = outcomePrompt("Q v. R", [p(1, "The appeal is dismissed.")]);
  assert.match(pr, /movingPartyIsIndigenous/, "prompt must ask for the moving party");
  assert.match(pr, /granted/, "prompt must ask whether relief was granted");
  assert.match(pr, /dismissed/i, "prompt must warn about the dismissed-application trap");
  assert.ok(pr.indexOf("movingPartyIsIndigenous") < pr.indexOf("winType"),
    "the derivation must be requested BEFORE the label — that ordering is the mechanism");
}

// --- parseOutcome now carries the derivation ---
assert.deepEqual(
  parseOutcome('{"movingPartyIsIndigenous":false,"granted":"refused","winType":"party_win","outcomeType":"remand"}'),
  { winType: "party_win", outcomeType: "remand", derivation: { movingPartyIsIndigenous: false, granted: "refused" } });
// A missing or malformed derivation degrades safely, it does not throw.
assert.deepEqual(parseOutcome('{"winType":"loss","outcomeType":"precedent"}').derivation, null);
assert.deepEqual(parseOutcome('{"movingPartyIsIndigenous":"yes","granted":"nope","winType":"loss","outcomeType":"precedent"}').derivation, null);

// --- mergeOutcome ---
const raw = (w: any, t: any, der: OutcomeDerivation | null) => ({ winType: w, outcomeType: t, derivation: der });

// Agreement, consistent derivations.
{
  const r = mergeOutcome(raw("party_win", "remand", d(false, "refused")), raw("party_win", "remand", d(false, "refused")), ["m1", "m2"]);
  assert.equal(r.winType, "party_win");
  assert.equal(r.outcomeMeta.agreement, "full");
  assert.equal(r.outcomeMeta.confidence, "high");
  assert.equal(r.outcomeMeta.needsReview, false);
  assert.equal(r.outcomeMeta.rubricVersion, OUTCOME_RUBRIC_VERSION);
  assert.deepEqual(r.derivation, d(false, "refused"), "an agreed derivation is stored");
}
// Disagreement on winType still abstains.
{
  const r = mergeOutcome(raw("party_win", "remand", d(false, "refused")), raw("loss", "remand", d(true, "refused")), ["m1", "m2"]);
  assert.equal(r.winType, "unclassified");
  assert.equal(r.outcomeMeta.agreement, "partial");
  assert.equal(r.outcomeMeta.needsReview, true);
  assert.equal(r.derivation, undefined, "derivations that disagree are not stored");
}
// Both unclassified: agreement WITHOUT confidence.
{
  const r = mergeOutcome(raw("unclassified", "procedural", null), raw("unclassified", "procedural", null), ["m1", "m2"]);
  assert.equal(r.outcomeMeta.agreement, "full");
  assert.equal(r.outcomeMeta.confidence, "low");
  assert.equal(r.outcomeMeta.needsReview, false);
}
// THE NEW GATE: a model contradicting its own derivation is discarded, so the pair
// cannot agree and the case abstains — even though both said "party_win".
{
  const bad = raw("party_win", "precedent", d(true, "refused"));   // moved and refused, yet claims a win
  const r = mergeOutcome(bad, bad, ["m1", "m2"]);
  assert.equal(r.winType, "unclassified", "a self-contradicting response must not be trusted");
  assert.equal(r.outcomeMeta.needsReview, true);
  assert.equal(r.outcomeMeta.contradictions, 2, "both responses contradicted themselves");
}
// One contradicts, one does not -> no agreement.
{
  const r = mergeOutcome(raw("party_win", "precedent", d(true, "refused")), raw("party_win", "precedent", d(false, "refused")), ["m1", "m2"]);
  assert.equal(r.winType, "unclassified");
  assert.equal(r.outcomeMeta.contradictions, 1);
}
// doctrine_win is always flagged: it is the one label the gate cannot check.
{
  const dw = raw("doctrine_win", "precedent", d(true, "refused"));
  const r = mergeOutcome(dw, dw, ["m1", "m2"]);
  assert.equal(r.winType, "doctrine_win", "still recorded — it is a legitimate label");
  assert.equal(r.outcomeMeta.needsReview, true, "but never unreviewed, since it is uncheckable");
}

// --- classifyOutcome with injected models (merge wiring, end to end) ---
// Async work lives in an IIFE: this file compiles as CJS, so there is no top-level await.
(async () => {
  const mk = (id: string, w: string): LlmModel =>
    ({ id, call: async () => JSON.stringify({ winType: w, outcomeType: "precedent" }) });
  const chunks = [p(1, "The appeal is allowed.")];
  const agree = await classifyOutcome("I v. J", chunks,
    [mk("fake:agree-a", "party_win"), mk("fake:agree-b", "party_win")]);
  assert.equal(agree.winType, "party_win");
  assert.equal(agree.outcomeMeta.confidence, "high");

  const clash = await classifyOutcome("K v. L", chunks,
    [mk("fake:clash-a", "party_win"), mk("fake:clash-b", "loss")]);
  assert.equal(clash.winType, "unclassified");
  assert.equal(clash.outcomeMeta.needsReview, true);

  console.log("✅ test-cases-outcome passed");
})();
