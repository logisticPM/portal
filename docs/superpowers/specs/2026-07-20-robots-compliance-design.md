# Robots.txt Compliance for the Official-Source Fetcher — Design

**Date:** 2026-07-20 · **Status:** approved (design), pre-implementation · **Domain:** `src/lib/cases/ingest/official-source.ts`, new `src/lib/cases/ingest/robots.ts`, `scripts/cases-backfill-fulltext.ts`, new `scripts/cases-audit-robots.ts`

## Motivation

The official-source full-text fetcher claims to "respect robots.txt," but it does not.
`fetchOfficialText` only checks a **hardcoded 4-entry `ROBOTS_DENY` list** (two SCC `/icm/`
documents) — it never fetches or parses any host's actual `robots.txt`. A survey found that
`www.bccourts.ca/robots.txt` contains `Disallow: /jdb-txt/`, which is **exactly the path our
backfill fetched** (`/jdb-txt/sc/<yy>/<nn>/<citation>.htm`). All 806 backfilled BC judgments
were therefore retrieved from a robots-disallowed path (browser UA bypassed the 403), and the
site's `sitemap.xml` lists only informational pages, not `/jdb-txt/` — so there is no "invitation
to crawl" that reconciles it.

This is not illegal access (public court records; BC has a judgment-reproduction policy), but it
**violates the project's stated red line — "no autonomous crawling / respect robots / official-open
sources only"** — which is the credibility spine for a client (Indigenomics Institute) with
Indigenous data-sovereignty commitments. This design makes robots compliance real, and surfaces
the blast radius of the existing violation for a separate remediation decision.

**Red line:** the fetcher must honor each open host's actual `robots.txt` before requesting a
decision URL; a disallowed URL is skipped (never fetched).

## Scope (confirmed)

- **Fetcher fix:** replace the hardcoded `ROBOTS_DENY` with genuine per-host `robots.txt`
  fetch + parse (library-backed), memoized per host.
- **Read-only audit script:** scan the stored corpus and report which cases' `sourceUrl` is now
  robots-disallowed (including the BC 806) — no data mutation, no de-listing.
- **NOT in scope:** remediating the existing 806 BC full texts (the deferred A/B/C decision:
  seek permission / re-source via A2AJ / de-list); adding new host sources (Yukon/NB/MB — after
  this lands); any change to extraction, promotion, or the `OPEN_HOSTS` allowlist's role.

## Semantics (confirmed) — robots.txt fetch outcomes

| `robots.txt` fetch result | Policy |
|---|---|
| **2xx** | Parse; obey its `User-agent: *` rules (allow/disallow, longest-match, wildcards). |
| **404** (genuinely no robots.txt, e.g. NL/QC) | **Allowed** — "no robots.txt = no restrictions." |
| **403** (WAF block, e.g. SCC/Lexum) | **Disallowed (skip)** — conservative; we keep distance from a host that blocks us. |
| **5xx / network error / timeout** | **Disallowed (skip)** — temporary; safe-fail, resumable on re-run. |

This is RFC 9309 behaviour **made conservative on 403** (RFC would treat 403 as allow-all).

## Architecture

### 1. New module — `src/lib/cases/ingest/robots.ts`

Uses the mature, zero-runtime-dependency `robots-parser` library for RFC-9309-correct matching
(`User-agent` group selection, `Allow`/`Disallow` longest-match precedence, `*`/`$` wildcards) —
hand-rolling this risks either re-opening the governance hole (false allow) or dropping legitimate
data (false block). `official-source.ts` is imported only by ops scripts (never by the Web/BriefGen
Lambda bundle), so the dependency has **zero cold-start cost**.

```ts
import robotsParser from "robots-parser";

// User-agent token we match robots groups against. We present a browser UA on the wire and are
// not a named crawler, so this deliberately matches no site-specific group and falls through to
// the catch-all `User-agent: *` group (the conservative, correct choice).
export const ROBOTS_UA = "IndigenomicsLegalHub";

export type RobotsFetchResult = { status: number; body: string };
export type RobotsFetcher = (robotsUrl: string) => Promise<RobotsFetchResult>;

// Default robots.txt fetch: browser UA, single attempt, never throws (network error → status 0).
export const defaultRobotsFetch: RobotsFetcher = async (robotsUrl) => { /* fetch, catch→{status:0,body:""} */ };

// A gate with an internal per-host cache. One instance is reused across a whole backfill/audit
// run so each host's robots.txt is fetched at most once.
export function makeRobotsGate(fetchRobots: RobotsFetcher = defaultRobotsFetch): {
  allows: (url: string) => Promise<boolean>;
} { /* see below */ }

// Process-wide singleton used by fetchOfficialText's default path.
export const defaultRobotsGate = makeRobotsGate();
```

`makeRobotsGate` internals:
- `cache: Map<string, Promise<(url: string) => boolean>>` keyed by `host`.
- `allows(url)`:
  1. Parse `host` from `url`; on parse failure → `false` (skip; malformed URL).
  2. `matcherFor(host)` (memoized): fetch `https://<host>/robots.txt` via `fetchRobots`, then map
     status → a predicate `(url) => boolean` per the **Semantics** table:
     - `2xx`: `const r = robotsParser("https://"+host+"/robots.txt", body); return (u) => r.isAllowed(u, ROBOTS_UA) ?? true;`
       (`robots-parser` returns `undefined` when a URL is outside the file's scope → treat as allowed.)
     - `404`: `() => true` (allowed).
     - `403` / `5xx` / `0` (network/parse error) / anything else: `() => false` (skip).
  3. `return (await matcherFor(host))(url);`
- The predicate for `2xx` is built once per host and reused for every URL on that host.

### 2. Wire into `fetchOfficialText` — `official-source.ts`

- **Delete** the `ROBOTS_DENY` constant and its `.some(...)` check. Its intent (honor SCC robots)
  is now subsumed: SCC's `robots.txt` is a 403 → the gate skips it (and SCC is captcha-blocked for
  bulk anyway).
- Add an injectable `allows` parameter defaulting to the singleton gate, and check robots on the
  **actual URL we request** (`target`, after `toDocumentUrl`):

```ts
export async function fetchOfficialText(
  url: string,
  get: (u: string) => Promise<Fetched> = defaultFetch,
  allows: (u: string) => Promise<boolean> = defaultRobotsGate.allows,
): Promise<string> {
  if (!isOpenSource(url)) return "";              // curation gate: official-open hosts only
  const target = toDocumentUrl(url);
  if (!(await allows(target))) return "";         // crawling-ethics gate: honor robots.txt
  try {
    const { buf, contentType } = await get(target);
    if (buf.length === 0) return "";
    const isPdf = /application\/pdf/i.test(contentType) || target.endsWith("/document.do");
    const text = isPdf ? await pdfToText(buf) : htmlToText(decodeHtml(buf, contentType));
    return text.length >= MIN_TEXT ? text : "";
  } catch { return ""; }
}
```

The `OPEN_HOSTS` allowlist **stays** as a complementary curation gate (only official-open hosts are
even considered); robots is the added crawling-ethics gate. A URL must pass **both**.

**Consequence (intended):** the backfill will now refuse `www.bccourts.ca/jdb-txt/…` (robots
disallows it). BC is already 1740/1740 backfilled so nothing active is lost; future BC full text
must come via the deferred A/B/C path. New open sources whose robots allow the decision paths
continue to work.

### 3. Backfill runner — `scripts/cases-backfill-fulltext.ts`

Minimal change: create **one** gate for the run and pass it to every call, so a host's robots.txt
is fetched once, not once per case.

```ts
import { fetchOfficialText, isOpenSource } from "../src/lib/cases/ingest/official-source";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";
// ...
const gate = makeRobotsGate();
// in the loop:
const text = await fetchOfficialText(c.provenance.sourceUrl, undefined, gate.allows);
```

`robots.ts` is the single home of `makeRobotsGate`; `official-source.ts` imports `defaultRobotsGate`
from it, and the scripts import `makeRobotsGate` from it directly (no re-export).

### 4. Audit script — `scripts/cases-audit-robots.ts` (new, read-only)

```
listCases({ tier: "all" })
  → keep cases where isOpenSource(sourceUrl)
  → for each, gate.allows(toDocumentUrl(sourceUrl))   // one shared gate → per-host memoized
  → bucket: disallowed vs allowed, split by hasFullText, grouped by host
  → print a report; NEVER writes to Dynamo
```

Report shows, per host: total open-source cases, # now **robots-disallowed**, and of those how
many **already have full text** (the true blast radius — e.g. BC 806). Prints a capped sample of
affected case ids/citations. npm scripts `cases:audit-robots` (local `DYNAMO_ENDPOINT`) and
`cases:audit-robots:cloud` (targets `CASES_TABLE`), mirroring existing script pairs. Read-only, so
safe to run against the production table.

### Files

| File | Change |
|---|---|
| `src/lib/cases/ingest/robots.ts` | **New.** `robots-parser`-backed gate: `makeRobotsGate`, `defaultRobotsGate`, `defaultRobotsFetch`, `ROBOTS_UA`, types. Per-host memoized; 2xx/404/403/5xx policy. |
| `src/lib/cases/ingest/official-source.ts` | Remove `ROBOTS_DENY`; add injectable `allows` param to `fetchOfficialText`, check `target`; import `defaultRobotsGate` from `robots.ts`. |
| `scripts/cases-backfill-fulltext.ts` | Create one gate per run, pass `gate.allows` into `fetchOfficialText`. |
| `scripts/cases-audit-robots.ts` | **New.** Read-only corpus audit → robots-disallowed report. |
| `scripts/test-cases-robots.ts` | **New.** Unit tests for the gate (injected robots fetcher). |
| `scripts/test-cases-official-source.ts` | Update existing calls to pass an allow-all gate so they stay offline (see Testing). |
| `package.json` | Add `robots-parser` dep; add `cases:audit-robots` + `:cloud` scripts. |

Unchanged: extraction (`htmlToText`/`pdfToText`/`cleanupPdfText`/`decodeHtml`), `toDocumentUrl`,
`OPEN_HOSTS`, promotion, storage, SST, the Web/BriefGen Lambda bundle (official-source is ops-only).

## Error handling

- Robots fetch never throws (network/parse error → `status: 0` → skip). Backfill/audit continue.
- Malformed URL → `allows` returns `false` (skip), consistent with `isOpenSource`'s try/catch.
- `robots-parser` returning `undefined` (URL out of file scope) → treated as allowed (per 2xx rule).
- Timeouts: `defaultRobotsFetch` uses a bounded fetch; on hang→error→skip (safe-fail, resumable).

## Testing (offline, TDD)

`scripts/test-cases-robots.ts` (inject a canned `RobotsFetcher`, no network, async-IIFE wrapper per
repo convention):
- **bccourts case (the regression):** body with `Disallow: /jdb-txt/` → `/jdb-txt/sc/24/1/foo.htm`
  → `false`; a non-`/jdb-txt/` path on the same host → `true`.
- **404 → allowed;** **403 → disallowed;** **500 → disallowed;** **network error (status 0) → disallowed.**
- **Allow-override + longest-match:** `Disallow: /a/` + `Allow: /a/b` → `/a/b` allowed, `/a/c`
  disallowed (proves library precedence).
- **Wildcard:** e.g. `Disallow: /*.aspx$` blocks `…/Recent_Judgments.aspx`; or `Disallow: /x/*/y`.
- **Per-host memoization:** multiple `allows()` on the same host ⇒ fetcher called **once** (spy).
- **`fetchOfficialText` integration:** with a gate that denies → returns `""` and the page `get` is
  **never called**; with an allow-all gate → proceeds to fetch + extract (existing behaviour).

Update `scripts/test-cases-official-source.ts`: existing `fetchOfficialText(url, fakeGet)` calls
must pass a third arg — an allow-all gate `async () => true` — so they remain offline (otherwise the
default gate would hit the network for robots.txt). No behavioural change to those assertions.

Gate: `npx tsx scripts/test-cases-robots.ts` and `scripts/test-cases-official-source.ts` pass;
`npm run typecheck` clean; `npm run build` compiles (proves nothing dragged official-source into a
route bundle). `npm run verify` (dynamo≡mock) unaffected (no repo/schema change).

## Operational

- **No credentialed data run required to land the code.** After merge, optionally run
  `cases:audit-robots:cloud` (read-only) to quantify the BC 806 blast radius for the A/B/C decision.
- No new AWS resource; no deploy-time infra change (official-source is ops-only, not in any Lambda).

## Governance / safety

- Makes the "respect robots.txt" red line **true in code**, per host, before every request.
- Conservative on ambiguous signals (403/5xx → skip).
- The audit gives an honest, read-only account of the existing violation's scope without silently
  changing or deleting client-facing data.
- Complements `OPEN_HOSTS` (official-open curation) — both gates must pass.

## Explicitly NOT doing (YAGNI + deferred)

- No remediation of the 806 BC full texts (separate A/B/C decision).
- No new host sources (Yukon/NB/MB) — gated behind this landing.
- No `crawl-delay` enforcement (we already pace with `BACKFILL_SLEEP_MS`); no `Sitemap` discovery.
- No per-URL robots caching across processes (per-run in-memory memo is enough).
- No change to extraction, promotion, allowlist, or the Lambda bundle.

## Success criteria

- `fetchOfficialText` returns `""` for a robots-disallowed URL (bccourts `/jdb-txt/` now blocked),
  proven by a unit test; 2xx/404/403/5xx policy verified.
- A host's `robots.txt` is fetched at most once per run (memoization test).
- `cases:audit-robots` reports the BC 806 (and any others) as robots-disallowed, read-only.
- Existing official-source tests pass offline; typecheck + build clean; `verify` unaffected.
- No new Lambda/AWS resource; the fetcher genuinely honors robots per host going forward.
