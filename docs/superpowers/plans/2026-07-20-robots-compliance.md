# Robots.txt Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the official-source fetcher genuinely honor each host's `robots.txt` before requesting a decision URL, replacing the hardcoded `ROBOTS_DENY`; add a read-only corpus audit of robots-disallowed cases.

**Architecture:** New `robots.ts` module wraps the `robots-parser` library in a per-host-memoized gate (`makeRobotsGate().allows(url)`) with policy 2xx→obey / 404→allow / 403·5xx·error→skip. `fetchOfficialText` gains an injectable `allows` param (default = process singleton) and checks the post-normalization `target` URL. A read-only script audits the stored corpus. `official-source.ts` is ops-only (never in a Lambda bundle), so the new dependency has zero cold-start cost.

**Tech Stack:** TypeScript, `robots-parser` (npm), `tsx` test scripts (async-IIFE + `node:assert/strict`), DynamoDB via `dynamoCaseRepo`.

**Spec:** `docs/superpowers/specs/2026-07-20-robots-compliance-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/ingest/robots.ts` | **New.** Per-host robots.txt fetch + parse + memoized gate; the whole robots policy lives here. |
| `scripts/test-cases-robots.ts` | **New.** Offline unit tests for the gate (injected fetcher). |
| `src/lib/cases/ingest/official-source.ts` | Remove `ROBOTS_DENY`; `fetchOfficialText` gains an injectable `allows` param, checks `target`, imports `defaultRobotsGate`. |
| `scripts/test-cases-official-source.ts` | Thread an allow-all gate through existing calls; swap the old `/icm/` deny block for a deny-gate block. |
| `scripts/cases-backfill-fulltext.ts` | Create one gate per run, pass `gate.allows` into `fetchOfficialText`. |
| `scripts/cases-audit-robots.ts` | **New.** Read-only corpus audit → robots-disallowed report. |
| `package.json` | Add `robots-parser` dep + `cases:audit-robots` / `:cloud` scripts. |

DRY: all robots logic is in `robots.ts`; the fetcher, runner, and audit all consume the same gate. YAGNI: no crawl-delay, no sitemap discovery, no cross-process cache.

---

## Task 1: `robots.ts` gate + unit tests

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/lib/cases/ingest/robots.ts`
- Create: `scripts/test-cases-robots.ts`

- [ ] **Step 1: Add the dependency**

Run: `npm install robots-parser`
Expected: `package.json` gains `"robots-parser": "^3.x"` under `dependencies`; `package-lock.json` updated.

Note: `robots-parser` v3 ships its own TypeScript declarations. If `npm run typecheck` later reports "Could not find a declaration file for module 'robots-parser'", create `types/robots-parser.d.ts` with exactly:
```ts
declare module "robots-parser" {
  interface Robots { isAllowed(url: string, ua?: string): boolean | undefined; }
  export default function robotsParser(url: string, contents: string): Robots;
}
```
and confirm `tsconfig.json`'s `include` covers `types/` (add `"types/**/*.d.ts"` to `include` if absent).

- [ ] **Step 2: Write the failing test**

Create `scripts/test-cases-robots.ts`:
```ts
// robots.ts unit tests. Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";

// Build a gate whose robots.txt fetcher always returns a fixed status/body.
const fixed = (status: number, body: string) => makeRobotsGate(async () => ({ status, body }));

(async () => {
  // --- bccourts regression: Disallow: /jdb-txt/ blocks the exact path we backfilled ---
  const bc = fixed(200, "User-agent: *\nDisallow: /jdb-txt/\n");
  assert.equal(await bc.allows("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"), false, "jdb-txt disallowed");
  assert.equal(await bc.allows("https://www.bccourts.ca/court_of_appeal/about_judgments.aspx"), true, "non-jdb-txt allowed");

  // --- fetch-status policy: 404 allow / 403,5xx,network skip ---
  assert.equal(await fixed(404, "").allows("https://records.court.nl.ca/public/x?decision-id=1&mode=stream"), true, "404 → allowed");
  assert.equal(await fixed(403, "").allows("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do"), false, "403 → skip");
  assert.equal(await fixed(500, "").allows("https://example.court.ca/x"), false, "5xx → skip");
  assert.equal(await fixed(0, "").allows("https://example.court.ca/x"), false, "network error → skip");

  // --- library correctness: Allow-override + longest-match ---
  const ao = fixed(200, "User-agent: *\nDisallow: /a/\nAllow: /a/b\n");
  assert.equal(await ao.allows("https://h.ca/a/b/doc"), true, "longer Allow wins");
  assert.equal(await ao.allows("https://h.ca/a/c/doc"), false, "only Disallow matches");

  // --- library correctness: wildcard + end-anchor ---
  const wc = fixed(200, "User-agent: *\nDisallow: /*.aspx$\n");
  assert.equal(await wc.allows("https://h.ca/court/Recent_Judgments.aspx"), false, "*.aspx$ blocked");
  assert.equal(await wc.allows("https://h.ca/court/2024BCSC1.htm"), true, ".htm allowed");

  // --- per-host memoization: robots.txt fetched once per host ---
  let calls = 0;
  const memo = makeRobotsGate(async () => { calls++; return { status: 200, body: "User-agent: *\nDisallow: /x/\n" }; });
  await memo.allows("https://h.ca/x/1");
  await memo.allows("https://h.ca/y/2");
  await memo.allows("https://h.ca/x/3");
  assert.equal(calls, 1, "one fetch for repeated host");
  await memo.allows("https://other.ca/z");
  assert.equal(calls, 2, "different host → separate fetch");

  // --- malformed URL → skip ---
  assert.equal(await fixed(200, "").allows("not a url"), false, "malformed URL → false");

  console.log("✅ test-cases-robots passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-robots.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/ingest/robots'` (module not created yet).

- [ ] **Step 4: Implement `robots.ts`**

Create `src/lib/cases/ingest/robots.ts`:
```ts
// Per-host robots.txt compliance for the official-source fetcher. Fetches and parses each
// host's robots.txt (robots-parser, RFC 9309), memoized per host, and answers allows(url).
// Policy: 2xx → obey; 404 → allow (no robots = no restrictions); 403/5xx/error → skip
// (conservative). Only ops scripts import this — never the Web/BriefGen Lambda bundle.
import robotsParser from "robots-parser";

// We present a browser UA on the wire (some official hosts 403 a non-browser UA) but match
// robots groups as an unnamed crawler → falls through to the catch-all `User-agent: *` group.
const ROBOTS_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const ROBOTS_UA = "IndigenomicsLegalHub";

export type RobotsFetchResult = { status: number; body: string };
export type RobotsFetcher = (robotsUrl: string) => Promise<RobotsFetchResult>;

// Default robots.txt fetch: browser UA, single attempt, never throws (network error → status 0).
export const defaultRobotsFetch: RobotsFetcher = async (robotsUrl) => {
  try {
    const res = await fetch(robotsUrl, { headers: { "User-Agent": ROBOTS_BROWSER_UA } });
    return { status: res.status, body: res.ok ? await res.text() : "" };
  } catch {
    return { status: 0, body: "" };
  }
};

// A robots gate with an internal per-host cache. Reuse one instance across a whole
// backfill/audit run so each host's robots.txt is fetched at most once.
export function makeRobotsGate(fetchRobots: RobotsFetcher = defaultRobotsFetch): {
  allows: (url: string) => Promise<boolean>;
} {
  const cache = new Map<string, Promise<(url: string) => boolean>>();

  function matcherFor(host: string): Promise<(url: string) => boolean> {
    let m = cache.get(host);
    if (!m) { m = build(host); cache.set(host, m); }
    return m;
  }

  async function build(host: string): Promise<(url: string) => boolean> {
    const robotsUrl = `https://${host}/robots.txt`;
    const { status, body } = await fetchRobots(robotsUrl);
    if (status >= 200 && status < 300) {
      const robots = robotsParser(robotsUrl, body);
      // robots-parser returns undefined when no rule applies to the URL → treat as allowed.
      return (u: string) => robots.isAllowed(u, ROBOTS_UA) ?? true;
    }
    if (status === 404) return () => true;   // genuinely no robots.txt → no restrictions
    return () => false;                       // 403 / 5xx / network error (0) → skip (conservative)
  }

  async function allows(url: string): Promise<boolean> {
    let host: string;
    try { host = new URL(url).host; } catch { return false; }
    return (await matcherFor(host))(url);
  }

  return { allows };
}

// Process-wide singleton used by fetchOfficialText's default path.
export const defaultRobotsGate = makeRobotsGate();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-robots.ts`
Expected: `✅ test-cases-robots passed`

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors). If robots-parser types are missing, apply the Step 1 fallback, then re-run.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/cases/ingest/robots.ts scripts/test-cases-robots.ts types/robots-parser.d.ts tsconfig.json 2>/dev/null
git commit -m "feat(cases): per-host robots.txt gate (robots-parser)"
```
(The `types/…` and `tsconfig.json` paths only exist if the Step 1 fallback was needed; `git add` ignores missing paths.)

---

## Task 2: Wire the gate into `fetchOfficialText` + fix its tests

**Files:**
- Modify: `src/lib/cases/ingest/official-source.ts` (remove `ROBOTS_DENY`; add `allows` param)
- Modify: `scripts/test-cases-official-source.ts` (thread allow-all gate; swap deny block)

- [ ] **Step 1: Update the existing test first (it will fail against the old signature)**

In `scripts/test-cases-official-source.ts`, add an allow-all gate right after the IIFE opens (`(async () => {`):
```ts
  const allowAll = async (_u: string) => true; // robots gate stub for offline extraction tests
```

Then thread `allowAll` as the **third** argument into every `fetchOfficialText(...)` call in the extraction section, i.e. replace that whole block (from the `// --- fetchOfficialText` comment through the `document.do URL suffix` assertion) with:
```ts
  // --- fetchOfficialText: injected get returns { buf, contentType } (bytes + type) ---
  const body = "The reasons for judgment. ".repeat(20); // > 200 chars after trim
  const htmlGet = async () => ({ buf: Buffer.from(`<p>${body}</p>`, "utf8"), contentType: "text/html; charset=utf-8" });
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/a.htm", htmlGet, allowAll), body.trim(), "open HTML host → extracted text");
  assert.equal(await fetchOfficialText("https://www.canlii.org/x", htmlGet, allowAll), "", "non-open host → '' (not fetched)");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/s.htm", async () => ({ buf: Buffer.from("<p>tiny</p>"), contentType: "text/html" }), allowAll), "", "too-short extraction → ''");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/e.htm", async () => { throw new Error("net"); }, allowAll), "", "fetch error → ''");

  // robots gate: a disallowed URL is never fetched (replaces the old hardcoded ROBOTS_DENY).
  let denyFetched = false;
  const denyGate = async (_u: string) => false;
  assert.equal(
    await fetchOfficialText("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm",
      async () => { denyFetched = true; return { buf: Buffer.from("x".repeat(300)), contentType: "text/html" }; },
      denyGate),
    "", "robots-disallowed URL → ''");
  assert.equal(denyFetched, false, "robots-disallowed URL not fetched");

  // PDF routing by content-type: PDF-typed bytes go to pdfToText (NOT htmlToText).
  const htmlBytes = Buffer.from(`<p>${body}</p>`, "utf8");
  assert.equal(
    await fetchOfficialText("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/2189/index.do",
      async (u: string) => { assert.ok(u.endsWith("/2189/1/document.do"), "normalized to document.do"); return { buf: htmlBytes, contentType: "application/pdf" }; },
      allowAll),
    "", "application/pdf content-type routes to PDF parser (HTML bytes rejected → '')");
  assert.equal(
    await fetchOfficialText("https://www.bccourts.ca/a.htm", async () => ({ buf: htmlBytes, contentType: "text/html" }), allowAll),
    body.trim(), "same bytes as text/html route to htmlToText → body (routing control)");
  assert.equal(
    await fetchOfficialText("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do",
      async () => ({ buf: htmlBytes, contentType: "" }), allowAll),
    "", "document.do URL suffix forces the PDF branch even without a pdf content-type");
```

(The `isOpenSource`, `toDocumentUrl`, `htmlToText`, `cleanupPdfText`, and `pdfToText` sections above and below this block are unchanged.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: FAIL — TypeScript/tsx error that `fetchOfficialText` takes 2 args but 3 were provided (old signature), or the deny-gate assertion fails (old `ROBOTS_DENY` path doesn't consult the gate).

- [ ] **Step 3: Update `official-source.ts`**

Remove the `ROBOTS_DENY` constant and its comment (the block that begins `// robots.txt (User-agent: *) disallows exactly these two documents` and defines `const ROBOTS_DENY = [ ... ];`).

Add this import directly below the existing `import pdfParse ...` line at the top:
```ts
import { defaultRobotsGate } from "./robots";
```

Replace the entire `fetchOfficialText` function with:
```ts
// Fetch an official page and extract verbatim text. Returns "" for a non-open host, a
// robots-disallowed URL, a network failure, or an implausibly short extraction. `get` and
// `allows` are injectable for offline tests.
export async function fetchOfficialText(
  url: string,
  get: (u: string) => Promise<Fetched> = defaultFetch,
  allows: (u: string) => Promise<boolean> = defaultRobotsGate.allows,
): Promise<string> {
  if (!isOpenSource(url)) return "";          // curation gate: official-open hosts only
  const target = toDocumentUrl(url);
  if (!(await allows(target))) return "";     // crawling-ethics gate: honor robots.txt
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
Expected: `✅ test-cases-official-source passed`

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/official-source.ts scripts/test-cases-official-source.ts
git commit -m "feat(cases): fetchOfficialText honors per-host robots.txt (drop hardcoded ROBOTS_DENY)"
```

---

## Task 3: Backfill runner uses one shared gate

**Files:**
- Modify: `scripts/cases-backfill-fulltext.ts`

- [ ] **Step 1: Add the robots gate import**

In `scripts/cases-backfill-fulltext.ts`, below the existing line
`import { fetchOfficialText, isOpenSource } from "../src/lib/cases/ingest/official-source";`
add:
```ts
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";
```

- [ ] **Step 2: Create one gate per run and pass it into the fetch**

Inside `main()`, immediately after the `console.log(`backfill: ...`)` line, add:
```ts
  const gate = makeRobotsGate(); // one per run → each host's robots.txt fetched once
```
Then change the fetch line inside the loop from:
```ts
    const text = await fetchOfficialText(c.provenance.sourceUrl);
```
to:
```ts
    const text = await fetchOfficialText(c.provenance.sourceUrl, undefined, gate.allows);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors).

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-backfill-fulltext.ts
git commit -m "feat(cases): backfill runner shares one robots gate per run"
```

---

## Task 4: Read-only robots audit script + npm scripts

**Files:**
- Create: `scripts/cases-audit-robots.ts`
- Modify: `package.json` (add two scripts)

- [ ] **Step 1: Create the audit script**

Create `scripts/cases-audit-robots.ts`:
```ts
// Read-only audit: for every stored case whose sourceUrl is an open host, report whether that
// URL is now robots-disallowed (per the real robots.txt). Surfaces the blast radius of the
// historical bccourts /jdb-txt/ violation. NEVER writes to Dynamo.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { isOpenSource, toDocumentUrl } from "../src/lib/cases/ingest/official-source";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";

type HostRec = { total: number; disallowed: number; disallowedWithText: number; samples: string[] };
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return "?"; } };

async function main() {
  const all = await dynamoCaseRepo.listCases({ tier: "all" });
  const open = all.filter((c) => isOpenSource(c.provenance.sourceUrl));
  const gate = makeRobotsGate(); // shared → each host's robots.txt fetched once
  const perHost = new Map<string, HostRec>();
  let totalDisallowed = 0, disallowedWithText = 0;

  for (const c of open) {
    const host = hostOf(c.provenance.sourceUrl);
    const rec = perHost.get(host) ?? { total: 0, disallowed: 0, disallowedWithText: 0, samples: [] };
    rec.total++;
    const allowed = await gate.allows(toDocumentUrl(c.provenance.sourceUrl));
    if (!allowed) {
      rec.disallowed++; totalDisallowed++;
      if (c.fullTextAvailable) { rec.disallowedWithText++; disallowedWithText++; }
      if (rec.samples.length < 5) rec.samples.push(c.id);
    }
    perHost.set(host, rec);
  }

  console.log(`robots audit: ${open.length} open-source cases · ${totalDisallowed} robots-DISALLOWED (${disallowedWithText} already have full text)`);
  for (const [host, r] of [...perHost.entries()].sort((a, b) => b[1].disallowed - a[1].disallowed)) {
    console.log(`  ${host}: ${r.disallowed}/${r.total} disallowed · ${r.disallowedWithText} with full text · e.g. ${r.samples.join(", ") || "—"}`);
  }
}

main().catch((e) => { console.error("❌ cases-audit-robots failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts**

In `package.json` `scripts`, add after the `cases:backfill-fulltext:cloud` line:
```json
    "cases:audit-robots": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-audit-robots.ts",
    "cases:audit-robots:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-audit-robots.ts",
```

- [ ] **Step 3: Typecheck + build (proves official-source didn't get pulled into a route bundle)**

Run: `npm run typecheck`
Expected: clean (0 errors).

Run: `npm run build`
Expected: Next.js build succeeds (route table unchanged; no import of `robots.ts`/`official-source.ts` into app code).

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-audit-robots.ts package.json
git commit -m "feat(cases): read-only robots audit script + npm scripts"
```

---

## Final verification (before finishing the branch)

- [ ] Run `npx tsx scripts/test-cases-robots.ts` → `✅ test-cases-robots passed`
- [ ] Run `npx tsx scripts/test-cases-official-source.ts` → `✅ test-cases-official-source passed`
- [ ] Run `npm run typecheck` → clean
- [ ] Run `npm run build` → succeeds
- [ ] Confirm `ROBOTS_DENY` no longer appears anywhere: `grep -rn "ROBOTS_DENY" src scripts` → no matches

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- Real per-host robots fetch+parse (library) → Task 1 ✅
- 2xx/404/403·5xx policy → Task 1 test + impl ✅
- Per-host memoization → Task 1 test + impl ✅
- Remove `ROBOTS_DENY`, check `target`, keep `OPEN_HOSTS` → Task 2 ✅ (grep guard in final verification)
- Backfill shares one gate → Task 3 ✅
- Read-only audit + npm scripts → Task 4 ✅
- Existing official-source tests stay offline → Task 2 Step 1 (allow-all gate) ✅
- No Lambda impact → Task 4 `npm run build` ✅

**2. Placeholder scan:** No TBD/TODO; all code is complete; the only conditional is the robots-parser types fallback, which is given as exact code.

**3. Type consistency:** `RobotsFetcher`/`RobotsFetchResult`, `makeRobotsGate().allows`, `defaultRobotsGate.allows`, and `fetchOfficialText(url, get, allows)` signatures match across Tasks 1–4 and both test files.
