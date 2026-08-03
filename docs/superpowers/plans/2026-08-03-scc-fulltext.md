# SCC Full Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch English full text for the 1,120 SCC cases that have none — starting with Tsilhqot'in, Haida and Marshall — with a fetcher that identifies itself truthfully, reports blocks as blocks, and splits the bilingual SCR PDF so a judgment arrives in one language and inside the assembly budget.

**Architecture:** Four changes, in dependency order. A single truthful `CRAWLER_UA` replaces the browser disguise in both `official-source.ts` and `robots.ts`. `Fetched` gains an `outcome` so a 403 stops looking like an empty document. A new pure module splits bilingual PDF pages by language. The runner aborts on the first block and paces per host.

**Tech Stack:** TypeScript (strict), `tsx` scripts, `pdf-parse` (has a `pagerender` hook), `node:assert/strict` offline tests, DynamoDB.

**Spec:** `docs/superpowers/specs/2026-08-03-scc-fulltext-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/cases/ingest/crawler-id.ts` | **New.** The one place the crawler's identity is defined. | Create |
| `src/lib/cases/ingest/bilingual.ts` | **New.** Pure: classify PDF pages by language, keep English. | Create |
| `src/lib/cases/ingest/official-source.ts` | Fetch + extract. | Truthful UA; `FetchOutcome`; page-aware PDF path |
| `src/lib/cases/ingest/robots.ts` | robots.txt compliance. | Truthful UA on the wire |
| `scripts/cases-backfill-fulltext.ts` | The batch runner. | Abort on block; per-host pacing |
| `scripts/cases-harvest-court.ts` | Other harvests. | Adapt to the new return shape |
| `scripts/cases-probe-hosts.ts` | **New.** Read-only: does each open host accept a truthful UA? | Create |
| `scripts/test-cases-bilingual.ts` | **New.** Offline splitter tests. | Create |
| `scripts/test-cases-official-source.ts` | Existing fetcher tests. | Extend for outcomes |

`crawler-id.ts` is its own module so there is exactly one string to audit. Both call sites
currently define their own browser UA, which is how they drifted into disguise
independently.

---

### Task 1: One truthful identity, and a probe that checks it is accepted

**Files:**
- Create: `src/lib/cases/ingest/crawler-id.ts`, `scripts/cases-probe-hosts.ts`
- Modify: `src/lib/cases/ingest/official-source.ts`, `src/lib/cases/ingest/robots.ts`

- [ ] **Step 1: Create the identity module**

Create `src/lib/cases/ingest/crawler-id.ts`:

```ts
// The crawler's identity on the wire. ONE definition, so there is one string to audit.
//
// This replaces a browser user-agent that both official-source.ts and robots.ts had
// adopted independently, with the rationale "some official hosts 403 a non-browser UA".
// Probed 2026-08-03 against decisions.scc-csc.ca: a truthful UA returns 200 for both
// robots.txt and a judgment PDF, so the premise does not hold there.
//
// Presenting an automated crawler as Chrome to a court website that has deployed bot
// detection is not something this project does. It is also counterproductive: an
// identified crawler can be allowlisted and can appeal a block; a browser lookalike can
// only be rate-limited as anonymous load. If a host refuses this UA, that is a finding to
// report — see cases-probe-hosts.ts — not something to route around.
export const CRAWLER_UA =
  "IndigenomicsLegalHub/1.0 (Indigenous economic-justice research corpus; +https://github.com/logisticPM/portal)";

// The token robots.txt groups are matched against. Kept distinct from the wire UA because
// robots-parser matches on a bare product token, not the full string.
export const CRAWLER_TOKEN = "IndigenomicsLegalHub";
```

- [ ] **Step 2: Use it in both modules**

In `src/lib/cases/ingest/official-source.ts`, delete the `BROWSER_UA` constant and import:

```ts
import { CRAWLER_UA } from "./crawler-id";
```

then in `defaultFetch` replace `"User-Agent": BROWSER_UA` with `"User-Agent": CRAWLER_UA`.

In `src/lib/cases/ingest/robots.ts`, delete `ROBOTS_BROWSER_UA` and the two-sentence comment
above it, and replace the `ROBOTS_UA` export so both come from one place:

```ts
import { CRAWLER_UA, CRAWLER_TOKEN } from "./crawler-id";

export const ROBOTS_UA = CRAWLER_TOKEN;
```

then in `defaultRobotsFetch` replace `"User-Agent": ROBOTS_BROWSER_UA` with
`"User-Agent": CRAWLER_UA`, and update its doc comment from "browser UA" to "truthful UA".

**Note the behavioural consequence and leave it as-is:** robots groups are now matched
against `IndigenomicsLegalHub` rather than falling through as an unnamed crawler. If a host
ever adds a group for our token, we will obey it. That is correct.

- [ ] **Step 3: Create the host probe**

Create `scripts/cases-probe-hosts.ts`:

```ts
// Read-only: does each allow-listed open host accept our truthful user-agent?
//
// Switching off the browser disguise could break a harvest whose host really does refuse a
// non-browser UA. This answers that BEFORE any batch runs, one HEAD-like GET per host, and
// reports rather than adapts — a host that refuses is a finding, not a reason to disguise.
import "./fetch-polyfill";
import { OPEN_HOSTS } from "../src/lib/cases/ingest/official-source";
import { CRAWLER_UA } from "../src/lib/cases/ingest/crawler-id";

async function probe(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": CRAWLER_UA } });
    return `${res.status} ${res.headers.get("content-type") ?? ""}`;
  } catch (e) {
    return `ERROR ${(e as Error).message}`;
  }
}

async function main() {
  console.log(`UA: ${CRAWLER_UA}\n`);
  let refused = 0;
  for (const host of OPEN_HOSTS) {
    const r = await probe(`https://${host}/robots.txt`);
    const bad = /^(401|403|429)/.test(r);
    if (bad) refused++;
    console.log(`  ${bad ? "✗" : "✓"} ${host.padEnd(34)} robots.txt → ${r}`);
    await new Promise((s) => setTimeout(s, 2000));
  }
  console.log(refused === 0
    ? `\n✅ all ${OPEN_HOSTS.length} hosts accept the truthful UA`
    : `\n⚠ ${refused} host(s) refused it — report this, do NOT reinstate a browser UA`);
}
main().catch((e) => { console.error("❌ cases-probe-hosts failed:", e); process.exit(1); });
```

- [ ] **Step 4: Assert nobody reinstates the disguise**

Append to `scripts/test-cases-official-source.ts`, before its final `console.log`:

```ts
// --- the crawler identifies itself truthfully ---
{
  const { CRAWLER_UA, CRAWLER_TOKEN } = await import("../src/lib/cases/ingest/crawler-id");
  assert.doesNotMatch(CRAWLER_UA, /Mozilla|Chrome|Safari|AppleWebKit/i,
    "the crawler must not present itself as a browser");
  assert.match(CRAWLER_UA, /^IndigenomicsLegalHub\//, "product token first, per RFC 9110");
  assert.match(CRAWLER_UA, /\+https?:\/\//, "a contact URL is what lets an operator allowlist us");
  assert.equal(CRAWLER_TOKEN, "IndigenomicsLegalHub");
}
```

- [ ] **Step 5: Typecheck and run the existing tests**

```bash
npx tsc --noEmit && npx tsx scripts/test-cases-official-source.ts
```

Expected: clean, and the existing fetcher tests still pass (they inject `get`, so the UA
change cannot affect them).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/crawler-id.ts src/lib/cases/ingest/official-source.ts src/lib/cases/ingest/robots.ts scripts/cases-probe-hosts.ts scripts/test-cases-official-source.ts
git commit -m "feat(ingest): the crawler identifies itself instead of impersonating Chrome"
```

---

### Task 2: A blocked request must not look like an empty document

**Files:**
- Modify: `src/lib/cases/ingest/official-source.ts`, `scripts/cases-backfill-fulltext.ts`, `scripts/cases-harvest-court.ts`, `scripts/test-cases-official-source.ts`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-cases-official-source.ts`, before its final `console.log`:

```ts
// --- fetch outcomes: a gate, a missing document and an empty one are different facts ---
{
  const allowAll = async () => true;
  const st = (status: number) => async () => ({ buf: Buffer.alloc(0), contentType: "", status });

  const blocked = await fetchOfficialSource("https://www.bccourts.ca/a.htm", st(403), allowAll);
  assert.equal(blocked.outcome, "blocked", "403 is a gate, not an empty document");
  assert.equal(blocked.text, "");

  assert.equal((await fetchOfficialSource("https://www.bccourts.ca/a.htm", st(429), allowAll)).outcome, "blocked",
    "429 is the polite form of the same gate");
  assert.equal((await fetchOfficialSource("https://www.bccourts.ca/a.htm", st(404), allowAll)).outcome, "missing",
    "404 is a missing document — the batch may continue");
  assert.equal((await fetchOfficialSource("https://www.bccourts.ca/a.htm", st(500), allowAll)).outcome, "error");

  // A real 200 with real text.
  const okGet = async () => ({ buf: Buffer.from(`<p>${"word ".repeat(80)}</p>`), contentType: "text/html", status: 200 });
  const ok = await fetchOfficialSource("https://www.bccourts.ca/a.htm", okGet, allowAll);
  assert.equal(ok.outcome, "ok");
  assert.ok(ok.text.length >= 200);

  // 200 but the body is a stub: still `ok` — the SITE behaved, the document is just thin.
  // Conflating this with `blocked` would abort batches over short pages.
  const thin = await fetchOfficialSource("https://www.bccourts.ca/s.htm",
    async () => ({ buf: Buffer.from("<p>tiny</p>"), contentType: "text/html", status: 200 }), allowAll);
  assert.equal(thin.outcome, "ok");
  assert.equal(thin.text, "", "below MIN_TEXT → no text stored, but not a block");

  // Gates that precede the network keep their own outcomes.
  assert.equal((await fetchOfficialSource("https://www.canlii.org/x", okGet, allowAll)).outcome, "not_open_source");
  assert.equal((await fetchOfficialSource("https://www.bccourts.ca/a.htm", okGet, async () => false)).outcome, "robots_denied");
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/test-cases-official-source.ts
```

Expected: FAIL — `fetchOfficialSource` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/cases/ingest/official-source.ts`, replace the `Fetched` type and `defaultFetch`:

```ts
export type Fetched = { buf: Buffer; contentType: string; status: number };

// Why the batch runner needs this: a 403 gate, a 404, a timeout and a judgment with no text
// were all previously the same empty string. That is what made the 2026-07-07 burst so
// expensive — it did not fail, it returned 1,114 empty strings and ran to completion, and
// nothing in the output showed that every request had been blocked.
export type FetchOutcome =
  | "ok"               // the site answered; `text` may still be "" if the document was thin
  | "blocked"          // 401/403/429 — a gate. Every further request is futile and rude.
  | "missing"          // 404 — this document is not there; others may be
  | "error"            // 5xx, network failure, parse failure
  | "not_open_source"  // curation gate: host not on OPEN_HOSTS
  | "robots_denied";   // crawling-ethics gate

export interface SourceResult { text: string; outcome: FetchOutcome }

// Retry once on 5xx only. A 403/429 is NOT retried — retrying a gate is what escalates it.
async function defaultFetch(u: string): Promise<Fetched> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(u, { headers: { "User-Agent": CRAWLER_UA } });
    if (res.ok || res.status < 500) {
      return {
        buf: res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0),
        contentType: res.headers.get("content-type") ?? "",
        status: res.status,
      };
    }
    if (attempt === 0) await sleep(3000);
  }
  return { buf: Buffer.alloc(0), contentType: "", status: 503 };
}
```

Then replace `fetchOfficialText` with an outcome-returning function, keeping a thin
backwards-compatible wrapper:

```ts
export async function fetchOfficialSource(
  url: string,
  get: (u: string) => Promise<Fetched> = defaultFetch,
  allows: (u: string) => Promise<boolean> = defaultRobotsGate.allows,
): Promise<SourceResult> {
  if (!isOpenSource(url)) return { text: "", outcome: "not_open_source" };
  const target = toDocumentUrl(url);
  if (!(await allows(target))) return { text: "", outcome: "robots_denied" };
  let f: Fetched;
  try { f = await get(target); } catch { return { text: "", outcome: "error" }; }
  if (f.status === 401 || f.status === 403 || f.status === 429) return { text: "", outcome: "blocked" };
  if (f.status === 404) return { text: "", outcome: "missing" };
  if (f.status >= 500 || f.buf.length === 0) return { text: "", outcome: "error" };
  try {
    const isPdf = /application\/pdf/i.test(f.contentType) || target.endsWith("/document.do");
    const text = isPdf ? await pdfToText(f.buf) : htmlToText(decodeHtml(f.buf, f.contentType));
    return { text: text.length >= MIN_TEXT ? text : "", outcome: "ok" };
  } catch { return { text: "", outcome: "error" }; }
}

// Text-only wrapper for callers that do not act on the outcome. New code should prefer
// fetchOfficialSource — a caller that cannot see `blocked` cannot stop.
export async function fetchOfficialText(
  url: string,
  get?: (u: string) => Promise<Fetched>,
  allows?: (u: string) => Promise<boolean>,
): Promise<string> {
  return (await fetchOfficialSource(url, get, allows)).text;
}
```

- [ ] **Step 4: Fix the existing tests' injected `get`**

The pre-existing `fetchOfficialText` tests inject `get` functions returning
`{ buf, contentType }` with no `status`. Add `status: 200` to each of them. Do **not**
default `status` to 200 in the type — an injected fetcher that forgets the status should be
a compile error, not a silent success.

- [ ] **Step 5: Run tests and typecheck**

```bash
npx tsx scripts/test-cases-official-source.ts && npx tsc --noEmit
```

Expected: pass, clean. `cases-harvest-court.ts` keeps compiling because it uses the
`fetchOfficialText` wrapper.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/official-source.ts scripts/test-cases-official-source.ts
git commit -m "feat(ingest): a blocked fetch is reported as blocked, not as an empty document"
```

---

### Task 3: Split the bilingual judgment by page

**Files:**
- Create: `src/lib/cases/ingest/bilingual.ts`, `scripts/test-cases-bilingual.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-cases-bilingual.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/test-cases-bilingual.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/cases/ingest/bilingual.ts`:

```ts
// SCC judgments are published as the bilingual Supreme Court Reports edition — French and
// English on facing pages. pdf-parse reads pages in physical order, so the extracted text
// alternates language roughly every page.
//
// Measured on Tsilhqot'in (2014 SCC 44) 2026-08-03: 265,148 characters, alternating
// FR/EN. That is over assembleInput's 240,000-char budget on its own, so the judgment would
// be summarized from a non-contiguous subset of two languages. Keeping only English gives
// ~110,000 characters.
//
// The unit is the PAGE, not a character window. A fixed window cuts mid-sentence, and every
// published claim in this product is verified by locating its quote VERBATIM in a chunk —
// a boundary through the middle of a sentence manufactures quotes that can never verify.
export type PageLang = "en" | "fr" | "unknown";

// Function words, not legal vocabulary: legal terms are cognate across the two languages
// ("appellant"/"appelant") and would not discriminate.
const FR_WORDS = /\b(que|qui|dans|pour|est|les|des|une|par|sur|aux|cette|selon|ainsi|avec|sont|leur|plus|cour|droit)\b/gi;
const EN_WORDS = /\b(the|that|which|with|from|this|were|been|shall|upon|whether|have|would|there|their|court|right)\b/gi;

const MIN_EVIDENCE = 8;   // fewer hits than this on a page is not evidence of a language
const RATIO = 1.3;        // one side must lead by this much to win

export function classifyPage(text: string): PageLang {
  const fr = (text.match(FR_WORDS) ?? []).length;
  const en = (text.match(EN_WORDS) ?? []).length;
  if (fr + en < MIN_EVIDENCE) return "unknown";
  if (en > fr * RATIO) return "en";
  if (fr > en * RATIO) return "fr";
  return "unknown";
}

export interface EnglishPages {
  text: string;
  kept: number;         // pages classified English and kept
  dropped: number;      // pages dropped (French, or undetermined without English neighbours)
  unknownKept: number;  // undetermined pages kept because both neighbours were English
}

// Keep English pages in document order. An undetermined page is kept ONLY when both its
// neighbours are English: dropping content is the conservative error for a corpus that
// publishes quotations, and an undetermined page that is really French will almost always
// sit between French pages.
export function keepEnglishPages(pages: string[]): EnglishPages {
  const langs = pages.map(classifyPage);
  const out: string[] = [];
  let kept = 0, dropped = 0, unknownKept = 0;
  for (let i = 0; i < pages.length; i++) {
    let take = langs[i] === "en";
    if (langs[i] === "unknown" && i > 0 && i < pages.length - 1 && langs[i - 1] === "en" && langs[i + 1] === "en") {
      take = true;
      unknownKept++;
    }
    if (take) { out.push(pages[i]); kept++; } else dropped++;
  }
  return { text: out.join("\n"), kept, dropped, unknownKept };
}
```

- [ ] **Step 4: Run the tests**

```bash
npx tsx scripts/test-cases-bilingual.ts && npx tsc --noEmit
```

Expected: `✅ test-cases-bilingual passed`, clean typecheck.

**If the monolingual-English regression fails, stop and report.** A splitter that damages
single-language documents would corrupt every non-SCC harvest that runs through it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/bilingual.ts scripts/test-cases-bilingual.ts
git commit -m "feat(ingest): split the bilingual SCR judgment by page, keep English"
```

---

### Task 4: Wire the splitter in, and make the runner stop when blocked

**Files:**
- Modify: `src/lib/cases/ingest/official-source.ts`, `scripts/cases-backfill-fulltext.ts`

- [ ] **Step 1: Give `pdfToText` page awareness**

In `official-source.ts`, add beneath the existing `pdfToText`:

```ts
// Per-page PDF text. pdf-parse exposes a `pagerender` hook; we collect each page's text
// instead of only the concatenated whole, so bilingual.ts can work at page granularity.
export async function pdfToPages(
  buf: Buffer,
  parse: (b: Buffer, opts?: unknown) => Promise<{ text: string }> = pdfParse,
): Promise<string[]> {
  const pages: string[] = [];
  try {
    await parse(buf, {
      pagerender: async (pageData: { getTextContent: (o: unknown) => Promise<{ items: { str: string }[] }> }) => {
        const tc = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
        const t = tc.items.map((i) => i.str).join(" ");
        pages.push(t);
        return t;
      },
    });
  } catch { return []; }
  return pages;
}
```

- [ ] **Step 2: Use it for bilingual sources**

In `fetchOfficialSource`, replace the extraction line:

```ts
    const isPdf = /application\/pdf/i.test(f.contentType) || target.endsWith("/document.do");
    const text = isPdf ? await pdfToText(f.buf) : htmlToText(decodeHtml(f.buf, f.contentType));
```

with:

```ts
    const isPdf = /application\/pdf/i.test(f.contentType) || target.endsWith("/document.do");
    let text: string;
    if (!isPdf) {
      text = htmlToText(decodeHtml(f.buf, f.contentType));
    } else {
      // Try page-wise first so a bilingual SCR edition can be reduced to English. If the
      // pages come back monolingual the splitter returns them unchanged, so this is safe
      // for single-language PDFs; if pagerender yields nothing, fall back to whole-document
      // extraction rather than losing the judgment.
      const pages = await pdfToPages(f.buf);
      const split = pages.length > 0 ? keepEnglishPages(pages) : null;
      text = split && split.kept > 0 ? cleanupPdfText(split.text) : await pdfToText(f.buf);
    }
```

and add the import:

```ts
import { keepEnglishPages } from "./bilingual";
```

- [ ] **Step 3: Make the runner stop on a block and pace per host**

In `scripts/cases-backfill-fulltext.ts`, change the import:

```ts
import { fetchOfficialSource, isOpenSource } from "../src/lib/cases/ingest/official-source";
```

Replace `const SLEEP_MS = Number(process.env.BACKFILL_SLEEP_MS ?? 400);` with:

```ts
// 3s default: the observed SCC response time is ~3.5s, so this is roughly half the rate of
// a back-to-back sequential crawl. The 2026-07-07 burst at 400ms is what tripped the gate.
const SLEEP_MS = Number(process.env.BACKFILL_SLEEP_MS ?? 3000);
const LIMIT = Number(process.env.BACKFILL_LIMIT ?? 0); // 0 = no cap; used for staged runs
```

Replace the fetch line and the counters in the loop:

```ts
    const { text, outcome } = await fetchOfficialSource(c.provenance.sourceUrl, undefined, gate.allows);
    if (outcome === "blocked") {
      if (batch.length) await flush(batch);
      console.error(`\n❌ BLOCKED by ${hostOf(c.provenance.sourceUrl)} at ${c.id} (${done}/${todo.length} processed).`);
      console.error("   A gate response means every further request is futile and rude. Stopping.");
      console.error(`   Progress is saved. Resume is a decision, not an automatic retry.`);
      process.exit(2);
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
```

Declare the tally next to the other counters:

```ts
  const outcomes: Record<string, number> = {};
```

Add the stage cap immediately after `done` is incremented:

```ts
    if (LIMIT && done >= LIMIT) { console.log(`  reached BACKFILL_LIMIT=${LIMIT}, stopping cleanly`); break; }
```

And report the tally in the final line:

```ts
  console.log(`✅ backfill: processed ${done} · got text ${withText} · promoted to core ${promoted}`);
  console.log(`   outcomes: ${JSON.stringify(outcomes)}`);
```

- [ ] **Step 4: Typecheck and run every touched test**

```bash
npx tsc --noEmit && npx tsx scripts/test-cases-official-source.ts && npx tsx scripts/test-cases-bilingual.ts && npx tsx scripts/test-cases-fulltext.ts
```

Expected: all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/official-source.ts scripts/cases-backfill-fulltext.ts
git commit -m "feat(ingest): English-only SCC extraction; the runner stops when a host blocks it"
```

---

### Task 5: npm scripts for the staged rollout

**Files:** Modify `package.json`

- [ ] **Step 1: Add the scripts**

Add beside the existing backfill entries:

```json
    "cases:probe-hosts": "tsx scripts/cases-probe-hosts.ts",
    "cases:backfill-scc:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BACKFILL_HOST=decisions.scc-csc.ca tsx scripts/cases-backfill-fulltext.ts",
```

The staged runs differ only by `BACKFILL_LIMIT`, set on the command line, so there is one
script rather than three that could drift apart.

- [ ] **Step 2: Verify**

```bash
node -e "const s=require('./package.json').scripts; console.log(s['cases:probe-hosts']); console.log(s['cases:backfill-scc:cloud'])"
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(ingest): host probe + SCC-scoped backfill scripts"
```

---

## After the tasks (controller, not a subagent)

1. Final whole-branch review.
2. **`npm run cases:probe-hosts`** — all six open hosts must accept the truthful UA. A refusal
   is reported to the user, never worked around.
3. **Stage 1 — the three landmarks.** Fetch Tsilhqot'in, Haida and Marshall only, then read
   the extracted English against the published judgments by eye: correct case, English
   throughout, paragraph numbering intact, length inside 240,000.
4. **Stage 2 — `BACKFILL_LIMIT=25`.** Check the outcome tally and the language split.
5. **Stage 3 — the remaining ~1,092**, only if stage 2 is clean. ~1 hour at 3s.
6. Record the result in `docs/research/`. Open the PR. Wait for approval before merging.

**Any `blocked` stops the stage.** Exit code 2 distinguishes it from an ordinary failure.

## Self-review notes

- **Spec coverage:** truthful UA (T1), host probe (T1), outcome codes (T2), no retry on 403 (T2), page-level split (T3), undetermined-page policy (T3), budget relief (T3), runner aborts (T4), per-host pacing (T4), staged rollout (T5 + controller).
- **Naming:** `CRAWLER_UA`/`CRAWLER_TOKEN`, `FetchOutcome`/`SourceResult`, `fetchOfficialSource` (new) vs `fetchOfficialText` (wrapper), `keepEnglishPages`/`classifyPage`, `pdfToPages`.
- **Deliberately unchanged:** `verifyClaims`, `assembleInput`, chunking, the summarizer, `OPEN_HOSTS`, and the 1,160 non-SCC no-text cases.
- **Known risk, accepted:** `pagerender` behaviour varies across `pdf-parse` versions. T4 falls back to whole-document extraction when it yields no pages, so the worst case is today's behaviour, not a loss.
