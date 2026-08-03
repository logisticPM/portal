import assert from "node:assert/strict";
import { classifyText, splitColumns, renderItems, keepEnglishColumns, type PageItem } from "../src/lib/cases/ingest/bilingual";

const EN = "The appellant appeals from the order of the judge below. The court held that the " +
  "respondent had not established that the duty was discharged, and therefore the appeal is allowed.";
const FR = "Le pourvoi est accueilli. La cour a jugé que l'intimée n'avait pas établi que " +
  "l'obligation avait été remplie, et que selon les faits, dans les circonstances, il y a lieu.";
const SHORT = "SUPREME COURT OF CANADA / COUR SUPRÊME DU CANADA";

// Build a page whose left column is `l` and right column is `r`, one item per word, with
// y decreasing down the page — the shape pdf.js actually produces.
function page(l: string, r: string): PageItem[] {
  const items: PageItem[] = [];
  l.split(" ").forEach((w, i) => items.push({ str: w + " ", x: 70 + (i % 5) * 8, y: 700 - Math.floor(i / 5) * 12 }));
  r.split(" ").forEach((w, i) => items.push({ str: w + " ", x: 300 + (i % 5) * 8, y: 700 - Math.floor(i / 5) * 12 }));
  return items;
}

// --- classifyText ---
assert.equal(classifyText(EN), "en");
assert.equal(classifyText(FR), "fr");
assert.equal(classifyText(SHORT), "unknown", "a masthead is not evidence of either language");
assert.equal(classifyText(""), "unknown");

// --- renderItems mirrors pdf-parse's render_page ---
{
  // Same y → no separator. pdf.js splits words across runs ("Recon" + "ciliation"), so any
  // separator here would break words apart.
  assert.equal(renderItems([{ str: "Recon", x: 70, y: 700 }, { str: "ciliation", x: 100, y: 700 }]), "Reconciliation");
  // y changes → newline. cleanupPdfText's hyphen rejoin matches "-\n"; without this it never fires.
  assert.equal(renderItems([{ str: "one", x: 70, y: 700 }, { str: "two", x: 70, y: 688 }]), "one\ntwo");
  assert.equal(renderItems([]), "");
}

// --- splitColumns: midpoint of the page's own x range ---
{
  const { left, right } = splitColumns(page(EN, FR));
  assert.ok(left.length > 0 && right.length > 0);
  assert.equal(classifyText(renderItems(left)), "en");
  assert.equal(classifyText(renderItems(right)), "fr");
}

// --- keepEnglishColumns: the side is CLASSIFIED, never assumed ---
{
  const enLeft = keepEnglishColumns([page(EN, FR)]);
  const enRight = keepEnglishColumns([page(FR, EN)]);
  assert.match(enLeft.text, /appellant/, "English kept when it is the left column");
  assert.doesNotMatch(enLeft.text, /pourvoi/);
  assert.match(enRight.text, /appellant/, "English kept when it is the RIGHT column");
  assert.doesNotMatch(enRight.text, /pourvoi/, "a hard-coded side would fail exactly here");
}

// --- document order is preserved across pages ---
{
  const r = keepEnglishColumns([page(FR, EN + " ONE"), page(FR, EN + " TWO"), page(FR, EN + " THREE")]);
  assert.match(r.text, /ONE[\s\S]*TWO[\s\S]*THREE/);
  assert.equal(r.kept, 3);
}

// --- a single-column page falls back to classifying the whole page ---
{
  // All items in one x cluster: there is no second column to compare against.
  const solo: PageItem[] = EN.split(" ").map((w, i) => ({ str: w + " ", x: 70 + (i % 5) * 8, y: 700 - Math.floor(i / 5) * 12 }));
  const r = keepEnglishColumns([solo]);
  assert.match(r.text, /appellant/, "an English single-column page is kept whole");
  assert.equal(r.wholePageFallbacks, 1, "and the fallback is counted, not silent");

  const soloFr: PageItem[] = FR.split(" ").map((w, i) => ({ str: w + " ", x: 70 + (i % 5) * 8, y: 700 - Math.floor(i / 5) * 12 }));
  assert.equal(keepEnglishColumns([soloFr]).text, "", "a French single-column page is dropped");
}

// --- THE REGRESSION THAT MATTERS: a monolingual English document is not damaged ---
// This splitter sits on the PDF path for every court, not only the SCC. If it eats
// single-language judgments it corrupts bccourts, Yukon, NB, MB and ONCA.
{
  const pages = [0, 1, 2].map((n) =>
    (EN + ` PAGE${n}`).split(" ").map((w, i) => ({ str: w + " ", x: 70 + (i % 5) * 8, y: 700 - Math.floor(i / 5) * 12 })));
  const r = keepEnglishColumns(pages);
  assert.match(r.text, /PAGE0[\s\S]*PAGE1[\s\S]*PAGE2/);
  assert.equal(r.dropped, 0, "nothing is dropped from an all-English document");
}

// --- an all-French document yields nothing rather than French labelled English ---
assert.equal(keepEnglishColumns([page(FR, FR)]).text, "");

// --- an empty page neither throws nor counts as content ---
assert.equal(keepEnglishColumns([[]]).text, "");

console.log("✅ test-cases-bilingual passed");
