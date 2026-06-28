# Indigenomics Economic Justice Legal Cases Activation Hub — Design Spec (Focus Area 2)

**Status:** Approved direction · ready for implementation plan
**Date:** 2026-06-27
**Audience:** The capstone team — extends the existing Indigenomics Data Portal (`7980/demo`)
**Purpose:** Single source of truth for the Legal Cases Hub build. It is a **third domain** inside the existing portal, mirroring the `repo/` (portal) and `survey/` domains. Read this before writing code: what we're building, why, the data sourcing reality (validated against live APIs), and the exact interface seam.

> **Research backing.** Every major decision here is grounded in four research artifacts (currently in `7980/legal/docs/research/` — copy into this repo's `docs/research/` on build start):
> 1. `2026-06-25-market-and-academic-research.md` — competitive + academic landscape
> 2. `2026-06-25-legal-search-state-of-the-art.md` — legal-text search/RAG state of the art
> 3. Live A2AJ API validation (this session) — data availability, fields, scale
> 4. Bill Gallagher case-list reconstruction + A2AJ match test (this session)

---

## 0. How to read this doc

- **Everyone:** §1–§3 (context, scope, architecture) and §13 (ownership/coordination).
- **Data group:** §6–§10 are your build surface — data model (§6), the `CaseRepo` interface (§7), single-table keys (§8), data sourcing/ingestion (§9), search (§10), Appendix A.
- **Frontend group:** §5–§7 and §11 — you build against `CaseRepo`; you never import DynamoDB or call A2AJ directly.

The one rule that makes parallel work possible (same as the portal): **the only shared file is `src/lib/cases/types.ts`.** Everything else each group owns independently.

---

## 1. Product context (why this exists)

This is **Focus Area 2** of the Indigenomics platform. Indigenous Peoples in Canada have prevailed in **350+ legal cases of direct economic consequence** — land rights, resource revenue, consultation & accommodation, treaty implementation, fiduciary duty, and the economic dimensions of self-determination. The decisions exist; the precedents are established. **What's missing is the intelligence infrastructure that makes this body of case law searchable, analytically actionable, and economically legible.** This Hub builds that layer.

### 1.1 Positioning — the layered decision (read this carefully)

The client is the **Indigenomics Institute** (Carol Anne Hilton). Its brand DNA is economic *empowerment and opportunity* (the "$100B" agenda, Bay Street, "take a seat at the economic table") — **not** a critical/grievance frame. So:

| Layer | Direction | Why |
|---|---|---|
| **Outward (UI / brand / narrative)** | **Economic activation** — "turn Indigenous legal wins into investable, actionable economic intelligence" | Matches Indigenomics' brand + capital-markets audience |
| **Inward (engine / methodology)** | **Rigorous & transparent** — explicit outcome taxonomy, citation-anchored, provenance on every record | Survives due diligence; avoids the credibility trap below |

**The anti-pattern we must avoid:** do **not** lead with a bare "350 wins" counter or a triumphalist "winning streak wall." Academic research established that Gallagher's 350 figure has no published methodology, is contested by serious scholars (Newman), and bundles non-judgments (regulatory outcomes, injunctions, project cancellations). Leading with it undercuts credibility with the academic + Indigenous audiences the platform needs. Instead: attribute the number, scope it, and back it with a transparent taxonomy.

**The differentiating feature** is the inverse of a triumphal tally: a **value-realization** lens — did a legal win convert into actual economic outcome (settlement $, resource revenue, equity, agreement)? This is the most defensible economic-justice claim and is unoccupied by any competitor (see §1.2). We frame it in Indigenomics' positive language ("value realization"), not Yellowhead's grievance language ("the gap").

### 1.2 Competitive white space (validated)

No existing product occupies the intersection of **{Indigenous case corpus} × {analytics layer} × {economic-justice framing} × {Indigenous-governed}**:
- General legal DBs (CanLII free, Westlaw, Lexis+, vLex) — have cases, but only citation relationships, no outcome/economic structuring, not Indigenous-focused.
- Legal AI/analytics (Blue J, Lex Machina, Premonition, Harvey, CoCounsel) — none Indigenous-focused, mostly US.
- The closest product — **LexisNexis Canada "Aboriginal Law"** — is a curated content library with **zero analytics and zero economic dimension**. It proves demand and leaves the analytic + economic layer empty.
- Bill Gallagher / *Resource Rulers* is a book + consultancy, **not a product** — no searchable, current, Indigenous-governed case database exists. That is exactly the gap this Hub fills.

---

## 2. MVP scope — production-grade

**The one-sentence demo:**
> Search/filter the curated Indigenous economic-justice case corpus → open a case → read a citation-anchored summary + its economic dimension + value-realization status + citation graph → see the activation dashboard roll it up.

**In scope (production-grade MVP):**
- New `cases` domain in the existing repo: `types.ts` seam + `repo.mock.ts` + `repo.dynamo.ts` + `index.ts` (REPO_IMPL selector) + `dynamo/cases-table.ts` + fixtures/seed + `cases:create`/`cases:seed` scripts + `verify` checks.
- **Hybrid corpus** (validated sizing, §12): **~40–80 flagship cases deeply enriched** (summary, economic dimension, value-realization, paragraph chunks, citation graph) + **~few-hundred index-level records** (citation/name/court/year/theme/outcome).
- **Search + faceted browse** (`/cases`): full-text + filters (theme, court level, win-type, nation, year). Hybrid-ready design; MVP uses in-memory filtering (corpus is small — §10).
- **Case detail** (`/cases/[id]`): citation-anchored summary (extractive, never free-form), economic dimension, value-realization status, citation graph (cases cited / citing), link to official source.
- **Activation dashboard** (`/cases/activation`): totals by theme, economic value aggregates, **value-realization funnel** (declared → negotiating → realized) — Indigenomics framing. Mirrors the portal's `getIndexSummary` analytics pattern.
- **OCAP export** (`exportCases`) — mirrors the portal's `exportRecords`.
- Real data ingested from **A2AJ** (validated live), running on DynamoDB (Local + cloud), end-to-end, deployable via the existing SST pipeline.

**Out of scope (Phase 2)** — see §14. Notably: LLM/RAG Q&A, semantic/vector search + external search index (OpenSearch), automated full-corpus ingestion pipeline, provincial-gap scraper, user-editable cases, French/bilingual, real auth (reuse the portal's).

**Definition of done:** a reviewer runs `npm run dev` + `cases:create`/`cases:seed` against DynamoDB Local, performs the one-sentence demo in the browser, every displayed claim links to a source paragraph, and the activation dashboard reflects the seeded corpus.

---

## 3. Architecture & the one principle

A **third domain** beside `DataPortal` and `RapSurvey`, governed by the same **contract-first** principle. The frontend never imports DynamoDB, AWS SDK, or calls A2AJ — it calls typed methods on `casesRepo`; the implementation (mock | dynamo) is chosen by `REPO_IMPL` and is invisible.

```
        ┌─────────────────────────────────────────────┐
        │  UI  (Next.js pages: /cases, /cases/[id],    │
        │       /cases/activation)        [Frontend]    │
        └───────────────────┬─────────────────────────┘
                            │  imports & calls casesRepo
                            ▼
        ┌─────────────────────────────────────────────┐
        │  THE SEAM:  src/lib/cases/types.ts            │
        │  CaseRepo interface  (co-owned)               │
        └───────────────────┬─────────────────────────┘
              ┌─────────────┴──────────────┐
              ▼                             ▼
   repo.mock.ts (in-memory)      repo.dynamo.ts (DynamoDB)
   [build pages day one]          + dynamo/cases-table.ts + seed/
                                  + (Phase 2) search-index projection
```

**Source-agnostic by design:** because every record carries `provenance` + `enrichmentLevel`, adding a new data source (A2AJ, official court site, manual) is just another ingestion path writing the same record shape — no architecture change.

---

## 4. Tech stack & decisions

| Decision | Choice | Notes |
|---|---|---|
| Frontend | **Next.js (App Router) + TS + Tailwind** | Same app as the portal; reuse `components/ui.tsx`, `auth.ts`, `middleware.ts`. |
| Database | **AWS DynamoDB, single-table** (`LegalCases`) | Third table beside `DataPortal`/`RapSurvey`. Access-pattern-driven (Appendix A). |
| Data access | **`@aws-sdk/lib-dynamodb`** | Server-side only. |
| Local dev | **DynamoDB Local (Docker)** + seed | Same harness as the portal. |
| Deploy | **SST / OpenNext on AWS** | Reuse the existing pipeline. |
| Data source | **A2AJ** (`api.a2aj.ca`, open, MIT) — primary | Validated live: full text + citation graph + per-doc license. CanLII = discovery/citator only (no bulk — §9). |
| Search (MVP) | **In-memory hybrid-ready filtering** | Corpus is hundreds of cases → brute force is correct (§10). |
| Search (Phase 2) | **Amazon OpenSearch** (BM25 + k-NN) or pgvector, behind the seam | Add only when corpus/feature growth justifies it. |
| LLM (Phase 2) | **Amazon Bedrock (Claude)** + quote-grounded RAG | Behind `CaseRepo`; retrieval index is a derived, rebuildable projection (§10, §11). |

---

## 5. Repository structure

```
demo/
  docs/specs/2026-06-27-legal-cases-hub-design.md   ← this file
  src/
    app/cases/
      page.tsx              # search + faceted browse        [Frontend]
      [id]/page.tsx         # case detail (citation-anchored) [Frontend]
      activation/page.tsx   # activation dashboard            [Frontend]
    lib/cases/
      types.ts              # THE SEAM — CaseRepo + domain types   [co-owned]
      index.ts              # REPO_IMPL selects mock | dynamo       [Data]
      repo.mock.ts          # in-memory impl                        [Data]
      repo.dynamo.ts        # DynamoDB impl                         [Data]
      fixtures.ts / seed.ts # curated seed corpus                   [Data]
    lib/dynamo/
      cases-table.ts        # keys + marshalling (mirrors single-table.ts) [Data]
  scripts/
    create-table.ts         # extend: DYNAMO_TABLE=LegalCases
    seed-cases.ts           # seed the cases corpus
    verify.ts               # extend with cases checks
```

---

## 6. Data model — the seam (`src/lib/cases/types.ts`)

```ts
export type Theme =
  | "land_rights" | "resource_revenue" | "duty_to_consult"
  | "treaty" | "fiduciary" | "self_determination";

export type CourtLevel = "scc" | "fca" | "fc" | "provincial_appeal"
  | "provincial_superior" | "tribunal";

// The outcome taxonomy — the rigor that protects the "350" narrative.
export type OutcomeType =
  | "precedent" | "procedural" | "remand" | "regulatory" | "settlement";
// Separates "the doctrine won" from "this Indigenous party won."
export type WinType = "doctrine_win" | "party_win" | "mixed" | "loss";

export interface CaseOutcome {
  outcomeType: OutcomeType;
  winType: WinType;
  whoWon: string;        // plain-language
  holding: string;       // 1–3 sentences, extractive
}

export interface EconomicDimension {
  valueType: "settlement" | "resource_revenue" | "equity" | "other";
  settlementAmount?: number;   // CAD
  resourceRevenue?: number;
  equityStake?: number;        // %
  economicSummary: string;     // extractive, citation-anchored
}

// The differentiator: did the win convert into economic outcome?
export interface ValueRealization {
  status: "declared" | "negotiating" | "realized" | "stalled" | "unknown";
  note: string;
  asOf: string;                // ISO
}

// Every summary claim links back to a source paragraph — NO free-form generation.
export interface CitationAnchor { text: string; sourceParagraph: string; sourceUrl: string; }
export interface CitationAnchored { claims: CitationAnchor[]; }

// Paragraph-level chunk — the unit for quote-grounding now and RAG later (§10).
export interface CaseChunk { paragraph: string; text: string; }

export type EnrichmentLevel = "index" | "deep";

export interface Provenance {
  source: "a2aj" | "official_court" | "summary_site" | "manual";
  sourceUrl: string;
  upstreamLicense: string;     // tracked per A2AJ discipline
  ingestedAt: string;          // ISO
  unofficial: boolean;         // show "unofficial reproduction" disclaimer if true
}

export interface LegalCase {
  id: string;
  citation: string;            // neutral citation, e.g. "2014 SCC 44"
  citation2?: string;          // parallel, e.g. "[2014] 2 SCR 257"
  styleOfCause: string;        // case name
  court: string;
  level: CourtLevel;
  year: number;
  jurisdiction: string;
  nations: string[];           // Indigenous parties
  themes: Theme[];
  outcome: CaseOutcome;
  economic?: EconomicDimension;        // deep only
  valueRealization?: ValueRealization; // deep only
  summary?: CitationAnchored;          // deep only — extractive
  chunks?: CaseChunk[];                // deep only — paragraph chunks (RAG-ready)
  // citation graph — comes free from A2AJ (cases_cited_en / cases_citing_en)
  casesCited: string[];
  casesCiting: string[];
  citingCount: number;
  enrichmentLevel: EnrichmentLevel;
  fullTextAvailable: boolean;
  provenance: Provenance;
  sensitivity?: string;        // governance flag (TK / sacred-site / community-identifying)
}
```

---

## 7. The interface — `CaseRepo`

```ts
export interface CaseFilter {
  themes?: Theme[]; level?: CourtLevel; winType?: WinType;
  nation?: string; yearFrom?: number; yearTo?: number;
}
export interface Facets {
  byTheme: Record<Theme, number>;
  byLevel: Record<CourtLevel, number>;
  byWinType: Record<WinType, number>;
  byNation: Record<string, number>;
}
export interface ActivationSummary {        // mirrors portal getIndexSummary
  totalCases: number;
  byTheme: Record<Theme, number>;
  economicValue: { settlement: number; resourceRevenue: number; equity: number };
  valueRealization: Record<ValueRealization["status"], number>;  // the funnel
  landmarkCases: { id: string; styleOfCause: string; citingCount: number }[]; // citation-graph authority
}
export interface CaseExportBundle { cases: LegalCase[]; asOf: string; }

export interface CaseRepo {
  // reads — call directly in a server component
  listCases(filter?: CaseFilter): Promise<LegalCase[]>;
  getCase(id: string): Promise<LegalCase | null>;
  searchCases(query: string, filter?: CaseFilter): Promise<LegalCase[]>;
  listFacets(filter?: CaseFilter): Promise<Facets>;
  getActivationSummary(): Promise<ActivationSummary>;
  getCitationGraph(id: string): Promise<{ cited: LegalCase[]; citing: LegalCase[] }>;
  // OCAP / data sovereignty — mirrors exportRecords
  exportCases(filter?: CaseFilter): Promise<CaseExportBundle>;
}
```

Rules of thumb (same as portal): reads `await` directly in server components; never import `repo.mock`/`repo.dynamo`/`dynamo/*`/`seed/*` — only `@/lib/cases`, `@/lib/cases/types`.

---

## 8. Single-table design (`LegalCases`) — Appendix A

Access-pattern-driven, same generic-key style as `DataPortal` (`PK`/`SK` + `GSI1`/`GSI2`, `et` discriminator).

| Access pattern | Index | Keys |
|---|---|---|
| AP1 get a case by id | main | `PK=CASE#<id>  SK=PROFILE` |
| AP2 list/browse cases by theme | GSI1 | `GSI1PK=THEME#<theme>  GSI1SK=YEAR#<year>#CASE#<id>` |
| AP3 list by outcome/win-type | GSI2 | `GSI2PK=WINTYPE#<winType>  GSI2SK=YEAR#<year>#CASE#<id>` |
| AP4 full-text search | (MVP) load + in-memory filter; (Phase 2) search index | — |
| AP5 facets / activation rollup | scan + aggregate at read (small corpus) | — |
| AP6 citation graph | resolve `casesCited`/`casesCiting` id list via AP1 | — |
| AP7 OCAP export | query by filter | — |

`et: "Case"`. Chunks stored either inline on the item (small) or as `SK=CHUNK#<paragraph>` sub-items if a case is large.

---

## 9. Data sourcing & ingestion (validated live)

### 9.1 Primary source — A2AJ (validated this session)
`https://api.a2aj.ca` — open (MIT), no key, 3 endpoints: `/search` (query, search_type `full_text|name`, dataset, date filters, size≤50, **no pagination, no total count**), `/fetch` (by citation, supports `start_char`/`end_char` chunking), `/coverage`.

**Validated facts:**
- ~**220k+ decisions**, updated to 2026-06. Coverage: SCC (10,885), FC (35,639), FCA (7,771), TCC (8,071), BC CA/SC, ON CA, NS (multiple), YK CA, + federal tribunals (CHRT, CIRB, CITT…).
- Per case we get: `citation_en`, `citation2_en`, `name_en`, `document_date_en`, `url_en` (official), `unofficial_text_en` (**full text**), `cases_cited_en` + `cases_citing_en` + `citing_cases_count` (**citation graph — free**), `upstream_license`.
- **Flagship landmark set 100% retrievable** — verified 11/11 (Calder 1973, Guerin 1984, Sparrow 1990, Delgamuukw 1997, Haida/Taku River 2004, Mikisew 2005, Tsilhqot'in 2014, Grassy Narrows/Daniels/Peel Watershed/Clyde River, Trans Mountain 2018 FCA 153). Old SCR citations resolve.

### 9.2 Provincial coverage gaps & the solution
A2AJ does **not** cover Alberta / Saskatchewan / Manitoba / Quebec courts, nor Ontario Superior Court (only ONCA). Verified: `2020 ABCA 163` (Fort McKay/Rigel) returns empty. Solution (bounded — only a few dozen gap cases in our target corpus):
- **MVP:** for flagship gap cases, ingest full text from **official court sites** (Alberta Courts, etc.) + seed the "which cases" list from curated **Indigenous-law summary sources** (USask Indigenous Law Centre / CNLR, Mandell Pinder, First Peoples Law, OKT).
- **CanLII = discovery/citator only, NOT bulk full text** — terms prohibit bulk/programmatic download (they sued Caseway AI; settled). Use metadata API (approved key) + "Note up" + CanLII Connects for finding/validation; humans may read it.
- **Graceful degradation:** anything without full text → still an **index-level** record (`enrichmentLevel: "index"`, `fullTextAvailable: false`) + link to official source. Appears in search/analytics; no chunk/RAG features until enriched.
- **Phase 2:** A2AJ-style scraper for gap provinces, optionally upstreamed to A2AJ.

### 9.3 Licensing & sovereignty (non-negotiable)
- Track `upstream_license` per record; many sources are **non-commercial** (Indigenomics is non-profit → likely OK, but verify per source). Show "unofficial reproduction" disclaimer + link to official `url_en` for authoritative use.
- Indexing public judgments is low-risk; **encoding the Indigenous legal orders argued within them is not** — flag `sensitivity` (TK / sacred-site / community-identifying); apply OCAP®/CARE; respect UNDRIP Act / FPIC. The retrieval index is a derived, **rebuildable/purgeable** projection — the canonical record + consent stays in DynamoDB.

---

## 10. Search architecture

**Principle (validated, §research 2):** in law, **pure vector search loses to BM25** because queries are full of exact tokens (case names, neutral citations like `2014 SCC 44`, statute/section refs, test names, nation names). The converged industry recipe: **Hybrid (BM25 + dense) → RRF fusion → paragraph-level rerank → metadata filter → quote-grounded output → citation-graph authority boost.**

- **MVP:** corpus is hundreds of cases (tens of thousands of paragraph chunks) → **exact brute-force / in-memory filtering is correct** (perfect recall, zero infra; ANN only pays off at ~500k–1M+ vectors). `searchCases` does keyword + metadata filtering over the loaded set, ranked by relevance + citation-graph authority.
- **Phase 2 (LLM/RAG):** add a retrieval index behind the same `CaseRepo` seam — **Amazon OpenSearch** (native BM25 + k-NN hybrid + RRF + Bedrock rerank) is the AWS-native fit; pgvector is the lean alternative. Embeddings: a strong **general** model (text-embedding-3-large / voyage-3-large / self-hosted bge-m3) — **not** LegalBERT-as-retriever. The index is a **derived projection** of DynamoDB (system of record), kept in sync via DynamoDB Streams.
- **Citation graph** (free from A2AJ) powers authority ranking — surface landmark precedents (Calder/Sparrow/Delgamuukw/Haida/Tsilhqot'in). This is a differentiator vs. generic search, and mirrors Lexis+ GraphRAG / citator-as-tool patterns.
- **Calibration target:** COLIEE (built on Federal Court of Canada case law) is the closest public benchmark; expect modest absolute scores — the win is recall + grounded citations.

---

## 11. Hallucination & governance controls

Highest-stakes area (Indigenous law is doctrinally sensitive; errors are costly). Validated empirics: even the best commercial legal RAG hallucinates ~17–33% (Stanford/Magesh 2025); legal LLMs hallucinate worst on lower-court material (which this corpus is full of); supplying source passages cut citation hallucination **71.5% → 6.4%** (CLERC).

Controls baked in from day one:
- **Extractive + citation-anchored only.** Every displayed claim links to a source paragraph (`CitationAnchored`). No free-form generation in the MVP.
- **Human-in-the-loop** for any future summarization; **never market "hallucination-free."**
- **OCAP export** (`exportCases`) + soft-delete + sensitivity flags mirror the portal's data-sovereignty layer.

---

## 12. Corpus strategy & sizing (validated)

A2AJ has no count endpoint and "Indigenous economic justice" is an editorial boundary, so the count is defined by **our** inclusion criteria, not a query. Triangulated estimate:

| Tier | Size | A2AJ availability |
|---|---|---|
| **Flagship deep-enrichment** | **~40–80** | ✅ 100% (11/11 landmarks verified) |
| Client "win-streak" denominator (Gallagher) | ~350 (his 2020 tally) | ⚠️ ~250–300 directly fetchable; AB/SK/MB/QC gap cases need §9.2 |
| SCC Aboriginal-law core | ~50–120 "about" (≈290–340 "mention") | ✅ |
| Full Indigenous-law universe (mention-level) | low thousands | partial — not the target |

**Decision:** target corpus = a few hundred Indigenous economic-justice **judgments**; flagship ~40–80 deep, rest index-level (the hybrid model). **Do not** treat Gallagher's list as the data spine — no canonical list exists, and most of his "wins" are non-judgments (regulatory outcomes, blockades, cancellations, IBAs, legislation). Use A2AJ + our own theme classification as the spine; use Gallagher / curated summary sites as discovery + validation. Non-judgment "milestones," if the client wants them, get a separate lightweight entity type — not the case table.

---

## 13. Ownership & coordination

- **Data group:** `src/lib/cases/*` (mock + dynamo), `dynamo/cases-table.ts`, ingestion scripts, seed corpus, `verify` checks.
- **Frontend group:** `src/app/cases/*`, building against `casesRepo` (mock from day one).
- **Shared file:** `src/lib/cases/types.ts` only — changes announced to both.
- Reuse (do not rebuild): `auth.ts`, `middleware.ts`, `components/ui.tsx`, `dynamo/client.ts`, the SST deploy, the OCAP-export convention.

---

## 14. Out of scope / Phase 2

LLM/RAG Q&A (Bedrock + quote-grounding); semantic/vector search + OpenSearch/pgvector index; automated full-corpus ingestion; provincial-gap scraper (AB/SK/MB/QC); citation-graph visualization; non-judgment "milestone" entity; user-editable cases; French/bilingual; real auth (reuse portal's).

---

## 15. Open questions / decisions log

- **[Decided]** Same-repo third domain (not separate app). Source = A2AJ. Stay on DynamoDB; retrieval is a future derived projection behind the seam. Positioning = activation-outward / rigor-inward. Corpus = hybrid (~40–80 deep + index breadth).
- **[Open]** Exact flagship case list (~40–80) — to be curated in the implementation plan from A2AJ landmarks + Gallagher references + USask CNLR / Mandell Pinder summaries.
- **[Open]** Theme-classification method for index-level breadth (rules vs. lightweight classifier over `unofficial_text_en`).
- **[Open]** Whether the client wants the non-judgment "milestone" entity in MVP or Phase 2.

---

## Appendix B — A2AJ field → `LegalCase` mapping

| A2AJ field | `LegalCase` field |
|---|---|
| `citation_en` | `citation` |
| `citation2_en` | `citation2` |
| `name_en` | `styleOfCause` |
| `dataset` | `court` / `level` (map: SCC→scc, FCA→fca, FC→fc, BCCA/ONCA→provincial_appeal, BCSC/NSSC→provincial_superior, CHRT/CIRB…→tribunal) |
| `document_date_en` | `year` |
| `url_en` | `provenance.sourceUrl` (official) |
| `unofficial_text_en` | `chunks` (split by paragraph) + `summary` source |
| `cases_cited_en` | `casesCited` |
| `cases_citing_en` | `casesCiting` |
| `citing_cases_count` | `citingCount` |
| `upstream_license` | `provenance.upstreamLicense` (+ set `unofficial: true`) |
