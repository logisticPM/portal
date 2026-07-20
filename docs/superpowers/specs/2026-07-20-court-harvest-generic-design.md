# Generic Court Harvest + NB/MB Adapters — Design

**Date:** 2026-07-20 · **Status:** approved (design), pre-implementation · **Domain:** new `src/lib/cases/ingest/court-harvest.ts`, new `src/lib/cases/ingest/court-adapters.ts`, new `scripts/cases-harvest-court.ts`, new `scripts/test-cases-court-harvest.ts`; **removes** `yukon.ts` + `cases-harvest-yukon.ts` + their two tests (folded into the generic); `official-source.ts` OPEN_HOSTS + `package.json`

## Motivation

The Yukon pilot proved the direct-court-harvest pattern (18 new core cases from a jurisdiction A2AJ does not index). Extending to **New Brunswick** and **Manitoba** Courts of Appeal — also self-hosted open PDFs, robots-allowed, no captcha — would repeat the same orchestration three times. The Yukon spec explicitly deferred a generic scaffold "until the pilot justifies expansion." It does. This refactors Yukon into an **adapter** behind a generic harvest runner and adds NB + MB adapters, so the three courts share one tested code path and future courts are ~30-line adapters.

**Red line (unchanged):** official-open source, robots-compliant (reuses the per-host gate), deterministic verbatim PDF→text, double-LLM consensus before core, **additive — never overwrites an existing PROFILE/core case**.

## Scope (confirmed)

- **Generic scaffold + adapters**; refactor Yukon into an adapter (its live output must stay byte-identical — the 18 harvested cases are already in prod and are NOT re-run).
- Add **NB Court of Appeal** and **MB Court of Appeal** adapters. Their King's Bench trial decisions are CanLII-only (not self-hosted) → out. MB CoA is **recent-only** (older on CanLII) → documented limitation.
- **Measure yield per court**, then decide further expansion. NB CoA is criminal-heavy and MB is recent-only, so on-topic yield may be below Yukon's 18 — the shortlist + PRISMA gate filter, and we report whatever lands.

## Site structures (verified)

| Court | Index | PDF URL | Citation in filename |
|---|---|---|---|
| **Yukon** YKCA/YKSC | one page per court `/en/<court>/judgments` | `/sites/default/files/<yyyy-mm>/<file>.pdf` | `<yyyy>[-_]yk(sc\|ca)[-_]?<n>` |
| **NB** NBCA | landing `/content/cour/en/appeal/content/decisions.html` → monthly `…/decisions/<yyyy>/<month>.html` | `/content/dam/courts/pdf/appeal-appel/decisions/<yyyy>/<mm>/<date>-<parties>-<yyyy>-nbca-<n>.pdf` | `<yyyy>-nbca-<n>` |
| **MB** MBCA | one page `/court-of-appeal/recent-judgments/` (recent only) | `/site/assets/files/1036/<parties>_<yyyy>_mbca_<n>.pdf` | `<yyyy>[-_]mbca[-_]<n>` |

robots: Yukon allows `/sites/default/files/` (only `/search/` denied); NB (gnb.ca) allows `/content/cour/…` + `/content/dam/courts/pdf/…`; MB open. All enforced at runtime by the per-host gate regardless.

## Architecture

### 1. Generic core — `src/lib/cases/ingest/court-harvest.ts` (pure)

```ts
import type { LegalCase, CourtLevel } from "../types";

export interface CourtListingRow { citation: string; court: string; pdfUrl: string; fileName: string; }

export interface CourtAdapter {
  id: string;                 // "yukon" | "nb" | "mb"
  baseUrl: string;            // e.g. "https://www.yukoncourts.ca"
  indexUrls: string[];        // top listing pages to start crawling (absolute)
  // Parse ONE listing/index page → decision PDF rows found here + sub-index pages to also crawl.
  // (Yukon/MB: rows only, subIndexUrls []. NB landing: rows [], subIndexUrls = monthly pages;
  //  NB monthly: rows = PDFs, subIndexUrls [].)
  parseListing(html: string, pageUrl: string): { rows: CourtListingRow[]; subIndexUrls: string[] };
  level(court: string): CourtLevel;   // court code → level
  regionSignal: RegExp;       // region First-Nation names (+ any court-specific gov party)
}

// Shared Indigenous + economic keyword signal (generic across courts).
export const SHARED_SIGNAL: RegExp;   // first nation(s), aboriginal, indigenous, métis, treaty,
// land title, self-government, duty to consult, mineral, resource, royalt, expropriat, compensation

// List-level shortlist: shared signal OR the adapter's region signal, over citation+filename
// (underscores → spaces first, so `\b` fires after filename separators).
export function isCandidate(row: CourtListingRow, adapter: CourtAdapter): boolean;

// Best-effort display name from filename (party names live there). Feeds includeCandidate text.
export function styleFromFileName(fileName: string, citation: string): string;

// Map a fetched decision → substrate LegalCase (mirrors a2ajToCase's field set). Reuses
// slugCitation + chunkText from a2aj.ts. court/level from the row + adapter.level().
export function courtToCase(row: CourtListingRow, text: string, adapter: CourtAdapter): LegalCase;
```

### 2. Adapters — `src/lib/cases/ingest/court-adapters.ts` (pure)

Each adapter = `indexUrls` + `parseListing` (site-specific regex) + `level` + `regionSignal`. A shared
`extractPdfRows(html, baseUrl, citationRe, courtOf)` helper keeps the three `parseListing`s DRY:
scan `<a href="…​.pdf">`, absolutize, decode the filename, apply `citationRe` → `{citation, court}`,
de-dup by citation.

- **`yukonAdapter`** (behavior-preserving refactor of `yukon.ts`): `indexUrls` = the CA + SC judgment
  pages; `parseListing` uses `/(\d{4})[-_]yk(sc|ca)[-_]?(\d+)/i` → court `YKCA|YKSC`, subIndexUrls [];
  `level` {YKCA: provincial_appeal, YKSC: provincial_superior}; `regionSignal` = the current Yukon
  nation list **+ `yukon (government of)`** (so output matches the shipped `yukon.ts` exactly).
- **`nbAdapter`**: `indexUrls` = [`…/appeal/content/decisions.html`]; `parseListing` returns PDF rows
  (`/(\d{4})-nbca-(\d+)/i` → `NBCA`) **and** subIndexUrls = monthly links matching
  `/content/cour/en/appeal/content/decisions/\d{4}/[a-z]+\.html`; `level` {NBCA: provincial_appeal};
  `regionSignal` = Mi'kmaq/Mi'gmaq, Wolastoqiyik/Maliseet, Passamaquoddy/Peskotomuhkati, Elsipogtog,
  Madawaska, Tobique/Neqotkuk, Esgenoôpetitj, Woodstock, Oromocto, Kingsclear, Saint Mary's, + `first nation`.
- **`mbAdapter`**: `indexUrls` = [`/court-of-appeal/recent-judgments/`]; `parseListing`
  (`/(\d{4})[-_]mbca[-_](\d+)/i` → `MBCA`), subIndexUrls []; `level` {MBCA: provincial_appeal};
  `regionSignal` = Cree, Ojibw(a|e)/Anishinaabe/Anishinabe, Dakota, Oji-Cree, Saulteaux, Dene,
  Métis/Metis, Peguis, Sagkeeng, Norway House, Pimicikamak/Cross Lake, Roseau River, Long Plain,
  Swan Lake, Sioux Valley, treaty land entitlement, + `first nation`.

`export const ADAPTERS: Record<string, CourtAdapter> = { yukon, nb, mb };`

### 3. Runner — `scripts/cases-harvest-court.ts` (additive, injectable deps)

```ts
export interface CourtHarvestDeps {
  fetchListing: (url: string) => Promise<string>;   // robots-checked raw HTML
  fetchText: (pdfUrl: string) => Promise<string>;   // fetchOfficialText (robots + PDF)
  exists: (id: string) => Promise<boolean>;
  promote: (c: LegalCase) => Promise<LegalCase | "no_consensus" | null>;
  writeCase: (c: LegalCase) => Promise<void>;
}
export interface CourtReport { indexPages; listed; shortlisted; gotText; passedPrisma; alreadyPresent; promoted; excluded }
export async function runCourtHarvest(adapter: CourtAdapter, deps: CourtHarvestDeps): Promise<CourtReport>;
```

- **BFS enumeration:** queue = `adapter.indexUrls`; visited-set guards re-fetch and caps total index
  pages (e.g. ≤ 200) to bound NB's monthly crawl; for each, `fetchListing` → `adapter.parseListing`
  → collect `rows`, enqueue unvisited `subIndexUrls`. Then de-dup rows by citation across pages.
- **Per row:** `isCandidate(row, adapter)` shortlist → `fetchText(pdfUrl)` (skip if "") →
  `courtToCase(row, text, adapter)` → `includeCandidate` PRISMA gate (tally reason on miss) →
  `exists(id)` guard (skip `alreadyPresent`, **never overwrite**) → `promote` → store
  (`caseToItems`, promoted-core or substrate). Same shape as the Yukon runner.
- **Live deps:** one shared `makeRobotsGate()` for `fetchListing` (browser-UA raw GET, robots-checked)
  and `fetchText` (`fetchOfficialText(url, undefined, gate.allows)`); `exists` via
  `dynamoCaseRepo.getCase`; `promote` = `promoteOne`; `writeCase` = BatchWrite `caseToItems`.
- `main` reads `HARVEST_COURT` (`yukon|nb|mb`) → `ADAPTERS[court]` → `runCourtHarvest`. Report line:
  `<court>: index-pages P · listed L · shortlisted S · got-text T · passed-PRISMA X · already-present A · promoted-to-core C` + PRISMA-excluded + per-theme promoted breakdown.

### 4. OPEN_HOSTS + npm

- `official-source.ts` OPEN_HOSTS += `"www.courtsnb-coursnb.ca"`, `"www.manitobacourts.mb.ca"` (the
  #187 lesson: `fetchOfficialText` gates on this allowlist).
- `package.json`: `cases:harvest-yukon[:cloud]`, `cases:harvest-nb[:cloud]`, `cases:harvest-mb[:cloud]`
  — all invoke `scripts/cases-harvest-court.ts` with `HARVEST_COURT` set (via cross-env), keeping the
  existing `REPO_IMPL=dynamo BEDROCK_REGION=us-east-1` env.

### Files

| File | Change |
|---|---|
| `src/lib/cases/ingest/court-harvest.ts` | **New.** Types, `SHARED_SIGNAL`, `isCandidate`, `styleFromFileName`, `courtToCase`. |
| `src/lib/cases/ingest/court-adapters.ts` | **New.** `yukonAdapter`/`nbAdapter`/`mbAdapter` + `ADAPTERS` + `extractPdfRows` helper. |
| `scripts/cases-harvest-court.ts` | **New.** `runCourtHarvest` + live deps + `main` (HARVEST_COURT). |
| `scripts/test-cases-court-harvest.ts` | **New.** Adapter parse + isCandidate + courtToCase + additive-safety tests. |
| `src/lib/cases/ingest/yukon.ts` | **Remove** (folded into court-harvest + yukonAdapter). |
| `scripts/cases-harvest-yukon.ts` | **Remove** (replaced by cases-harvest-court.ts). |
| `scripts/test-cases-yukon.ts`, `scripts/test-cases-harvest-yukon.ts` | **Remove** (covered by the new test). |
| `src/lib/cases/ingest/official-source.ts` | OPEN_HOSTS += NB + MB hosts. |
| `package.json` | Yukon script → cases-harvest-court; add nb/mb scripts. |

Unchanged: `official-source.ts` fetch/extract, `robots.ts`, `include.ts`, `promoteOne`, `slugCitation`/`chunkText`, `CaseRepo`, storage, SST, Lambda bundle. Ops-only; additive writes = normal PROFILE/CHUNK items.

## Error handling

- Index page fetch fail / robots-denied → skip that page (warn), continue others.
- Candidate PDF empty text → skip (counted). PRISMA miss → tally reason. Already-present → skip (additive).
- `promoteOne` throw/labeler-unavailable → caught → store substrate; run never aborts; resumable.
- BFS visited-set + page cap prevents runaway crawls / cycles.

## Testing (offline, TDD)

`scripts/test-cases-court-harvest.ts` (async-IIFE, `node:assert/strict`, injected deps, no network):
- **yukonAdapter.parseListing** on the existing Yukon fixture → identical rows to the removed
  `test-cases-yukon.ts` (behavior-preserving refactor guard).
- **nbAdapter.parseListing**: a landing fixture → `subIndexUrls` = monthly pages, `rows` []; a monthly
  fixture → `rows` with `2025 NBCA 81` etc. from `…-2025-nbca-81.pdf`.
- **mbAdapter.parseListing**: recent fixture → `rows` with `2026 MBCA 65` from `…_2026_mbca_65.pdf`.
- **isCandidate**: per region — Yukon "FNNND … Yukon (Government of)" TRUE, "ABC v XYZ" FALSE; NB
  "Mi'kmaq"/"first nation" TRUE, "R v Smith" FALSE; MB "Peguis First Nation"/"treaty land entitlement"
  TRUE, "R v Jones" FALSE.
- **courtToCase**: id=slug, court/level correct per adapter, provenance official_court, chunks present.
- **runCourtHarvest** (injected deps, nb adapter with a 2-level fixture): BFS visits landing + monthly;
  an already-present id is **skipped, never written**; a new candidate promotes.

Gate: `npx tsx scripts/test-cases-court-harvest.ts` passes; `npm run typecheck` clean; `npm run build`
compiles (ops-only, not in any route bundle); `npm run verify` unaffected.

## Operational / deploy

- **Credentialed runs (after merge):** `cases:harvest-nb:cloud` and `cases:harvest-mb:cloud` with
  `LABEL_MODELS` (`amazon.nova-lite-v1:0,us.meta.llama3-3-70b-instruct-v1:0`) + Bedrock creds. Report
  yield per court. If kept, run the derived-layer refresh (summarize/figures/nations → embed →
  index-build) + prod check. Yukon is already harvested — **do not re-run it** (additive would skip anyway).
- No new AWS resource; no SST/deploy change.

## Governance / safety

- Official-open, robots-compliant (shared gate; NB/MB paths allowed, enforced at runtime), verbatim
  PDF→text, double-LLM consensus before core, **additive — never overwrites core** (asserted by test).
- Region keyword lists are recall-conservative shortlists; the full-text PRISMA gate + double-LLM are
  the real relevance bars. Indigenous data sovereignty: public records, unofficial-copy provenance.

## Explicitly NOT doing (YAGNI + deferred)

- No NB/MB King's Bench (CanLII-only), no other provinces, no Yukon lower courts.
- No re-harvest of Yukon (already in prod).
- No generic pagination beyond the BFS index-page crawl (these sites are single-page or monthly-index).
- No change to retrieval, promotion logic, or the Lambda bundle.

## Success criteria

- One generic `runCourtHarvest(adapter)` drives all three courts; `yukonAdapter` reproduces the shipped
  Yukon output (fixture-asserted); NB + MB adapters parse their real structures.
- `cases:harvest-nb:cloud` / `:mb:cloud` enumerate (NB via monthly BFS), shortlist, fetch candidates
  (robots-compliant), PRISMA-filter, additively add new core — never overwriting — with per-court yield.
- Court-harvest unit tests green; typecheck + build clean; `verify` unaffected; no new AWS resource.
