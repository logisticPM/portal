# Datasheet — Indigenomics Economic Justice Legal Cases Corpus

_Generated 2026-07-07 · rubric 2026-07-06.1_

## Motivation
Indigenous economic-justice case law made searchable + analytically actionable (Focus Area 2).

## Composition
- Core (curated, labeled): **452** · Substrate (full-text, RAG): **4597**
- By theme (core): {"land_rights":286,"duty_to_consult":227,"fiduciary":76,"resource_revenue":33,"treaty":140,"self_determination":47}
- Core cases flagged needs-review (LLM disagreement): **319**

## Collection process
- Frame: **A2AJ** (api.a2aj.ca). Theme queries: {"land_rights":["aboriginal title","land claim"],"resource_revenue":["revenue sharing","resource revenue","impact benefit agreement","resource royalties","equity stake","equitable compensation","expropriation compensation","economic loss"],"duty_to_consult":["duty to consult","honour of the crown"],"treaty":["treaty rights","treaty annuity"],"fiduciary":["fiduciary duty"],"self_determination":["self-government","self-determination"]}. Seeds: 14. Window: 1970-01-01–2026-12-31. Forward-citation snowball intentionally omitted (preferential-attachment explosion).
- Substrate note: search-harvested records are metadata + snippet (A2AJ `/search` does not return full text); full text is fetched only for seeds/promotion. Full-text RAG indexing requires a per-case `/fetch` pass (Phase 2-B).
- PRISMA counts: {}

## ⚠️ Coverage ceiling (limitations)
A2AJ **does not scrape CanLII** and is **federal-court-skewed**; this corpus is an A2AJ-bounded slice, **not** all Canadian Indigenous economic-justice case law. Much provincial-court litigation is absent. Texts are unofficial automated copies.

## Labeling
- Themes: dual-LLM cross-labeling (only agreed labels kept; disagreements → needs-review). Inter-LLM agreement = consistency, not accuracy.
- Outcomes: only curated/flagship cases carry a real winType; others are "unclassified" (never auto-faked).

## Validation
Run `npm run cases:validate` against a human gold sample for per-theme P/R/F1, inter-coder kappa/PABAK, and corpus-purity Wilson CI. Absent a gold file, the corpus is **exploratory / unvalidated**.

## Uses / Distribution / Maintenance
Internal demo + analytics. Respect each record's `upstreamLicense` (many non-commercial). Re-run `cases:ingest` to refresh (idempotent).
