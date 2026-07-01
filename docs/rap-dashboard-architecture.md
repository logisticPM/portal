# RAP Index dashboard — data infrastructure & the exploratory read model

**Date:** 2026-07-01 · Written for the team + client (Indigenomics).

The client wants the RAP Index to be an **exploratory** surface — "a wealth of visualization options a user can explore": top-down drill-down, part-to-whole (a company's share of a sector's total), graph-like relationships between organizations / sectors / frameworks, and progress tracking. This doc explains the data-infrastructure decision behind that, why our current DynamoDB choice does **not** block it, and what we prototyped.

---

## TL;DR

- **Keep DynamoDB** as the **system of record** (writes, provenance, the submission/review workflow). It is good at that and it is already built.
- Do **not** ask DynamoDB to also be the analytics engine — it's an OLTP key-value store, not built for ad-hoc aggregation, arbitrary grouping, or relationship traversal.
- Add a **read model optimized for exploration**. This is the standard **CQRS** split (one store for writes, a different shape for reads).
- Because this dataset is and will stay **small** (see §2), the best read model is a **client-side analytical dataset**: materialize the whole corpus into one file, ship it to the browser, and do every pivot / drill-down / graph **in-memory, client-side**. Near-zero running cost, instant interactivity, and it keeps every heavier option open because the export is the shared foundation.
- We prototyped exactly this on the mock data — see §6 and `/rap/explore`.

---

## 1. Why DynamoDB fights open-ended exploration

DynamoDB is **OLTP**: you design keys/GSIs up front for *access patterns you already know*. Exploration is the opposite — the user picks dimensions **ad hoc** and expects the system to slice, sum, and relate on demand (**OLAP**). That mismatch is concrete:

| Exploration the client wants | Why DynamoDB resists it |
|---|---|
| "Total \$ by sector", "this company's share of the total" | No `SUM` / `GROUP BY` / `AVG`. Every aggregate is a scan + reduce in app code. |
| Slice by *any* dimension (sector × size-band × type × status) | That's a data **cube**; DynamoDB can't cut a cube. Each new slice needs a new GSI (or a full scan). The current `/rap` page already fans out 8 sector queries then reduces in JS — that pattern doesn't generalize. |
| Graph-like relationships (org ↔ framework ↔ pillar, shared partners) | No server-side joins/traversals. You denormalize or issue N queries. |
| Drill-down (sector → org → RAP → commitment) | Fine for a few *fixed* paths; painful for arbitrary ones. |

**Conclusion:** the fix is not "drop DynamoDB." It's "stop making one store do both jobs."

---

## 2. The fact that decides everything: this data is small

RAPs are documents, published one at a time. Even at full Canada + Australia scale you're looking at **hundreds to a few thousand organizations**, ~20–50 commitments each — **low hundreds of thousands of rows at most, accumulated over years.** That's tiny by analytics standards, and it means you do **not** need a heavyweight OLAP backend. The entire analytical surface fits in memory.

---

## 3. Options compared

DynamoDB stays the source of truth in **all** options. The choice is the read model.

| | **A · Client-side dataset** | **B · Server SQL mirror** (Aurora/Athena) | **C · OpenSearch** | **D · DynamoDB-only rollups** |
|---|---|---|---|---|
| Ad-hoc exploration | ★★★★ any pivot instantly | ★★★★ full SQL | ★★★ facets/filters | ★ only predefined slices |
| Graph relationships | ★★★ build in-browser | ★★ recursive CTEs / app code | ★ weak | ✗ |
| \$ aggregation / share-of-total | ★★★★ | ★★★★ | ★★★ | ★★ if precomputed |
| Interactivity | instant (sub-ms) | 10s ms (Aurora) / **seconds** (Athena) | fast | instant (canned) |
| Scaling ceiling | ~low millions of rows | very high | very high | very high |
| Always-on cost | ~\$0 (S3 + export) | Aurora floor; Athena per-query | cluster \$\$ | ~\$0 |
| Ops / maintenance | **lowest** (no server) | medium (a DB to run) | higher (a cluster) | low |
| Nonprofit-handoff fit | **best** | needs a data owner | needs OpenSearch skills | simple but limiting |
| Canada residency | trivial (S3 in `ca-central-1`) | fine | fine | fine |

### Per-option, honestly

- **A — Client-side analytical dataset (recommended).** Export the corpus to one file (Parquet/JSON in S3), load it into the page, slice in-browser with **DuckDB-Wasm** (real SQL) or **Arquero** (dataframe). *Pros:* richest exploration for the least infra; instant; adding a dimension = add a column to the export; ~\$0 running cost; nothing to patch/scale; graph derived from the same dataset; residency trivial. *Cons:* the whole dataset ships to the browser — **fine here because RAPs are public documents**, a no-go for private data; payload/memory grow with data (comfortable to ~low millions of rows, then graduate); no server-side access control on slices (moot for public data).
- **B — Server SQL mirror (Aurora/Athena).** *Pros:* real joins + `GROUP BY` server-side, scales far past the browser, can enforce row-level security. *Cons:* infra you pay to run and maintain 24/7 (Aurora has a cost floor even idle); Athena adds **seconds** of latency per query — wrong feel for click-to-explore; you're standing up a database for data that may never need one.
- **C — OpenSearch.** *Pros:* purpose-built for faceted, filter-heavy dashboards. *Cons:* an always-on cluster to run/secure; **weakest at graph** (a stated client interest); overkill at this scale.
- **D — DynamoDB-only rollups.** *Pros:* cheapest, extends the Streams Lambda we already have. *Cons:* you only see the cuts you predefined — contradicts "explore." Good as a **supplement** (instant headline cards), not the exploration engine.

---

## 4. Scaling trajectory

- **Today → ~10k commitments:** Option A is effortless (dataset is a few MB).
- **~100k commitments (all of CA + AU, several years):** Option A still fine (Parquet + DuckDB-Wasm handles this at a few MB compressed); D stays cheap; B/C are unnecessary weight.
- **Graduate off A when** any of: the corpus crosses ~**low millions of rows / a few hundred MB**; the data stops being **public** (needs row-level security); or many users need heavy **shared** compute. A RAP registry may realistically never hit these.

---

## 5. Long-term usability (the part clients underrate)

- **Adding dimensions cheaply.** The schema *will* grow (new sectors, new extracted fields, the "extras → real fields" loop). Option A absorbs this best — new column in the export, instantly pivotable. Option D is worst (new GSI / precompute each time).
- **Who maintains it.** A capstone team hands off to a nonprofit with no data engineers. "One S3 export + a static frontend" is far more survivable than "a cluster someone must keep alive, patch, and pay for." Operational simplicity *is* a usability feature here.
- **Client self-serve.** With A, "can we also see X by Y?" is often a frontend tweak, not a backend migration.

---

## 6. What we prototyped (Option A on mock data) — `/rap/explore`

A working, **zero-dependency** proof of the architecture, built on the existing mock corpus:

- **The materialized fact table.** The server (`src/app/rap/explore/page.tsx`) reads the corpus through the existing `rapRepo` and flattens it into one array of **facts** (`buildFacts` in `src/lib/rap/analytics.ts`) — one row per commitment, denormalized with its org, sector, size-band, pillar, type, claim-basis, status, %-complete, and a **unit-typed** target value (`$` / `%` / count). That array is shipped to the browser **once**. This *is* Option A's export, in miniature.
- **All slicing is client-side.** `ExploreClient.tsx` runs every aggregation in-browser on that array — no per-interaction backend call. Pick any **dimension** (sector, org, type, pillar, claim basis, status, size band, region) and any **measure** (commitment count, \$ committed, avg progress) and every view recomputes instantly.
- **The views** demonstrate the "wealth of options" the client asked for:
  - **Contribution / part-to-whole** — ranked bars with each item's **share of the total** (e.g., "Company X = 22% of committed \$").
  - **Mosaic (treemap)** — two categoricals at once: column **width** = primary share, row **height** = composition within — the top-down, part-to-whole relationship in one picture. Click a cell to **drill down** (it becomes a filter).
  - **Cross-tab heatmap** — any dimension × any dimension, colored by the measure.
  - **Relationship graph** — a bipartite network (e.g., organizations ↔ pillars) showing which orgs share focus areas; edge thickness = weight.
  - **Filter breadcrumb** — clicking any element pushes a filter, so exploration is genuinely top-down and reversible.

**Note on the prototype's engine.** It uses hand-rolled aggregation + SVG so it builds with zero new dependencies and proves the *architecture* (client-side compute from one dataset). In production, swap the hand-rolled aggregation for **Arquero/DuckDB-Wasm** and the SVG for a charting lib (**Recharts / visx / nivo**) — same data-flow, nicer ergonomics.

---

## 7. Two honest caveats

1. **The monetary data gap is an extraction problem, not a database one.** "\$ by sector / share of total" depends on the numeric target being reliably populated. Today dollars live inside the generic `targetValue: number` with a **mixed unit** (`$100M`, `1.5%`, `85 communities`) and extraction fills it **sparsely**. The prototype classifies units and only sums currency, but the real unlock is a normalization pass (parse magnitude + unit at extraction time). No infra choice fixes this — flag it to the client as its own workstream.
2. **Graph at this scale is a frontend concern, not a database choice.** Don't reach for a graph DB (Neptune). At low-hundreds-of-thousands of rows you build nodes/edges in memory from the flat dataset and render them. A graph DB only earns its keep with graph-native queries at scale we won't have.

---

## 8. Recommendation

**CQRS: DynamoDB (source of truth) → materialized export to S3 (`ca-central-1`) → client-side analytical dataset (Option A) for exploration, with Option D's rollups as cheap headline numbers.** Document the graduation path to Option B (SQL mirror) for the day data goes non-public or crosses ~millions of rows. This gives the client the full exploratory experience at near-zero running cost, is the most survivable for a nonprofit handoff, and keeps every heavier option open — because the export is the shared foundation they'd all need anyway.
