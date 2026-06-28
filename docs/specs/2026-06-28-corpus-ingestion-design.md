# Phase 2-A: A2AJ Corpus Ingestion & Theme Labeling — Design Spec

**Status:** Approved direction (pending spec review) · extends the `cases` domain
**Date:** 2026-06-28
**Audience:** The capstone team — data group (pipeline) + reviewers
**Purpose:** Turn the 4-fixture demo corpus into a real, methodologically-defensible corpus of Canadian Indigenous economic-justice cases ingested from A2AJ, with reproducible selection, dual-LLM theme labeling, human-validated accuracy, and a generated datasheet. Pure additive: the `CaseRepo` seam and pages are unchanged (only `types.ts` gains a few fields).

> **Grounded in:** `docs/research/2026-06-28-legal-corpus-construction-methodology.md` (how rigorous scholarship builds legal corpora) and `docs/research/2026-06-25-legal-search-state-of-the-art.md`. Read the methodology doc before reviewing — the design choices below cite it.

---

## 0. Why this design (the methodology in one paragraph)

Rigorous empirical legal work treats *which cases are in* as the most consequential, least-reproducible decision (Hall & Wright). Keyword retrieval alone has ~20% recall while feeling complete (Blair & Maron), so selection must be **hybrid + documented** (query-harvest + seed list + citation snowball, PRISMA-style counts). Topic labels need **chance-corrected agreement** and validation against a human gold standard (Landis–Koch κ≥0.61; Savelka & Ashley legal-LLM F1 0.82–0.90 *with a human in the loop*). And the corpus must declare its frame and limits in a **datasheet** (Gebru et al.). This spec operationalizes all three.

---

## 1. Scope

### 1.0 Two-tier corpus model (the core architectural decision)

We ingest in **two tiers**, both behind the `CaseRepo` seam, because "full text + RAG" and "curated + labeled" are complementary layers, not alternatives:

| Tier | What's in it | How built | Serves |
|---|---|---|---|
| **Substrate** (broad) | A wide slice of A2AJ **full text** (chunked) + citation-graph edges + basic metadata. Permissive inclusion. `themes` empty, `outcome.winType: "unclassified"`. | Broad harvest + dedup + `a2ajToCase` map + upsert. No labeling. | The **RAG/semantic-discovery substrate** (the vector index + Q&A land here in Phase 2-B/C). The searchable haystack. |
| **Core** (curated) | The structured, themed, validated subset for the product's analytic surfaces. | The substrate run through the **inclusion filter + dual-LLM labeling + validation** → promoted to core. | **Browse, facets, activation dashboard, citation graph** — everything that must be countable/themed. |

**Which surface reads which tier:** `/cases` browse + `/cases/activation` dashboard + facets read **core** (structured, honest counts). Semantic search / RAG Q&A (Phase 2-B/C) reads **substrate** (full text), and can surface a substrate case with a "not yet curated" flag + a path to promote it into core. A case is promoted substrate→core when it passes the inclusion filter and gets labeled.

This adopts the "ingest the full text, use RAG" intuition (the substrate) **and** keeps the structured, credible core the product and client need. The hard sourcing limits still apply to both tiers (§6): A2AJ doesn't scrape CanLII, so even the "broad" substrate is an A2AJ-bounded, federal-skewed slice — not all Canadian case law.

**Goal:** a reproducible pipeline that ingests a broad A2AJ **substrate** (full text + citation graph), promotes a **core** subset via inclusion filter + dual-LLM theme labeling, validates accuracy against a human gold sample, and emits a datasheet. Target this iteration: substrate ~1–3k decisions; core ~150–300 + the existing flagship deep subset.

**In scope:**
- **Selection** (hybrid): theme query-harvest (date-windowed) + curated seed citation list + forward citation snowball; PRISMA-style counts logged.
- **Dedup**: by neutral citation; near-dup guard; preserve multi-level judgments (trial/appeal/SCC are NOT dups).
- **Mapping**: reuse `a2ajToCase` (already built/tested) → index-level `LegalCase`; merge `enrichment.ts` for flagship.
- **Theme labeling**: dual-LLM cross-labeling (two model families) → multi-label `themes[]` + per-case label confidence; disagreements → review queue.
- **Validation harness**: given a human-double-coded gold file, compute per-theme precision/recall/F1, human inter-coder κ (+ prevalence/PABAK), and corpus-purity Wilson 95% CI.
- **Datasheet generator**: emit `docs/research/cases-datasheet.md` from a run (frame, A2AJ ceiling, queries, PRISMA counts, dedup stats, label stats, validation metrics).
- **Idempotent upsert** into DynamoDB `LegalCases` (by `CASE#id`), with raw-response disk cache + polite rate-limiting.
- Small **schema additions** (§4).

**Out of scope (this iteration):**
- The actual human labeling of the gold sample (~1 annotator-week — team/client provides the hand-labeled file; we build the harness that consumes it).
- Provincial-gap coverage beyond what seed/snowball reach (that is Phase 2-D; A2AJ doesn't scrape CanLII — see §6).
- Semantic/vector search, RAG (Phase 2-B/C).
- A full production run at maximum scale (we target ~150–300 to prove the pipeline; scaling is a config change).

**Definition of done:** `npm run cases:ingest` (against A2AJ, cached) produces a real corpus in DynamoDB Local; `npm run verify` stays green (dynamo≡mock + new pipeline unit checks); a datasheet is generated; the validation harness runs against a sample gold file and reports P/R/F1 + κ + Wilson CI; offline unit tests cover every pure stage.

---

## 2. Pipeline architecture (stages)

```
sources.ts (queries + seed list)
      │
      ▼
[1 HARVEST] date-windowed A2AJ /search per theme query  ─┐
[1 SEED]    /fetch each curated seed citation            ─┼─► candidates[]
[1 SNOWBALL] forward-expand via cases_citing_en (depth 1)─┘
      │  (raw responses cached to disk: scripts/.cache/a2aj/<slug>.json)
      ▼
[2 DEDUP]   by citation; keep distinct judgments (no multi-level collapse)
      │
      ▼
[3 MAP]     a2ajToCase() → LegalCase (corpusTier:"substrate", themes:[], winType:"unclassified")
      │
      ▼
[4 UPSERT-SUBSTRATE] idempotent PutCommand by CASE#id  ──►  the RAG/discovery haystack
      │
      ▼
[5 INCLUDE] transparent inclusion filter (documented rule) → promote | leave-in-substrate(reason)
      │     (PRISMA counts emitted at every gate)
      ▼
[6 LABEL]   dual-LLM cross-labeling → themes[] + labelMeta (confidence, agreement, models)
      │     agree → high conf; disagree → low conf + review queue
      ▼
[7 PROMOTE] merge enrichment.ts for flagship; set corpusTier:"core"; upsert
      │
      ├──► [V] validation harness (gold file → P/R/F1, κ, Wilson CI)
      └──► [D] datasheet generator (frame, ceiling, PRISMA, dedup, label, validation)
```

Stages 2, 5, 6 (dedup, include-filter, label-merge) and the §6 metric functions are **pure functions** unit-tested offline with recorded fixtures. Stage 1 (live fetch) and stage 6's LLM calls are isolated behind thin clients exercised by the live `cases:ingest` script, not by tests. **Substrate lands first (steps 1–4), so a real searchable corpus exists before any labeling** — the curated core (5–7) is promoted on top.

---

## 3. Selection design (hybrid, PRISMA-documented)

`src/lib/cases/ingest/sources.ts`:
- **Theme queries** — per `Theme`, the A2AJ `/search` full-text queries (e.g., `land_rights`→`["aboriginal title"]`, `duty_to_consult`→`["duty to consult"]`, `treaty`→`["treaty rights","treaty annuity"]`, `fiduciary`→`["fiduciary duty"]`, `resource_revenue`→`["revenue sharing","resource revenue"]`, `self_determination`→`["self-government","self-determination"]`).
- **Seed citation list** — the flagship landmarks + known important cases (from existing curated collections used as *seed material, not a frame*).
- **Manual gap citations** — provincial-court cases we add by citation (A2AJ may lack them; mark `fullTextAvailable:false` if `/fetch` misses).

**Harvest mechanics:** A2AJ `/search` has size≤50 and no offset, so paginate by **date windows** (`start_date`/`end_date`) across the full range per query, `size=50`, dedupe. **Snowball:** depth-1 forward expansion via each kept case's `cases_citing_en`. Cache every raw response to `scripts/.cache/a2aj/`.

**Inclusion filter (transparent, documented):** a candidate is *included* only if its `unofficial_text_en` matches the economic-justice signal (Indigenous-party + economic-theme keyword co-occurrence, threshold documented in code). Every exclusion is logged with a reason → PRISMA counts (`identified → deduped → screened → excluded[reason] → included`).

**Declared frame & ceiling (goes in datasheet):** the population frame is *A2AJ*, which **does not scrape CanLII** and is **federal-court-skewed**; this corpus is a slice of A2AJ, **not** all Canadian Indigenous economic-justice case law (much provincial litigation is absent). Live `/coverage` currently sums to ~220k decisions (growing; the Sept-2025 paper reported 116,734, the site "191,000+").

---

## 4. Schema additions (`src/lib/cases/types.ts`)

Minimal, additive — keeps existing records valid:
- `LegalCase` gains `corpusTier: "substrate" | "core"` — **substrate** = broad full-text haystack (RAG/discovery, unlabeled); **core** = curated/labeled/structured (browse + analytics). The 4 existing fixtures are `"core"`. `CaseRepo.listCases`/`listFacets`/`getActivationSummary` default to **core only** (so counts/facets stay honest); `searchCases` may opt into substrate via a flag (the seam for Phase 2-B RAG). Add a `tier?` field to `CaseFilter`.
- `WinType` gains `"unclassified"` — substrate (and any un-reviewed) records use this. We do **not** fake an outcome from raw text. `OutcomeType` gains `"unclassified"` likewise; `CaseOutcome.whoWon`/`holding` may be `""` for unclassified.
- `LegalCase` gains optional `labelMeta?: ThemeLabelMeta`:
  ```ts
  export interface ThemeLabelMeta {
    method: "curated" | "dual_llm";
    models?: string[];            // e.g. ["claude-...", "<other-family>"]
    agreement?: "full" | "partial" | "none";
    confidence: "high" | "low";   // high = curated or full LLM agreement
    needsReview: boolean;         // true when models disagreed
  }
  ```
- `query.ts` `buildFacets`/`buildActivation` already key off `outcome.winType` and `themes`; `"unclassified"` flows through honestly (the dashboard shows a real "unclassified" count rather than faking wins). Add `"unclassified"` to the dashboard's win-type display.

These changes are picked up by `itemToCase` (the maintainer comment already warns to add new fields there) and the round-trip test.

## 5. Dual-LLM theme labeling

`src/lib/cases/ingest/labeler.ts`:
- A fixed **rubric**: each `Theme` defined with a one-line inclusion test + signal phrases (the rubric text is committed, versioned — it IS the methodology).
- Two **different model families** label independently (low temperature, **multi-label**, output = subset of the 6 `Theme`s + abstain). Model identifiers recorded in `labelMeta.models`.
- **Merge rule:** intersection = high-confidence labels (`agreement:"full"|"partial"`, `confidence:"high"`); symmetric difference = low-confidence (`needsReview:true`). A case with no agreed theme stays `themes: []` + `needsReview:true`.
- Report **inter-LLM Cohen's κ** as a *consistency* metric in the datasheet — explicitly labeled "consistency, not accuracy."
- LLM calls go through one thin client (`ingest/llm.ts`) — provider-agnostic; default two families via the project's available APIs (e.g., Bedrock Claude + one non-Anthropic family). Calls cached by content hash so re-runs are free and the labeler is offline-testable with recorded fixtures.

> **Boundary (non-negotiable):** the LLM labels *metadata only*. It NEVER generates displayed legal content — case summaries remain extractive + citation-anchored (Phase 1 §11). LLM agreement ≠ accuracy; §V is what establishes accuracy.

## 6. Validation harness (`scripts/cases-validate.ts`)

Consumes a human-double-coded gold file `docs/research/gold/cases-gold.jsonl` (provided by the team; format: `{citation, includedTrue, themesCoderA[], themesCoderB[]}`), and computes:
- **Selection accuracy:** precision/recall/F1 of the include-filter vs the gold `includedTrue` — **gold must be drawn from the population** (not just included items) so recall is measurable.
- **Labeling accuracy:** per-theme precision/recall/F1 of the dual-LLM labels vs the human consensus; report **macro-F1**.
- **Inter-coder reliability:** Cohen's κ between coder A and B, **plus prevalence + PABAK** (theme labels are imbalanced → guards the kappa paradox). Floor target κ≥0.61.
- **Corpus purity:** off-topic rate over a uniform random sample (n target ≈ 384 for ±5%, or the gold sample if smaller — report the actual n) with a **Wilson 95% CI**.

Pure metric functions (`src/lib/cases/validate/metrics.ts`: `prf1`, `cohenKappa`, `pabak`, `wilsonInterval`) are unit-tested with known inputs (e.g., textbook κ examples). If no gold file is present, the harness prints "no gold sample — accuracy unvalidated (exploratory corpus)" and exits 0 (honest degradation).

## 7. Datasheet generator (`scripts/cases-datasheet.ts`)

Emits `docs/research/cases-datasheet.md` following Datasheets-for-Datasets sections: Motivation; Composition (counts by court/theme/enrichmentLevel/confidence); Collection (queries, seed list, snowball depth, date window, **PRISMA counts**, A2AJ frame + CanLII/federal-skew ceiling, "unofficial automated copies" caveat); Preprocessing/Labeling (dedup method, rubric version, dual-LLM models, inter-LLM κ); Validation (gold-sample P/R/F1 + κ/PABAK + Wilson CI, or "unvalidated"); Uses/Limitations/Distribution/Maintenance.

## 8. Mechanics, testing, config

- **Idempotency:** upsert by `CASE#id` (`slugCitation`); re-runs update, never duplicate. Re-labeling only overwrites `dual_llm` cases, never `curated`.
- **Politeness:** rate-limit A2AJ fetches; disk cache keyed by citation/query so re-runs hit cache.
- **Testing (repo idiom — tsx assertion scripts):** unit tests for dedup, include-filter, label-merge, and each metric function (recorded fixtures, no network/LLM). `verify.ts` gains a check that an ingested record round-trips and that `unclassified` win-type flows through facets. Live `cases:ingest` is manual.
- **Config/keys:** LLM provider + the two model ids in env (server-side only, never `NEXT_PUBLIC_`); document in `.env.local.example`.
- **npm scripts:** `cases:ingest` (live harvest→label→upsert, Local + `:cloud`), `cases:validate`, `cases:datasheet`.
- **Contract-first preserved:** pages/`CaseRepo` unchanged; ingestion is data-layer-only.

## 9. Internal phasing (for the implementation plan)

1. **A.1 Substrate** — broad harvest + dedup + map + upsert (`corpusTier:"substrate"`, full text + citation graph, no labels). A **real searchable corpus lands first**; `searchCases` can already hit it. Schema additions (`corpusTier`, `unclassified`, `CaseFilter.tier`) ship here; `listCases`/facets/activation stay core-only so the dashboard is unaffected.
2. **A.2 Core promotion** — inclusion filter + dual-LLM labeling → promote substrate→core with `themes` + `labelMeta` + review queue.
3. **A.3 Validation + datasheet** — gold-sample harness (P/R/F1, κ/PABAK, Wilson CI) + generated datasheet.

Each sub-phase is independently testable and leaves the app working. (The vector index + RAG serving over the substrate is **Phase 2-B**, not 2-A — 2-A just lands the substrate data.)

## 10. Open questions
- **[Open]** Exact second model family (depends on which APIs the team provisions — Bedrock-hosted non-Anthropic, or OpenAI/Gemini). Default: whatever is reachable; recorded in `labelMeta.models`.
- **[Open]** Gold-sample size the team will actually hand-label (ideal ≈384; a smaller pilot, e.g. 100, is acceptable if reported with wider CI).
- **[Open]** Whether to ship the non-judgment "milestone" entity (deferred from Phase 1) — not in this spec.
