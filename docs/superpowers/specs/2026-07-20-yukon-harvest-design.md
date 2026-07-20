# Yukon Direct-Court Harvest (pilot) — Design

**Date:** 2026-07-20 · **Status:** approved (design), pre-implementation · **Domain:** new `src/lib/cases/ingest/yukon.ts`, new `scripts/cases-harvest-yukon.ts`, new `scripts/test-cases-yukon.ts`, small `a2aj.ts` LEVEL addition, `package.json`

## Motivation

A2AJ (our discovery engine) does not index the Yukon Supreme Court or most provincial courts, so the existing "backfill full text for cases A2AJ already found" path cannot add these jurisdictions — they need **direct-court harvesting**. This is a **pilot for one jurisdiction (Yukon)** to measure the real on-topic yield (Indigenous economic-justice decisions) before deciding whether to build harvesters for NB/MB or Yukon's lower courts.

Yukon is a good pilot: `www.yukoncourts.ca` self-hosts every decision as an open PDF under `/sites/default/files/…`, its `robots.txt` allows the judgment index pages and the file paths (only `/search/`, `/admin/`, `/user/*` are disallowed), there is **no captcha**, and each court's judgments are a **single un-paginated index page** (the Supreme Court page alone links 1,529 PDFs). Territories also have a high proportion of Indigenous litigants (e.g. First Nation of Nacho Nyak Dun v Yukon — the Peel watershed land-use line).

**Red line:** official-open source, **robots-compliant** (reuses the gate from the robots-compliance work), deterministic verbatim PDF→text, double-LLM consensus before core, and **additive — never overwrites an existing PROFILE/core case**.

## Scope (confirmed)

- **Pilot = Court of Appeal (YKCA) + Supreme Court (YKSC) only.** Territorial Court and Small Claims are out (criminal/small-civil → negligible economic-justice yield).
- **List-level shortlist first, then fetch only candidates** — filter the index rows by an Indigenous/economic keyword heuristic on the citation + party names in the PDF filename, and fetch only shortlisted PDFs. Bounded cost (dozens of fetches, not ~2,000); recall is deliberately conservative (documented limitation).
- **Measure yield, then decide.** Produce a Result doc with counts; NB/MB and Yukon's lower courts are explicitly deferred.

## Architecture

### 1. Pure module — `src/lib/cases/ingest/yukon.ts`

```ts
import type { LegalCase } from "../types";
import { slugCitation, chunkText } from "./a2aj";  // reuse existing helpers

export const YUKON_COURTS = {
  "court-appeal": "YKCA",
  "supreme-court": "YKSC",
} as const;
export type YukonCourtSlug = keyof typeof YUKON_COURTS;

export interface YukonListingRow { citation: string; pdfUrl: string; fileName: string; }

// Parse a Yukon court judgment index page → one row per decision PDF. Deterministic
// HTML scan for hrefs matching /sites/default/files/<yyyy-mm>/<file>.pdf plus the
// nearby citation text (e.g. "2026 YKSC 36"). Absolute-izes the URL against baseUrl.
export function parseYukonListing(html: string, baseUrl: string): YukonListingRow[];

// List-level shortlist heuristic (recall-conservative, documented). True when the
// citation or filename shows an Indigenous-party signal (Yukon First Nation names,
// "First Nation(s)", "Yukon (Government of)" as a party) OR an economic/land signal
// (land, title, treaty, mineral, resource, royalty, compensation, self-government).
export function isIndigenousEconomicCandidate(row: YukonListingRow): boolean;

// Map a fetched decision (row + verbatim PDF text) → a substrate LegalCase.
// id = slugCitation(citation); court = "YKCA"|"YKSC"; sourceUrl = pdfUrl;
// chunks = chunkText(text); provenance.source = "official_court"; corpusTier = "substrate";
// enrichmentLevel "index"; nations/themes [] (enrichment/promotion fill); outcome unclassified.
export function yukonToCase(row: YukonListingRow, court: "YKCA" | "YKSC", text: string): LegalCase;
```

- `parseYukonListing` is verbatim/deterministic (no LLM): regex/scan for the `<a href="…​.pdf">` under `/sites/default/files/` and the citation token. Filenames are URL-encoded (`%20`) → decode for `fileName`; keep the raw `pdfUrl` for fetching.
- `isIndigenousEconomicCandidate` uses a small keyword set (Yukon First Nations: Nacho Nyak Dun/FNNND, Kwanlin Dün, Champagne and Aishihik, Little Salmon/Carmacks, Ross River Dena, Teslin Tlingit, Vuntut Gwitchin, Tr'ondëk Hwëch'in, Carcross/Tagish, Selkirk, Kluane, White River, Liard, Ta'an Kwäch'än; plus `first nation`, `Yukon (Government of)`, and land/treaty/mineral/resource/royalty/compensation/self-government terms). Case-insensitive. **Conservative recall by design** — anonymized captions (e.g. "ABC v XYZ", family/child files) are correctly excluded.
- `yukonToCase` reuses `slugCitation` + `chunkText` from `a2aj.ts` (same id scheme + retrieval chunking as the rest of the corpus). `a2aj.ts` `LEVEL` map gains `YKSC: "provincial_superior"` (YKCA is already `provincial_appeal`); `yukonToCase` sets `level` from that map.

### 2. Harvest script — `scripts/cases-harvest-yukon.ts` (additive, mirrors `cases-harvest-economic`)

`fetchListingHtml` and the per-PDF fetching are **script-local** (network) so `yukon.ts` stays pure/offline-testable. Flow (per court in `YUKON_COURTS`, pilot = both):
```
fetchListingHtml(`https://www.yukoncourts.ca/en/${slug}/judgments`)   // robots-checked, browser UA, raw HTML
  → parseYukonListing → isIndigenousEconomicCandidate           // list-level shortlist
  → for each candidate:
       fetchOfficialText(pdfUrl)                                // robots-compliant + PDF branch (reused)
       → yukonToCase(row, court, text)
       → includeCandidate(case)                                 // PRISMA text-level gate (indigenous + economic)
       → additive: write ONLY if PROFILE PK absent              // never overwrite existing (incl. A2AJ YKCA)
       → promoteOne(case)                                       // inline double-LLM consensus → measures core yield
       → store (promoted core | substrate) via caseToItems
```

- **Robots compliance:** one `makeRobotsGate()` per run, shared by the listing fetch and every `fetchOfficialText` call (so `yukoncourts.ca/robots.txt` is fetched once). `fetchListingHtml` calls `gate.allows(url)` before fetching the raw HTML (browser UA); the index pages are robots-allowed, the PDFs are robots-allowed, so this passes — but we honor it mechanically, not by assumption.
- **Additive safety (ironclad):** write a case only if its PROFILE PK does not already exist (`attribute_not_exists(PK)` conditional, per `cases-harvest-economic`). This means existing A2AJ-sourced **YKCA** records (whose `sourceUrl` points at the now-robots-blocked bccourts) are **skipped, never overwritten** — the pilot adds genuinely-new decisions (all YKSC, plus any YKCA A2AJ missed). No existing full text/vectors are touched.
- **Yield via inline promote:** `promoteOne` (the existing three-state promoter: `LegalCase | "no_consensus" | null`) runs with `LABEL_MODELS` set (credentialed run) → promoted cases become core; non-consensus/failed are stored as substrate (mirrors `cases-backfill-fulltext`). This gives the pilot's headline number directly.
- **Report:** `listed N · shortlisted S · got-text T · passed-PRISMA P · promoted-to-core C`, plus a per-theme breakdown of the promoted set.
- npm scripts (mirror existing pairs): `cases:harvest-yukon` (local `DYNAMO_ENDPOINT`) and `cases:harvest-yukon:cloud` (`AWS_REGION`), both `REPO_IMPL=dynamo BEDROCK_REGION=us-east-1`.

### 3. Files

| File | Change |
|---|---|
| `src/lib/cases/ingest/yukon.ts` | **New.** `parseYukonListing`, `isIndigenousEconomicCandidate`, `yukonToCase`, `YUKON_COURTS`. |
| `src/lib/cases/ingest/a2aj.ts` | Add `YKSC: "provincial_superior"` to the `LEVEL` map (one line). |
| `scripts/cases-harvest-yukon.ts` | **New.** Additive harvest runner (robots-gated, shortlist → fetch → PRISMA → inline promote). |
| `scripts/test-cases-yukon.ts` | **New.** Offline unit tests (fixture HTML + injected fetch/promote). |
| `package.json` | Add `cases:harvest-yukon` + `:cloud`. |

Unchanged: `official-source.ts`/`robots.ts` (reused as-is), `include.ts`, `promoteOne`/labeler, `CaseRepo`, storage schema, SST, the Web/BriefGen Lambda bundle. No parity impact (harvest is an ops script; additive writes are normal PROFILE/CHUNK items, visible to the corpus exactly like any other core/substrate case).

## Error handling

- Listing fetch fails / robots-disallowed → that court is skipped with a logged warning (the other court still runs).
- A candidate PDF that yields no text (`fetchOfficialText` returns "") → skipped, counted as `got-text` miss.
- `includeCandidate` false → skipped with its PRISMA reason tallied.
- Already-present PROFILE (`ConditionalCheckFailedException`) → skipped (additive safety), counted `already-present`.
- `promoteOne` throwing/labeler unavailable → caught; store as substrate (never abort the run); resumable on re-run (additive).

## Testing (offline, TDD)

`scripts/test-cases-yukon.ts` (async-IIFE, `node:assert/strict`, injected deps — no network):
- `parseYukonListing`: a fixture HTML snippet with 2–3 `/sites/default/files/…​.pdf` rows → correct `{citation, pdfUrl, fileName}` (absolute URL, decoded filename); ignores non-PDF/`favicon` links.
- `isIndigenousEconomicCandidate`: TRUE for `2026 YKSC 36 FNNND v Yukon (Government of)` and a "First Nation" / land-title caption; FALSE for `ABC v XYZ` and a plain criminal caption.
- `yukonToCase`: id = `slugCitation`, `court`/`level` correct (YKSC→provincial_superior, YKCA→provincial_appeal), `sourceUrl` = pdfUrl, `chunks` present, `provenance.source` = "official_court", `corpusTier` = "substrate".
- Harvest additive-safety: an injected `send` that throws `ConditionalCheckFailedException` for an existing PK → that case counted `already-present`, never re-written (mirror `cases-harvest-economic` test).
- (Enumeration/PDF/robots mechanics are already covered by the official-source + robots test suites.)

Gate: `npx tsx scripts/test-cases-yukon.ts` passes; `npm run typecheck` clean; `npm run build` compiles (proves `yukon.ts` didn't get pulled into an app route bundle — ops-only, like official-source). `npm run verify` (dynamo≡mock) unaffected.

## Operational / deploy

- **Credentialed pilot run (after merge):** `cases:harvest-yukon:cloud` with `LABEL_MODELS` (double-LLM) + Bedrock creds. Report `listed/shortlisted/got-text/passed-PRISMA/promoted` → write the Result doc.
- **If promoted cases are kept:** run the derived-layer refresh ritual on the new core (summaries → figures → nations → `cases:embed:bedrock:cloud` → `cases:index-build:cloud`), then confirm on prod. (Not part of this PR; gated on the yield being worth keeping.)
- **No new AWS resource.** No SST/deploy change. Ships as ops code on the merge.

## Governance / safety

- Official-open source (yukoncourts.ca), **robots-compliant** (reuses the per-host gate; index + file paths are allowed, `/search/` is not touched), deterministic verbatim PDF→text (fabrication-safe downstream).
- **Additive — never overwrites an existing PROFILE/core case** (the corpus-integrity rule from the economic harvest); existing A2AJ YKCA records are left intact.
- Double-LLM consensus gate before core (same bar as all promotion); PRISMA reasons recorded.
- Indigenous data sovereignty: public court records, unofficial-copy provenance, extractive only.

## Explicitly NOT doing (YAGNI + deferred)

- No NB/MB harvesters, no Yukon Territorial/Small Claims courts (gated on this pilot's yield).
- No re-sourcing of existing A2AJ YKCA full text from yukoncourts (that's the separate robots-806 A/B/C decision).
- No site-search use (robots-disallowed) — index-page browse only.
- No generic multi-court framework yet (build the reusable scaffold only if the pilot justifies expansion).
- No new AWS resource; no change to retrieval, promotion logic, or the Lambda bundle.

## Success criteria

- `cases:harvest-yukon` enumerates YKCA+YKSC index pages, shortlists Indigenous/economic candidates, fetches only those PDFs (robots-compliant), PRISMA-filters, and additively adds new substrate — never overwriting an existing case — with a clear yield report.
- Yukon unit tests green; typecheck + build clean; `verify` unaffected.
- Credentialed pilot produces a real promoted-to-core count + theme breakdown in a Result doc, from which we decide NB/MB / lower-court expansion.
