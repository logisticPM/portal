# SCC PDF Full-Text Backfill (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill verbatim full text for the ~1,114 no-text SCC cases from `decisions.scc-csc.ca` PDFs, reusing the v1 additive→promote→grow chain and swapping only the extractor (HTML→PDF) plus the allowlist.

**Architecture:** Almost all change lives in `src/lib/cases/ingest/official-source.ts`: add the SCC host to the allowlist, a deterministic verbatim `pdfToText` (via `pdf-parse`), a `toDocumentUrl` URL-normalizer, a `robots.txt` deny-list, and a PDF/HTML routing branch in `fetchOfficialText` (whose fetch seam is refactored to return raw bytes + content-type so PDFs can be parsed). The backfill runner gets one optional `BACKFILL_HOST` filter so ops targets SCC without re-hitting the WAF-blocked bccourts host. No LLM anywhere — extraction is deterministic and verbatim; a page that extracts short/garbage is skipped.

**Tech Stack:** TypeScript, `tsx` test scripts (`node:assert/strict`, async IIFE — repo is **not** ESM), `pdf-parse` (thin pdfjs wrapper), `pdf-lib` (already a dep; used only in tests to author a fixture PDF), DynamoDB via existing repo.

**Spec:** `docs/specs/2026-07-07-scc-pdf-backfill-design.md`

**Conventions (read before starting):**
- Tests run with `npx tsx scripts/test-cases-official-source.ts` (there is no `npm test`). The offline gate is: that test green + `npm run typecheck` clean + `npm run build` compiles. **Do NOT run `npm run verify`** (needs a local DynamoDB).
- Commit after each task. Additive-safety and verbatim-no-LLM are invariants — never introduce a model call or overwrite an existing `fullTextAvailable` case.
- Current `official-source.ts` and `test-cases-official-source.ts` are the v1 files; you are extending them, not rewriting. v1's `htmlToText` and its tests must keep passing unchanged (except the 4 `fetchOfficialText` test lines that adopt the new fetch seam in Task 3).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/cases/ingest/official-source.ts` | Allowlist, URL-normalize, robots deny-list, verbatim HTML/PDF extraction, fetch | **Modify** (bulk of work) |
| `src/lib/cases/ingest/pdf-parse.d.ts` | Ambient type decl for `pdf-parse` (no official types) | **Create** |
| `scripts/test-cases-official-source.ts` | Offline unit tests | **Modify** (extend) |
| `scripts/cases-backfill-fulltext.ts` | Batch runner | **Modify** (one filter) |
| `docs/research/2026-06-28-legal-corpus-construction-methodology.md` | Methodology log | **Modify** (append note) |
| `package.json` | `pdf-parse` dependency | **Modify** (add dep) |

---

## Task 1: SCC allowlist + `toDocumentUrl` URL-normalizer

Pure, no PDF dependency — the safe first step. Adds SCC to the open-host allowlist and a function that normalizes a stored SCC URL (viewer `index.do` form) to the direct-PDF `document.do` form, passing everything else through unchanged.

**Files:**
- Modify: `src/lib/cases/ingest/official-source.ts` (the `OPEN_HOSTS` const near line 5)
- Test: `scripts/test-cases-official-source.ts`

- [ ] **Step 1: Update the two `isOpenSource` assertions and add `toDocumentUrl` tests**

In `scripts/test-cases-official-source.ts`, change the existing line 9 assertion (which currently asserts scc-csc is NOT open) and import `toDocumentUrl`. Replace the import line and the `isOpenSource` block:

```ts
import { isOpenSource, htmlToText, fetchOfficialText, toDocumentUrl } from "../src/lib/cases/ingest/official-source";
```

Replace the current `isOpenSource` assertions (lines 8–11) with:

```ts
  // --- isOpenSource (v2 = bccourts + SCC) ---
  assert.equal(isOpenSource("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"), true);
  assert.equal(isOpenSource("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do"), true, "SCC now open in v2");
  assert.equal(isOpenSource("https://www.canlii.org/en/bc/bcsc/doc/x.html"), false, "CanLII excluded");
  assert.equal(isOpenSource("not a url"), false);

  // --- toDocumentUrl: viewer form → direct-PDF form; passthrough otherwise ---
  assert.equal(
    toDocumentUrl("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/2189/index.do"),
    "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do",
    "index.do → document.do");
  assert.equal(
    toDocumentUrl("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do"),
    "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do",
    "document.do passes through unchanged");
  assert.equal(
    toDocumentUrl("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"),
    "https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm",
    "non-SCC passes through unchanged");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: FAIL — `toDocumentUrl` is not exported (import error / `is not a function`), and the SCC `isOpenSource` assertion fails.

- [ ] **Step 3: Implement `OPEN_HOSTS` update + `toDocumentUrl`**

In `src/lib/cases/ingest/official-source.ts`, change the `OPEN_HOSTS` const (currently `["www.bccourts.ca"]`) and add `toDocumentUrl` right after `isOpenSource`:

```ts
export const OPEN_HOSTS = ["www.bccourts.ca", "decisions.scc-csc.ca"];

export function isOpenSource(url: string): boolean {
  try { return OPEN_HOSTS.includes(new URL(url).host); } catch { return false; }
}

// SCC (Lexum) stores judgments as PDFs at …/<id>/1/document.do, but the corpus may
// hold the viewer URL …/item/<id>/index.do. Normalize to the direct-PDF form so we
// fetch the PDF, not the JS-viewer shell. Non-SCC and already-document.do URLs pass
// through unchanged.
export function toDocumentUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.host !== "decisions.scc-csc.ca") return url;
    const m = u.pathname.match(/^(.*)\/item\/(\d+)\/index\.do$/);
    if (!m) return url; // already document.do (or an unrecognized shape) → leave as-is
    u.pathname = `${m[1]}/${m[2]}/1/document.do`;
    return u.toString();
  } catch { return url; }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: PASS (`✅ test-cases-official-source passed`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/official-source.ts scripts/test-cases-official-source.ts
git commit -m "feat(cases): SCC allowlist + toDocumentUrl (index.do→document.do)"
```

---

## Task 2: `pdf-parse` dependency + `cleanupPdfText` + `pdfToText`

Adds the PDF text extractor. Split into a **pure** `cleanupPdfText` (all the deterministic verbatim fidelity logic — trivially testable with strings) and a thin `pdfToText(buf, parse?)` that runs `pdf-parse` then cleans. Real-PDF fidelity is covered by the ops Phase-0 gate; offline tests cover the deterministic logic.

**Files:**
- Modify: `package.json` (add `pdf-parse`)
- Create: `src/lib/cases/ingest/pdf-parse.d.ts`
- Modify: `src/lib/cases/ingest/official-source.ts`
- Test: `scripts/test-cases-official-source.ts`

- [ ] **Step 1: Install `pdf-parse`**

Run: `npm install pdf-parse@1.1.1`
Expected: adds `pdf-parse` to `dependencies`, exit 0. (Pin 1.1.1 — the widely-used stable release.)

- [ ] **Step 2: Create the ambient type declaration**

`pdf-parse` ships no types. Create `src/lib/cases/ingest/pdf-parse.d.ts`:

```ts
// pdf-parse has no bundled types. We import the implementation entrypoint directly
// (pdf-parse/lib/pdf-parse.js) to bypass the package index's debug block, which reads
// a local test PDF when the module is run as main.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
```

- [ ] **Step 3: Write failing tests for `cleanupPdfText` and `pdfToText`**

Add to `scripts/test-cases-official-source.ts` — extend the import and add a block before the final `console.log`. First the import:

```ts
import { isOpenSource, htmlToText, fetchOfficialText, toDocumentUrl, cleanupPdfText, pdfToText } from "../src/lib/cases/ingest/official-source";
```

Then the test block:

```ts
  // --- cleanupPdfText: deterministic verbatim cleanup (pure string→string) ---
  const raw = [
    "SUPREME COURT OF CANADA",                 // running header (dropped)
    "The Nation sought compensa-",             // hyphenated line break (joined)
    "tion for the taking of its land.",
    "",
    "12",                                       // page-number-only line (dropped)
    "",
    "The oﬀice granted the declaration.", // ligature ﬀ → ff
  ].join("\n");
  const cleaned = cleanupPdfText(raw);
  assert.ok(cleaned.includes("compensation for the taking of its land."), "de-hyphenated across line break");
  assert.ok(cleaned.includes("The office granted the declaration."), "ligature normalized");
  assert.ok(!/SUPREME COURT OF CANADA/.test(cleaned), "running header dropped");
  assert.ok(!/^\s*12\s*$/m.test(cleaned), "page-number-only line dropped");
  assert.ok(!/compensa-\s*\n/.test(cleaned), "no dangling hyphen");

  // --- pdfToText: delegates to the injected parser then cleans ---
  const fakeParse = async (_buf: Buffer) => ({
    text: "SUPREME COURT OF CANADA\nHello world of judg-\nment reasoning here.",
    numpages: 1, numrender: 1, info: null, metadata: null, version: "x",
  });
  const pt = await pdfToText(Buffer.from("%PDF-fake"), fakeParse);
  assert.ok(pt.includes("Hello world of judgment reasoning here."), "pdfToText cleans parser output");
  assert.ok(!/SUPREME COURT OF CANADA/.test(pt), "pdfToText drops running header");
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: FAIL — `cleanupPdfText`/`pdfToText` not exported.

- [ ] **Step 5: Implement `cleanupPdfText` and `pdfToText`**

Add to `src/lib/cases/ingest/official-source.ts`. Put the import at the top with the other imports:

```ts
import pdfParse from "pdf-parse/lib/pdf-parse.js";
```

Add the ligature map near the `ENTITIES` map, and the two functions (place them after `htmlToText`):

```ts
// Common PDF ligature glyphs → their ASCII letters (verbatim: same letters, one glyph).
const LIGATURES: Record<string, string> = {
  "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "ft", "ﬆ": "st",
};
// A running header/footer line we deterministically drop for SCC PDFs.
const RUNNING_HEADER_RE = /^\s*SUPREME COURT OF CANADA\s*$/i;

// Deterministic, VERBATIM cleanup of raw pdf-parse text. Only removes artifacts
// (running headers, page-number lines, line-break hyphenation) and normalizes ligature
// glyphs to the identical ASCII letters — never alters or invents word content.
export function cleanupPdfText(raw: string): string {
  let s = raw;
  for (const [k, v] of Object.entries(LIGATURES)) s = s.split(k).join(v);
  // Join hyphenated line breaks: "word-\nrest" → "wordrest" (letter-hyphen-newline-letter).
  s = s.replace(/([A-Za-z])-\n([A-Za-z])/g, "$1$2");
  const lines = s.split("\n").filter((ln) => {
    const t = ln.trim();
    if (RUNNING_HEADER_RE.test(t)) return false; // running header
    if (/^\d{1,4}$/.test(t)) return false;        // page-number-only line
    return true;
  });
  // Re-join, collapse intra-line whitespace, paragraph-join on blank lines.
  const paras = lines.join("\n").split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paras.join("\n\n");
}

// Verbatim PDF → text. `parse` is injectable for offline tests. SCC PDFs are
// digitally generated (text, not scanned), so pdf-parse yields clean text.
export async function pdfToText(buf: Buffer, parse: (b: Buffer) => Promise<{ text: string }> = pdfParse): Promise<string> {
  try {
    const { text } = await parse(buf);
    return cleanupPdfText(text || "");
  } catch { return ""; }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck (confirms the ambient decl resolves)**

Run: `npm run typecheck`
Expected: clean (exit 0). If `pdf-parse/lib/pdf-parse.js` is unresolved, confirm `src/lib/cases/ingest/pdf-parse.d.ts` is under the tsconfig `include` (it is — repo includes `src/**/*`).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/cases/ingest/pdf-parse.d.ts src/lib/cases/ingest/official-source.ts scripts/test-cases-official-source.ts
git commit -m "feat(cases): verbatim pdfToText (pdf-parse) + deterministic cleanup"
```

---

## Task 3: Fetch-seam refactor + PDF/HTML routing + robots deny-list

Refactors `fetchOfficialText`'s fetch seam to return raw bytes + content-type (PDFs need bytes; HTML needs charset). Routes `application/pdf` / `document.do` → `pdfToText`, else `htmlToText`. Enforces the robots deny-list and `toDocumentUrl` before any fetch. The 4 v1 injected-`get` test lines adopt the new seam.

**Files:**
- Modify: `src/lib/cases/ingest/official-source.ts` (`fetchOfficialText` and its default fetch)
- Test: `scripts/test-cases-official-source.ts`

- [ ] **Step 1: Rewrite the `fetchOfficialText` tests to the new seam + add PDF/deny-list tests**

In `scripts/test-cases-official-source.ts`, add `PDFDocument` to the top imports:

```ts
import { PDFDocument, StandardFonts } from "pdf-lib";
```

Replace the entire v1 `fetchOfficialText` block (currently lines ~27–32) with:

```ts
  // --- fetchOfficialText: injected get returns { buf, contentType } (bytes + type) ---
  const body = "The reasons for judgment. ".repeat(20); // > 200 chars after trim
  const htmlGet = async () => ({ buf: Buffer.from(`<p>${body}</p>`, "utf8"), contentType: "text/html; charset=utf-8" });
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/a.htm", htmlGet), body.trim(), "open HTML host → extracted text");
  assert.equal(await fetchOfficialText("https://www.canlii.org/x", htmlGet), "", "non-open host → '' (not fetched)");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/s.htm", async () => ({ buf: Buffer.from("<p>tiny</p>"), contentType: "text/html" })), "", "too-short extraction → ''");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/e.htm", async () => { throw new Error("net"); }), "", "fetch error → ''");

  // robots.txt deny-list: an /icm/ disallowed document is never fetched.
  let denyFetched = false;
  assert.equal(
    await fetchOfficialText("https://decisions.scc-csc.ca/icm/icm/en/120620/1/document.do", async () => { denyFetched = true; return { buf: Buffer.from("x"), contentType: "application/pdf" }; }),
    "", "robots-denied URL → '' ");
  assert.equal(denyFetched, false, "robots-denied URL not fetched");

  // PDF routing: a real (tiny) PDF authored with pdf-lib, injected as bytes → parsed + cleaned.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  const pdfBody = "The reasons for judgment of the Court are as follows and they continue at length.";
  for (let i = 0; i < 6; i++) page.drawText(pdfBody, { x: 40, y: 700 - i * 30, size: 11, font });
  const pdfBytes = Buffer.from(await doc.save());
  const scc = await fetchOfficialText(
    "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/2189/index.do",
    async (u: string) => { assert.ok(u.endsWith("/2189/1/document.do"), "fetched the document.do form"); return { buf: pdfBytes, contentType: "application/pdf" }; },
  );
  assert.ok(scc.includes("reasons for judgment of the Court"), "SCC PDF → extracted verbatim text");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: FAIL — the default seam still returns a string, so `{ buf, contentType }` destructuring / routing is absent (type/runtime error on the new assertions).

- [ ] **Step 3: Refactor `fetchOfficialText` + default fetch**

In `src/lib/cases/ingest/official-source.ts`, add the `ROBOTS_DENY` const (near `OPEN_HOSTS`) and replace the whole `fetchOfficialText` function (and its inline default `doGet`) with the version below. Keep `BROWSER_UA`, `MIN_TEXT`, and `sleep` as they are.

```ts
// robots.txt (User-agent: *) disallows exactly these two documents — honor it even
// though they are /icm/ (not /scc-csc/) and won't appear in our SCC set.
const ROBOTS_DENY = [
  "/icm/icm/en/item/120620/", "/icm/icm/en/120620/1/document.do",
  "/icm/icm/en/item/111322/", "/icm/icm/en/111322/1/document.do",
];

type Fetched = { buf: Buffer; contentType: string };

// Decode HTML bytes using the declared charset (Content-Type → <meta charset> → default
// windows-1252, which fixes bccourts' legacy-encoded apostrophes/accents).
function decodeHtml(buf: Buffer, contentType: string): string {
  const header = /charset=([^;\s]+)/i.exec(contentType)?.[1];
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString("latin1").slice(0, 2048))?.[1];
  let cs = (header ?? meta ?? "windows-1252").toLowerCase();
  if (cs === "iso-8859-1" || cs === "latin1") cs = "windows-1252";
  try { return new TextDecoder(cs).decode(buf); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

// Default fetch: browser UA, retry-once on non-OK (official sites throttle bursts),
// returns raw bytes + content-type.
async function defaultFetch(u: string): Promise<Fetched> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(u, { headers: { "User-Agent": BROWSER_UA } });
    if (res.ok) return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
    if (attempt === 0) await sleep(1500);
  }
  return { buf: Buffer.alloc(0), contentType: "" };
}

// Fetch an official page and extract verbatim text. Returns "" on a robots-denied URL, a
// non-open host, a network failure, or an implausibly short extraction. `get` is
// injectable for offline tests.
export async function fetchOfficialText(url: string, get: (u: string) => Promise<Fetched> = defaultFetch): Promise<string> {
  if (ROBOTS_DENY.some((d) => url.includes(d))) return "";
  if (!isOpenSource(url)) return "";
  const target = toDocumentUrl(url);
  try {
    const { buf, contentType } = await get(target);
    if (buf.length === 0) return "";
    const isPdf = /application\/pdf/i.test(contentType) || target.endsWith("/document.do");
    const text = isPdf ? await pdfToText(buf) : htmlToText(decodeHtml(buf, contentType));
    return text.length >= MIN_TEXT ? text : "";
  } catch { return ""; }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: PASS. (Confirms: HTML path unchanged, non-open/short/error → "", deny-list blocks without fetching, SCC PDF parses to verbatim text via the document.do URL.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/official-source.ts scripts/test-cases-official-source.ts
git commit -m "feat(cases): PDF/HTML fetch routing + robots deny-list in fetchOfficialText"
```

---

## Task 4: Runner `BACKFILL_HOST` filter

One change to the batch runner so the ops run scopes to SCC and skips the WAF-blocked bccourts host.

**Files:**
- Modify: `scripts/cases-backfill-fulltext.ts` (the `todo` filter, ~line 28)

- [ ] **Step 1: Add the host filter**

In `scripts/cases-backfill-fulltext.ts`, add a constant near the other top-level consts (after `SLEEP_MS`):

```ts
const HOST = process.env.BACKFILL_HOST; // optional: scope the run to one open host (e.g. decisions.scc-csc.ca)
```

Replace the `todo` filter line (currently `const todo = all.filter((c) => !c.fullTextAvailable && isOpenSource(c.provenance.sourceUrl));`) with:

```ts
  const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ""; } };
  const todo = all.filter((c) =>
    !c.fullTextAvailable &&
    isOpenSource(c.provenance.sourceUrl) &&
    (!HOST || hostOf(c.provenance.sourceUrl) === HOST));
  console.log(`backfill: ${todo.length} open-source no-fulltext cases${HOST ? ` (host=${HOST})` : ""}`);
```

(Delete the old `console.log(\`backfill: ${todo.length} ...\`)` line so the count isn't logged twice.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/cases-backfill-fulltext.ts
git commit -m "feat(cases): optional BACKFILL_HOST scope filter for backfill runner"
```

---

## Task 5: Methodology note + offline gate

Documents the pivot and runs the full offline gate.

**Files:**
- Modify: `docs/research/2026-06-28-legal-corpus-construction-methodology.md` (append)

- [ ] **Step 1: Append a methodology note**

Append this section to `docs/research/2026-06-28-legal-corpus-construction-methodology.md`:

```markdown

## 2026-07-07 — SCC PDF backfill (backfill v2)

bccourts HTML backfill (v1) is code-correct but its ops run is WAF-blocked (BC-gov
infrastructure: single fetch OK, sustained bulk → 806/0/0 twice). Pivoted the backfill to
the **Supreme Court of Canada** (`decisions.scc-csc.ca`, ~1,114 no-text cases) — a
different (Lexum) platform. Live probe from the run environment confirmed: HTTP 200 / no
WAF challenge; `robots.txt` permits automated access (only two `/icm/…` publication-ban
docs disallowed); `…/<id>/1/document.do` returns a direct `application/pdf`.

Extraction stays **verbatim, deterministic, no LLM**: `pdf-parse` → `cleanupPdfText`
(de-hyphenate line breaks, drop running headers / page-number lines, normalize ligature
glyphs to identical ASCII, paragraph-join). A page that extracts short/garbage is skipped
(宁缺毋滥). Stored viewer URLs (`…/item/<id>/index.do`) are normalized to the PDF form.
Additive-safe (only `!fullTextAvailable`), `provenance.source="official_court"`. Bulk ops
is gated on a Phase-0 fidelity check against real SCC PDFs; the runner takes an optional
`BACKFILL_HOST` filter so the run targets SCC without re-hitting bccourts.
```

- [ ] **Step 2: Run the full offline gate**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: clean (exit 0).

Run: `npm run build`
Expected: compiles successfully (Next build completes; no type errors). **Do NOT run `npm run verify`.**

- [ ] **Step 3: Commit**

```bash
git add docs/research/2026-06-28-legal-corpus-construction-methodology.md
git commit -m "docs(cases): methodology note for SCC PDF backfill (v2)"
```

---

## Final review & handoff

After all tasks: dispatch the final whole-branch code reviewer (subagent-driven-development), then use superpowers:finishing-a-development-branch to open the PR. The credentialed ops run (Phase-0 fidelity gate → `BACKFILL_HOST=decisions.scc-csc.ca` backfill → embed → index-build → summarize/figures/nations → Result section) happens **after merge** per the spec — it is measured, not code, and is gated on the fidelity check.
