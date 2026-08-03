import assert from "node:assert/strict";
import { classifyPage, keepEnglishPages } from "../src/lib/cases/ingest/bilingual";

const EN = "The appellant appeals from the order of the judge below. The court held that the " +
  "respondent had not established that the duty was discharged, and therefore the appeal is allowed.";
const FR = "Le pourvoi est accueilli. La cour a jugé que l'intimée n'avait pas établi que " +
  "l'obligation avait été remplie, et que selon les faits, dans les circonstances, il y a lieu.";
const SHORT = "SUPREME COURT OF CANADA / COUR SUPRÊME DU CANADA";

assert.equal(classifyPage(EN), "en");
assert.equal(classifyPage(FR), "fr");
assert.equal(classifyPage(SHORT), "unknown", "a masthead is not evidence of either language");
assert.equal(classifyPage(""), "unknown");

// The SCR layout: facing pages alternate. Only English survives, IN ORDER.
{
  const kept = keepEnglishPages([FR, EN + " ONE", FR, EN + " TWO", FR, EN + " THREE"]);
  assert.match(kept.text, /ONE[\s\S]*TWO[\s\S]*THREE/, "English pages in document order");
  assert.doesNotMatch(kept.text, /pourvoi|intimée/, "no French survives");
  assert.equal(kept.kept, 3);
  assert.equal(kept.dropped, 3);
}

// A monolingual English judgment must come through untouched. This is the regression that
// stops the splitter from eating every non-SCC document it is ever pointed at.
{
  const pages = [EN + " A", EN + " B", EN + " C"];
  const kept = keepEnglishPages(pages);
  assert.equal(kept.kept, 3);
  assert.equal(kept.dropped, 0);
  assert.equal(kept.text, pages.join("\n"), "byte-identical to the input");
}

// Undetermined pages: kept only when both neighbours are English.
{
  assert.equal(keepEnglishPages([EN, SHORT, EN]).unknownKept, 1, "between English → keep");
  assert.equal(keepEnglishPages([FR, SHORT, FR]).unknownKept, 0, "between French → drop");
  assert.equal(keepEnglishPages([SHORT, EN, EN]).unknownKept, 0, "at the edge → drop");
  assert.equal(keepEnglishPages([EN, EN, SHORT]).unknownKept, 0, "at the edge → drop");
}

// An all-French document yields nothing rather than a French "English" text.
assert.equal(keepEnglishPages([FR, FR, FR]).text, "");

// Page boundaries never fall inside a sentence, because pages are the unit.
{
  const kept = keepEnglishPages([EN + " FIRST.", FR, EN + " LAST."]);
  assert.ok(kept.text.includes("FIRST."), "a kept page keeps its whole text");
  assert.ok(kept.text.includes("LAST."));
}

console.log("✅ test-cases-bilingual passed");
