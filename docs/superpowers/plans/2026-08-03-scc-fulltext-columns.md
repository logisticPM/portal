# SCC Full Text — Column Split (revised plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the page-level bilingual splitter — which was built on a wrong layout model and shipped eight green but meaningless tests — with a column-level one, and prove it against the real judgment rather than against fixtures.

**Architecture:** `bilingual.ts` is rewritten around `PageItem { str, x, y }` instead of page strings. `official-source.ts` gains `pdfToPageItems` (geometry-preserving) alongside the already-verified `pdfToPages`, and the PDF branch of `fetchOfficialSource` switches to column splitting. A new ops script is the real-document acceptance gate the spec now requires.

**Tech Stack:** TypeScript (strict), `pdf-parse@1.1.1` (`pagerender` confirmed supported), `tsx`, `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-03-scc-fulltext-design.md` — **read the AMENDMENT at the top**, it supersedes the page-level design below it.

---

## State this plan starts from

Committed on `feat/scc-fulltext`:

| commit | what | keep? |
|---|---|---|
| `226cfd4` | `crawler-id.ts`, truthful UA in both modules, host probe | ✅ keep |
| `4b82410` | `FetchOutcome` / `fetchOfficialSource` | ✅ keep |
| `f288302` | third browser UA removed from `cases-harvest-court.ts` | ✅ keep |
| `c57e39e` | `bilingual.ts` page-level + its tests | ❌ **this plan replaces it** |
| `bccb54f` | npm scripts | ✅ keep |

**Uncommitted in the working tree**, from the abandoned Task 4:

- `src/lib/cases/ingest/official-source.ts` — contains `pdfToPages`, which is **correct and verified** (rejoining its pages and cleaning reproduces `pdfToText` byte for byte on the real PDF), plus a page-level wiring block that this plan replaces.
- `scripts/cases-backfill-fulltext.ts` — **correct, keep as-is**: blocked-stop, `SLEEP_MS` 3000, `BACKFILL_LIMIT`, outcome tally.

Do not revert the working tree. Task R2 edits the wiring block in place.

---

## File Structure

| File | Change |
|---|---|
| `src/lib/cases/ingest/bilingual.ts` | **Rewrite.** `PageItem`, `renderItems`, `splitColumns`, `classifyText`, `keepEnglishColumns` |
| `scripts/test-cases-bilingual.ts` | **Rewrite.** The current assertions encode the wrong model — delete, do not adapt |
| `src/lib/cases/ingest/official-source.ts` | Add `pdfToPageItems`; rewire the PDF branch |
| `scripts/cases-verify-bilingual.ts` | **New.** The real-document acceptance gate |
| `package.json` | One script for the gate |

`PageItem` and `renderItems` live in `bilingual.ts`, and `official-source.ts` imports them —
one direction only. Putting them in `official-source.ts` would make the two modules import
each other.

---

### Task R1: Rewrite the splitter around columns

**Files:**
- Rewrite: `src/lib/cases/ingest/bilingual.ts`
- Rewrite: `scripts/test-cases-bilingual.ts`

- [ ] **Step 1: Delete the old tests and write the new ones**

Replace the **entire contents** of `scripts/test-cases-bilingual.ts` with:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/test-cases-bilingual.ts
```

Expected: FAIL — `classifyText`, `splitColumns`, `renderItems`, `keepEnglishColumns` do not exist (the module currently exports `classifyPage` and `keepEnglishPages`).

- [ ] **Step 3: Replace the module**

Replace the **entire contents** of `src/lib/cases/ingest/bilingual.ts` with:

```ts
// SCC judgments are published as the bilingual Supreme Court Reports edition. Measured
// against the real Tsilhqot'in PDF (2014 SCC 44) on 2026-08-03: French and English sit
// SIDE BY SIDE IN TWO COLUMNS ON EVERY PAGE — parallel translations of the same passage.
// pdf.js reads the full left column, then the full right, so a page's text is French then
// English rather than one language.
//
// An earlier version of this module assumed facing pages and split page-by-page. It passed
// eight unit tests and was wrong: the fixtures were written from the same mistaken model as
// the code. On the real PDF it kept 7 of 66 pages and its output began in French. The
// acceptance gate is now cases-verify-bilingual.ts, against the actual judgment.
//
// Why this matters at all: the bilingual text is 265,148 characters, over assembleInput's
// 240,000 budget, so the judgment would be summarized from a non-contiguous subset of two
// languages. English-only is 127,123.
export interface PageItem { str: string; x: number; y: number }
export type Lang = "en" | "fr" | "unknown";

// Function words, not legal vocabulary: legal terms are cognate across the two languages
// ("appellant"/"appelant") and would not discriminate.
const FR_WORDS = /\b(que|qui|dans|pour|est|les|des|une|par|sur|aux|cette|selon|ainsi|avec|sont|leur|plus)\b/gi;
const EN_WORDS = /\b(the|that|which|with|from|this|were|been|shall|upon|whether|have|would|there|their)\b/gi;

const MIN_EVIDENCE = 8;    // fewer hits than this is not evidence of a language
const RATIO = 1.3;         // one side must lead by this much to win
const MIN_COLUMN_GAP = 40; // narrower than this and there is only one column

export function classifyText(text: string): Lang {
  const fr = (text.match(FR_WORDS) ?? []).length;
  const en = (text.match(EN_WORDS) ?? []).length;
  if (fr + en < MIN_EVIDENCE) return "unknown";
  if (en > fr * RATIO) return "en";
  if (fr > en * RATIO) return "fr";
  return "unknown";
}

// Reassemble text from items exactly the way pdf-parse's own render_page does
// (lib/pdf-parse.js:3): same y → concatenate with NO separator, y change → "\n".
//
// Both details are load-bearing. pdf.js splits a word across runs — this repo's
// pdf-parse.d.ts records "Recon" + "ciliation" abutting — so any separator breaks words
// apart. And cleanupPdfText's hyphen rejoin matches "-\n", so dropping the newline leaves a
// stray hyphen inside every line-broken word. Every published claim is verified by locating
// its quote verbatim in this text.
export function renderItems(items: PageItem[]): string {
  let lastY: number | undefined, text = "";
  for (const it of items) {
    text += lastY === it.y || !lastY ? it.str : "\n" + it.str;
    lastY = it.y;
  }
  return text;
}

// Split a page at the midpoint of its own x range.
//
// Chosen by measurement across all 66 pages of the real judgment: midpoint gives 64/66 clean
// bilingual splits and 127,123 English characters — identical to a fixed x=290 threshold and
// better than two-means clustering (122,966). Midpoint is preferred over the constant
// because it adapts to a different page geometry.
//
// A "widest gap between distinct x values" heuristic was tried and DISCARDED: it put the cut
// at the far right edge on 5 of the pages sampled (one page: 5,165 characters left, 3
// right). Recorded so nobody re-derives it.
export function splitColumns(items: PageItem[]): { left: PageItem[]; right: PageItem[]; twoColumn: boolean } {
  if (!items.length) return { left: [], right: [], twoColumn: false };
  const xs = items.map((i) => i.x);
  const min = Math.min(...xs), max = Math.max(...xs);
  const cut = (min + max) / 2;
  const left = items.filter((i) => i.x < cut);
  const right = items.filter((i) => i.x >= cut);
  return { left, right, twoColumn: max - min >= MIN_COLUMN_GAP && left.length > 0 && right.length > 0 };
}

export interface EnglishColumns {
  text: string;
  kept: number;               // pages that contributed English
  dropped: number;            // pages that contributed nothing
  wholePageFallbacks: number; // pages kept without a clean two-column split
}

// Keep the English column of each page, in document order.
//
// The side is CLASSIFIED, never assumed. English was the left column on every cleanly-split
// page of the one judgment measured, but a corpus-wide rule cannot rest on one document.
//
// When a page does not split cleanly into one English and one French column — a cover page,
// an index, a genuinely monolingual judgment from another court — the whole page is
// classified instead and kept if English. That fallback is counted, not silent, because a
// document that is ALL fallbacks is a document this splitter is not helping with.
export function keepEnglishColumns(pages: PageItem[][]): EnglishColumns {
  const out: string[] = [];
  let kept = 0, dropped = 0, wholePageFallbacks = 0;
  for (const items of pages) {
    const { left, right, twoColumn } = splitColumns(items);
    let picked: string | null = null;
    if (twoColumn) {
      const lt = renderItems(left), rt = renderItems(right);
      const ll = classifyText(lt), rl = classifyText(rt);
      if (ll === "en" && rl === "fr") picked = lt;
      else if (rl === "en" && ll === "fr") picked = rt;
    }
    if (picked === null) {
      const whole = renderItems(items);
      if (classifyText(whole) === "en") { picked = whole; wholePageFallbacks++; }
    }
    if (picked !== null && picked.length > 0) { out.push(picked); kept++; } else dropped++;
  }
  return { text: out.join("\n"), kept, dropped, wholePageFallbacks };
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx tsx scripts/test-cases-bilingual.ts && npx tsc --noEmit
```

Expected: `✅ test-cases-bilingual passed`. `tsc` will report errors in `official-source.ts`,
which still imports `keepEnglishPages` — that is expected and Task R2 fixes it. Report the
errors you see so the next task can confirm it fixed exactly those.

**If the monolingual-English regression fails, STOP and report.** It is the assertion that
protects every non-SCC harvest.

**If the "English as the RIGHT column" assertion fails**, that means a side is hard-coded
somewhere. Do not flip the hard-coding — remove it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/bilingual.ts scripts/test-cases-bilingual.ts
git commit -m "feat(ingest): split the bilingual judgment by column, not by page"
```

---

### Task R2: Feed it real geometry

**Files:**
- Modify: `src/lib/cases/ingest/official-source.ts`

- [ ] **Step 1: Add the geometry-preserving extractor**

In `official-source.ts`, immediately after the existing `pdfToPages`, add:

```ts
// Per-page items WITH geometry. pdfToPages gives one string per page, which is enough for a
// monolingual document but throws away the x positions the column splitter needs.
//
// The two must stay consistent: rendering a page's items with renderItems() reproduces that
// page's pdfToPages() string exactly. cases-verify-bilingual.ts asserts it against the real
// judgment.
export async function pdfToPageItems(
  buf: Buffer,
  parse: typeof pdfParse = pdfParse,
): Promise<PageItem[][]> {
  const pages: PageItem[][] = [];
  try {
    const res = await parse(buf, {
      pagerender: async (pageData) => {
        try {
          const tc = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
          pages.push(tc.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
        } catch {
          // pdf-parse swallows a throwing pagerender (lib/pdf-parse.js:87). Without this
          // placeholder the page would be MISSING and every later index would shift.
          pages.push([]);
        }
        return "";
      },
    });
    if (typeof res.numpages === "number" && res.numpages !== pages.length) return [];
  } catch { return []; }
  return pages;
}
```

and extend the `bilingual` import:

```ts
import { keepEnglishColumns, type PageItem } from "./bilingual";
```

- [ ] **Step 2: Rewire the PDF branch**

In `fetchOfficialSource`, replace the whole `if (!isPdf) { … } else { … }` block that the
abandoned task left behind with:

```ts
    let text: string;
    if (!isPdf) {
      text = htmlToText(decodeHtml(f.buf, f.contentType));
    } else {
      // Split BEFORE cleanupPdfText: that cleanup rejoins hyphenated line breaks and strips
      // running headers across the whole document, so running it first would splice a word
      // across a column boundary.
      //
      // keepEnglishColumns returns a monolingual document unchanged, so this is safe for
      // every non-SCC court on this path. If pagerender yields nothing, fall back to whole
      // document extraction rather than losing the judgment.
      const pages = await pdfToPageItems(f.buf);
      const split = pages.length > 0 ? keepEnglishColumns(pages) : null;
      text = split && split.kept > 0 ? cleanupPdfText(split.text) : await pdfToText(f.buf);
    }
```

- [ ] **Step 3: Typecheck and run every affected test**

```bash
npx tsc --noEmit && npx tsx scripts/test-cases-bilingual.ts && npx tsx scripts/test-cases-official-source.ts && npx tsx scripts/test-cases-fulltext.ts
```

Expected: clean and all passing. The `keepEnglishPages` errors from R1 must be gone.

**Do not run `cases-backfill-fulltext.ts`** — it needs AWS credentials and hits live court
websites.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cases/ingest/official-source.ts
git commit -m "feat(ingest): extract PDF pages with geometry and split English by column"
```

---

### Task R3: The real-document acceptance gate

**Files:**
- Create: `scripts/cases-verify-bilingual.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the gate**

Create `scripts/cases-verify-bilingual.ts`:

```ts
// ACCEPTANCE GATE for the bilingual column splitter, against a real judgment.
//
// Unit tests are not sufficient here and this script exists because of that. The page-level
// predecessor passed eight synthetic assertions and was still wrong — the fixtures encoded
// the same mistaken layout model as the code. Only the real PDF caught it.
//
// Fetches Tsilhqot'in 2014 SCC 44 once (truthful UA, cached to scripts/.cache) and asserts
// on the extraction. Run before any backfill; NOT part of the offline test suite, because it
// makes one network request.
import "./fetch-polyfill";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pdfToText, pdfToPages, pdfToPageItems, cleanupPdfText } from "../src/lib/cases/ingest/official-source";
import { keepEnglishColumns, renderItems } from "../src/lib/cases/ingest/bilingual";
import { CRAWLER_UA } from "../src/lib/cases/ingest/crawler-id";

const URL_ = "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/14246/1/document.do";
const CACHE = path.join(process.cwd(), "scripts", ".cache", "tsilhqotin-2014-scc-44.pdf");

async function getPdf(): Promise<Buffer> {
  try { return await fs.readFile(CACHE); } catch { /* fetch below */ }
  const res = await fetch(URL_, { headers: { "User-Agent": CRAWLER_UA } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} — cannot run the gate without the document`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(CACHE), { recursive: true });
  await fs.writeFile(CACHE, buf);
  return buf;
}

async function main() {
  const buf = await getPdf();
  console.log(`pdf bytes: ${buf.length}`);

  // 1. Geometry extraction must agree with the plain extraction, page for page.
  const pages = await pdfToPages(buf);
  const items = await pdfToPageItems(buf);
  assert.ok(pages.length > 0, "pdfToPages returned nothing");
  assert.equal(items.length, pages.length, "page counts differ between the two extractors");
  for (let i = 0; i < pages.length; i++)
    assert.equal(renderItems(items[i]), pages[i], `page ${i}: renderItems does not reproduce pdfToPages`);
  console.log(`✓ ${pages.length} pages · renderItems reproduces pdfToPages exactly`);

  // 2. Rejoining the pages and cleaning reproduces whole-document extraction byte for byte.
  const whole = await pdfToText(buf);
  assert.equal(cleanupPdfText(pages.join("\n\n")), whole, "page rejoin diverges from pdfToText");
  console.log(`✓ page rejoin is byte-identical to pdfToText (${whole.length} chars)`);

  // 3. The English extraction.
  const split = keepEnglishColumns(items);
  const english = cleanupPdfText(split.text);
  console.log(`  kept ${split.kept} · dropped ${split.dropped} · whole-page fallbacks ${split.wholePageFallbacks}`);
  console.log(`  english chars: ${english.length} (bilingual whole: ${whole.length})`);

  assert.ok(english.length > 100_000, `too little English (${english.length}) — the split is dropping content`);
  assert.ok(english.length < 200_000, `too much English (${english.length}) — French is probably surviving`);
  assert.ok(english.length < 240_000, "must fit assembleInput's budget");

  const fr = (english.match(/\b(pourvoi|intimée|arrêt|toutefois|néanmoins|selon les)\b/gi) ?? []).length;
  assert.equal(fr, 0, `${fr} French markers survived the split`);

  assert.match(english.slice(0, 400), /\b(the|The|Court|appeal)\b/, "the extraction should open in English");
  console.log(`✓ English-only, in budget, opens in English`);
  console.log(`\nhead: ${english.slice(0, 200)}`);
  console.log("\n✅ bilingual acceptance gate passed");
}
main().catch((e) => { console.error("❌ bilingual gate FAILED:", e.message); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

```json
    "cases:verify-bilingual": "tsx scripts/cases-verify-bilingual.ts",
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

**Do not run the gate** — it makes a network request to a court website. The controller runs it.

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-verify-bilingual.ts package.json
git commit -m "test(ingest): real-document acceptance gate for the column splitter"
```

---

## After the tasks (controller, not a subagent)

1. Final whole-branch review.
2. **`npm run cases:verify-bilingual`** — the gate. If it fails, the unit tests are what need
   correcting, not the assertions in the gate.
3. **`npm run cases:probe-hosts`** — all six open hosts must accept the truthful UA.
4. **Stage 1:** Tsilhqot'in, Haida, Marshall only. Read the stored text against the published
   judgments by eye.
5. **Stage 2:** `BACKFILL_LIMIT=25`. Check the outcome tally and the fallback count.
6. **Stage 3:** the remaining ~1,092, ~1 hour at 3s.
7. Record the result in `docs/research/`. Open the PR.

## Self-review notes

- **Amendment coverage:** column split (R1 `splitColumns`), midpoint (R1, with the measured
  justification and the discarded heuristic), classify-never-assume (R1 + the RIGHT-column
  assertion), single-column fallback counted (R1 `wholePageFallbacks`), geometry extractor
  (R2), split-before-cleanup (R2), real-document gate (R3).
- **Naming:** `PageItem`, `Lang`, `classifyText`, `renderItems`, `splitColumns`,
  `keepEnglishColumns`, `EnglishColumns`, `pdfToPageItems` — consistent across all three tasks.
- **Unchanged:** `pdfToPages`, `crawler-id.ts`, `robots.ts`, `cases-backfill-fulltext.ts`
  (already correct in the working tree), `verifyClaims`, `assembleInput`, the summarizer.
- **The old `keepEnglishPages`/`classifyPage` are deleted, not deprecated.** Leaving them
  would leave a page-level splitter available to a future caller who does not know why it is
  wrong.
