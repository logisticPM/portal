# Official-Source Backfill v1 (bccourts HTML) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill verbatim full text for the ~806 no-full-text cases whose `provenance.sourceUrl` is on `www.bccourts.ca`, fetching the official HTML judgment page and promoting inline — additive, no LLM in the fetch path.

**Architecture:** A new `official-source.ts` fetcher (allowlist gate + deterministic HTML→text + `fetchOfficialText`) and a `cases-backfill-fulltext.ts` runner that mirrors `cases-fetch-fulltext.ts` — lists `!fullTextAvailable` cases on open hosts, fetches text, marks `provenance.source="official_court"`, and calls `promoteOne` inline. Only no-full-text cases are touched (existing full text / vectors untouched). PDF (Lexum ~1,900) is a separate v2.

**Tech Stack:** TypeScript, `tsx`, AWS SDK v3 (`@aws-sdk/lib-dynamodb`), global `fetch`, `node:assert/strict` tests via `npx tsx`.

Each task leaves a green `tsc`. Run every command from the worktree root; do NOT run `npm run verify`.

---

### Task 1: Open-source fetcher (`ingest/official-source.ts`)

**Files:**
- Create: `src/lib/cases/ingest/official-source.ts`
- Test: `scripts/test-cases-official-source.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-official-source.ts`:

```ts
// Official-source backfill v1 (spec 2026-07-07 rev): allowlist + verbatim HTML→text.
// Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { isOpenSource, htmlToText, fetchOfficialText } from "../src/lib/cases/ingest/official-source";

(async () => {
  // --- isOpenSource (v1 = bccourts only) ---
  assert.equal(isOpenSource("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"), true);
  assert.equal(isOpenSource("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do"), false, "PDF host is v2, not open in v1");
  assert.equal(isOpenSource("https://www.canlii.org/en/bc/bcsc/doc/x.html"), false, "CanLII excluded");
  assert.equal(isOpenSource("not a url"), false);

  // --- htmlToText: strips noise, keeps paragraphs verbatim, decodes entities ---
  const html = `<html><head><title>x</title><style>.a{color:red}</style></head><body>
    <nav>Home | Search</nav>
    <div class="content"><p>The Nation brought a claim for aboriginal title.</p>
    <p>The court granted the declaration &amp; costs of $5,000.</p></div>
    <footer>Copyright BC Courts</footer></body></html>`;
  const text = htmlToText(html);
  assert.ok(text.includes("The Nation brought a claim for aboriginal title."), "para 1 kept verbatim");
  assert.ok(text.includes("The court granted the declaration & costs of $5,000."), "para 2 kept + entity decoded");
  assert.ok(!/Home \| Search/.test(text), "nav stripped");
  assert.ok(!/BC Courts/.test(text), "footer stripped");
  assert.ok(!/[<>]/.test(text), "no residual tags");
  assert.ok(text.split("\n\n").length >= 2, "paragraph-structured (\\n\\n separated)");

  // --- fetchOfficialText: injected get ---
  const body = "The reasons for judgment. ".repeat(20); // > 200 chars
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/a.htm", async () => `<p>${body}</p>`), body.trim(), "open host → extracted text");
  assert.equal(await fetchOfficialText("https://www.canlii.org/x", async () => "<p>should never fetch</p>"), "", "non-open host → '' (not fetched)");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/s.htm", async () => "<p>tiny</p>"), "", "too-short extraction → ''");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/e.htm", async () => { throw new Error("net"); }), "", "fetch error → ''");

  console.log("✅ test-cases-official-source passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: FAIL — cannot resolve `../src/lib/cases/ingest/official-source`.

- [ ] **Step 3: Create `src/lib/cases/ingest/official-source.ts`**

```ts
// Official-source full-text backfill (spec 2026-07-07 rev). v1: www.bccourts.ca HTML.
// Deterministic, VERBATIM HTML→text (no LLM) so downstream summary/figure
// verbatim-verification stays valid; only allow-listed open hosts are fetched
// (CanLII and the PDF/Lexum hosts are excluded in v1).
const OPEN_HOSTS = ["www.bccourts.ca"]; // v1; v2 adds the Lexum PDF hosts

export function isOpenSource(url: string): boolean {
  try { return OPEN_HOSTS.includes(new URL(url).host); } catch { return false; }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

// Deterministic HTML → plain text with paragraph breaks. Removes script/style/head
// and nav/header/footer blocks, turns block-level closes into paragraph breaks,
// strips remaining tags, decodes common entities, collapses intra-line whitespace.
// VERBATIM: only markup/whitespace is removed — word characters are never altered.
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|head|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  const paras = s.split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paras.join("\n\n");
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MIN_TEXT = 200; // shorter than this = a shell/error page → skip (never store garbage)

// Fetch an official page (browser UA — some official sites 403 non-browser agents)
// and extract verbatim text. Returns "" on a non-open host, network failure, or an
// implausibly short extraction. `get` is injectable for offline tests.
export async function fetchOfficialText(url: string, get?: (u: string) => Promise<string>): Promise<string> {
  if (!isOpenSource(url)) return "";
  const doGet = get ?? (async (u: string) => {
    const res = await fetch(u, { headers: { "User-Agent": BROWSER_UA } });
    return res.ok ? res.text() : "";
  });
  try {
    const text = htmlToText(await doGet(url));
    return text.length >= MIN_TEXT ? text : "";
  } catch { return ""; }
}
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `npx tsx scripts/test-cases-official-source.ts && npx tsc --noEmit`
Expected: `✅ test-cases-official-source passed`; tsc exit 0.

- [ ] **Step 5: (Best-effort) sanity-check extraction on a live bccourts page**

Try: `npx tsx -e "import('./src/lib/cases/ingest/official-source').then(async m => { const t = await m.fetchOfficialText('https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm'); console.log('len', t.length); console.log(t.slice(0, 600)); })"`
Expected: a few thousand+ chars of clean judgment paragraphs (no nav/menu boilerplate). **If** the output leaks obvious site chrome (menus, breadcrumbs), tighten `htmlToText` to first extract the main content container (e.g. slice between the judgment's start marker and the end), keep the unit test green, and re-run. If the live fetch is blocked in this environment, skip this step — the fixture test + the `MIN_TEXT` guard + the ops fidelity spot-check are the backstops. Do not block on it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/official-source.ts scripts/test-cases-official-source.ts
git commit -m "feat(cases): official-source fetcher (bccourts HTML→text, verbatim, allowlisted)"
```

---

### Task 2: Backfill runner + npm scripts + methodology + gate

**Files:**
- Create: `scripts/cases-backfill-fulltext.ts`
- Modify: `package.json`
- Modify: `docs/research/2026-06-28-legal-corpus-construction-methodology.md`

- [ ] **Step 1: Create the backfill runner**

Create `scripts/cases-backfill-fulltext.ts` (mirrors `scripts/cases-fetch-fulltext.ts`):

```ts
// Official-source full-text backfill (spec 2026-07-07 rev). v1: for no-full-text
// cases whose sourceUrl is an open host (bccourts), fetch verbatim HTML text, apply,
// mark provenance official_court, and promote inline. ADDITIVE: only touches
// !fullTextAvailable cases, so existing full text / vectors are never rewritten.
// Resumable (re-run skips cases that now have text); disk-cached fetches.
import "./fetch-polyfill";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { applyFullText } from "../src/lib/cases/ingest/fulltext";
import { fetchOfficialText, isOpenSource } from "../src/lib/cases/ingest/official-source";
import { promoteOne } from "./cases-ingest";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function flush(batch: LegalCase[]) {
  const reqs = batch.flatMap((c) => caseToItems(c).map((Item) => ({ PutRequest: { Item } })));
  for (let i = 0; i < reqs.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: reqs.slice(i, i + 25) } }));
}

async function main() {
  const all = await dynamoCaseRepo.listCases({ tier: "all" });
  const todo = all.filter((c) => !c.fullTextAvailable && isOpenSource(c.provenance.sourceUrl));
  console.log(`backfill: ${todo.length} open-source no-fulltext cases`);

  let done = 0, withText = 0, promoted = 0;
  let batch: LegalCase[] = [];
  for (const c of todo) {
    const text = await fetchOfficialText(c.provenance.sourceUrl);
    if (text) {
      withText++;
      const withTextCase: LegalCase = { ...applyFullText(c, text), provenance: { ...c.provenance, source: "official_court" } };
      const p = await promoteOne(withTextCase);
      if (p && p !== "no_consensus") promoted++;
      batch.push(p && p !== "no_consensus" ? p : withTextCase);
      if (batch.length >= 100) { await flush(batch); batch = []; }
    }
    if (++done % 100 === 0) console.log(`  ${done}/${todo.length} · text ${withText} · promoted ${promoted}`);
  }
  if (batch.length) await flush(batch);
  console.log(`✅ backfill: processed ${done} · got text ${withText} · promoted to core ${promoted}`);
}
main().catch((e) => { console.error("❌ cases-backfill-fulltext failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, inside `"scripts"`, add these two lines immediately AFTER the existing `"cases:fetch-fulltext": ...` line (keep valid JSON):

```json
    "cases:backfill-fulltext": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-backfill-fulltext.ts",
    "cases:backfill-fulltext:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-backfill-fulltext.ts",
```

- [ ] **Step 3: Append the methodology note**

APPEND to the END of `docs/research/2026-06-28-legal-corpus-construction-methodology.md` (leading blank line):

```markdown

## Official-source backfill v1 (2026-07-07) — bccourts HTML, verbatim, additive

A2AJ left 2,821 cases without full text; a Phase 0 probe found they point almost
entirely to official open court sites (zero CanLII). v1 backfills the **806** whose
`provenance.sourceUrl` is on `www.bccourts.ca` (clean HTML; a provincial-coverage
gap). `cases:backfill-fulltext` fetches the official judgment page (browser UA),
extracts text with a deterministic, verbatim HTML→text pass (no LLM — so downstream
verbatim-verification holds; a page that doesn't extract cleanly is skipped),
applies it, marks `provenance.source="official_court"`, and promotes inline. Only
`!fullTextAvailable` cases are touched (existing full text / vectors untouched).
After a run: re-embed, rebuild the artifact, and refresh the derived layers
(summaries / figures / nations). The Lexum PDF family (~1,900: SCC/ONCA/FC/FCA/
tribunals) is deferred to v2 (needs a PDF→text path).
```

- [ ] **Step 4: Run the offline gate**

Run: `npx tsx scripts/test-cases-official-source.ts && npx tsc --noEmit && node -e "require('./package.json')" && npm run build`
Expected: test prints `✅ test-cases-official-source passed`; `tsc` exit 0; `node` prints nothing (valid JSON); `next build` completes (exit 0).

> Do NOT run `npm run verify`.

- [ ] **Step 5: Commit**

```bash
git add scripts/cases-backfill-fulltext.ts package.json docs/research/2026-06-28-legal-corpus-construction-methodology.md
git commit -m "feat(cases): official-source backfill runner (bccourts) + npm scripts + methodology"
```

---

## Post-merge operational run (credentialed — NOT part of code tasks)

Against the cloud table with temporary SSO creds, `LABEL_MODELS` set (promotion labels new full-text cases — same as `cases:fetch-fulltext` ops), from the repo root:

1. `LABEL_MODELS="amazon.nova-lite-v1:0,us.meta.llama3-3-70b-instruct-v1:0" AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 npx tsx scripts/cases-backfill-fulltext.ts` — fetch + inline promote (reports got-text / promoted).
2. `npm run cases:embed:bedrock:cloud` — embed the new chunks.
3. `INDEX_BUCKET=indigenomics-portal-production-casesindexbucket-bbdveozx npm run cases:index-build:cloud` — rebuild + upload the artifact.
4. Refresh derived layers over the new core: `cases:summarize:cloud`, `cases:extract-figures:cloud`, `cases:extract-nations:cloud`.
5. Record in a Result section of the spec: cases got-text, promoted-to-core, new core total (was 452), a verbatim spot-check vs the bccourts page, and confirmation existing cases were untouched.
