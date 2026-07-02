import assert from "node:assert/strict";
import { splitHighlight } from "../src/app/cases/highlight";

assert.deepEqual(splitHighlight("the duty to consult", "duty"),
  [{ text: "the ", mark: false }, { text: "duty", mark: true }, { text: " to consult", mark: false }]);
assert.deepEqual(splitHighlight("Consult and CONSULT", "consult"),
  [{ text: "Consult", mark: true }, { text: " and ", mark: false }, { text: "CONSULT", mark: true }], "case-insensitive, preserves original case");
assert.deepEqual(splitHighlight("no match here", "xyz"), [{ text: "no match here", mark: false }], "no match → whole");
assert.deepEqual(splitHighlight("anything", ""), [{ text: "anything", mark: false }], "empty query → whole");
console.log("✅ highlight tests passed");
