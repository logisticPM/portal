# Alignment Engine — design spec

**Date:** 2026-07-08 · **Type:** Feature design (AI automation) · **Status:** Design approved — pending implementation plan

> AI automation that connects **RAP commitment data** to the portal's **Indigenous-supplier relationship data**, and flags **alignment opportunities** in near-real-time. One engine, two audiences: **companies** see suppliers that fit each of their RAP commitments (approach A); **Indigenomics** (the institute) sees a global matchmaking radar of the highest-value opportunities to broker (approach C).

---

## 1. Goal & scope

When a company's RAP data changes (a procurement commitment is published/updated) or the supplier pool changes (a supplier is added/verified), automatically detect and score matches between **company procurement commitments** and **verified Indigenous suppliers**, and surface them:

- **A — Company view:** on the commitment page, a per-commitment panel "Indigenous suppliers that fit this commitment" (ranked, with an AI rationale).
- **C — Institute radar:** a new `/alignment` page (Indigenomics-only) ranking the highest-value opportunities across all companies/suppliers, with a "brokered" affordance.

Both read the **same** scored `Opportunity` records produced by one shared **Alignment Engine**.

**In scope (MVP):**
- Supplier sector/region normalization to RAP enums.
- The Alignment Engine: hard filters → structured score → semantic (embedding) score → threshold/Top-N → AI rationale.
- `Opportunity` entity + repo (mock + dynamo).
- Real-time (near-) recompute via DynamoDB Streams (commitment or supplier change → async Lambda).
- The two read surfaces (company panel + institute radar).
- Deterministic tests via the `tsx` verify harness; seed ~5 real Indigenous suppliers.

**Out of scope (future work, §10):**
- **Push/notification (approach B)** — proactive alerts to a company/supplier when a partner posts a new project. The engine + `Opportunity` records are the substrate; a notification layer sits on top later.
- Capital/equity commitments (procurement only for MVP).
- A feedback/learning loop (opportunity → actual `ReportedLine`).

---

## 2. Decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Approach | **A + C hybrid** (one engine, two views) | Company match is most demo-visible; institute radar fits the feature's "Indigenomics" actor; both reuse one engine |
| Match domain | **Procurement commitments ↔ verified suppliers** only | The confirmable RAP core; capital deferred |
| AI role | normalize · semantic match · generate rationale | Reuse existing Bedrock embeddings + Converse + cache — no new model infra |
| Real-time | DynamoDB Streams → async Lambda (fire-and-forget) | Same pattern as `RapExtract` / `rap-rollup`; matching is seconds-long, off the request path |
| Notifications (B) | **Deferred** | Ship the engine + views first; push is a layer on top |
| Relationship DB | **The portal's own data** (suppliers + reported lines) + ~5 seeded real suppliers | No external CRM; data already exists, enrich + seed |

---

## 3. Data model

> **Which commitments does the engine match?** The MVP's live commitment data is the **Commitments module** (`src/lib/commitments/*`, the `Commitments` table) — the ~115 rows / 103 orgs behind `/my-commitments` and `/organizations` (the `RapData` table is empty in prod). So the engine matches **Commitments-module commitments** and normalizes suppliers to **that module's `Sector` enum** (`finance | mining | energy | consulting | retail | health | government | education | transport | telecom | forestry | construction | aerospace | agriculture`), not the separate `rap/types` RAP enum.

### 3a. Supplier normalization (extend existing `Supplier`)
`Supplier` today has freeform `sector` / `region` strings (`src/lib/repo/types.ts`). Add:
- `sectorNorm?: Sector` — mapped to the Commitments-module `Sector` enum (above).
- `regionNorm?: string` — a normalized province/region code (e.g. `AB`, `BC`, `ON`).

Populated by an **LLM classifier** (`alignment/normalize.ts`) on supplier profile save, plus a one-time backfill pass over existing suppliers. Result is cached by input hash.

### 3b. New `Opportunity` entity
A scored match between one commitment and one supplier.

```ts
interface Opportunity {
  id: string;                 // `${commitmentId}::${supplierId}` (deterministic, idempotent)
  commitmentId: string;
  orgId: string;              // the committing company (drives the company-view read)
  supplierId: string;
  score: number;              // 0..1 combined
  reasons: {                  // structured, explainable
    sectorMatch: boolean;
    regionMatch: boolean;
    identityTier: IdentityTier;
    semantic: number;         // 0..1 cosine
  };
  rationale?: string;         // AI one-liner: why it fits + suggested next step (optional; regenerable)
  status: "new" | "seen" | "acted" | "dismissed";
  provenance: { commitmentQuote?: string; supplierFields: string[] };
  createdAt: string;          // ISO
}
```

**Single-table keys (DataPortal or a dedicated table — see §7):** two access patterns:
- **AP-company:** a company's opportunities → `PK=OPPORTUNITY#<orgId>`, `SK=SCORE#<zero-padded-score>#<supplierId>#<commitmentId>` (ranked within a company).
- **AP-institute (global, ranked):** GSI `GSI1PK=OPPORTUNITY`, `GSI1SK=SCORE#<zero-padded-score>#...` — a single-partition ranked scan for the radar (acceptable at demo scale; documented cap).

---

## 4. Matching engine (`alignment/`)

Given one Commitments-module commitment (`sector`, `type`, `title`/`detail`/`targetText` text, `targetYear`) against the verified-supplier pool:

1. **Hard filters** — `commitment.type === "procurement"`; supplier is verified (`identityTier ∈ {nation, ccab}` or has an active verification).
2. **Structured score** (`alignment/score.ts`, pure) — weighted sum of: `sectorMatch` (commitment.sector === supplier.sectorNorm), `regionMatch` (=== regionNorm), identity-tier weight, ownership%. Deterministic, unit-tested.
3. **Semantic score** — embed `commitment.action + deliverable` and `supplier.blurb + name` (reuse the legal-cases embedder: Bedrock Titan v2, with the existing **stub-hash embedder** as the offline/dev + test fallback); cosine similarity. Catches cross-sector fits ("IT modernization" ↔ "Thunderbird IT Services").
4. **Combine + cut** — `score = w1·structured + w2·semantic`; keep `score ≥ THRESHOLD` (default **0.6**); take **Top-N** per commitment (default **5**). Constants are tunable in one place.
5. **Rationale** — for each kept match, Bedrock **Converse** generates a one-sentence "why it fits + suggested next step", grounded (cite the commitment quote + supplier facts; no invented facts). Cached by `(commitmentId, supplierId)` content hash (reuse the cases cache layer).

**AI summary:** (1) supplier normalization, (2) semantic matching, (3) rationale generation — all via existing wrappers.

---

## 5. Real-time triggering (`functions/alignment.ts`)

Reuse the DynamoDB Streams pattern already used by `functions/rap-rollup.ts`:
- **Commitment created/updated** → recompute opportunities for that commitment vs. the supplier pool → upsert `Opportunity` rows.
- **Supplier created/verified/updated** → recompute opportunities for that supplier vs. open procurement commitments.
- Async **fire-and-forget** (matching + embeddings + LLM rationale take seconds — same rationale as `RapExtract` running outside the request path).
- **Idempotent** upserts keyed by `id = commitmentId::supplierId`; a batch that touches the same pair once → one write. Stale opportunities (score now below threshold) are pruned/marked.
- **Initial backfill:** a one-off script computes opportunities over all *existing* commitments/suppliers (the seeded 103 orgs) so the views aren't empty on day one; Streams handles everything new/updated thereafter. (Enabling a stream on the `Commitments` table is an `sst.config.ts` add — §7.)

---

## 6. Surfacing (the A + C read surfaces)

- **A — Company panel:** on the commitment page (`/my-commitments`), a per-commitment section listing that commitment's opportunities (score badge + AI rationale + link to the supplier's `/s/<id>` showcase). Read: opportunities where `orgId === session.partyId`. Company-only route (session-gated, consistent with the auth model).
- **C — Institute radar:** a new `/alignment` page under `INDIGENOMICS_ONLY` (session-gated via `getSession().kind === "indigenomics"`). A ranked feed of the highest-value opportunities (score × commitment target value), filterable by sector/region, each with the two parties, the rationale, and a **"mark brokered"** action (sets `status = acted`).

---

## 7. Components & files (isolation)

Each unit has one responsibility and a clear interface:

| Unit | Responsibility |
|---|---|
| `src/lib/alignment/score.ts` | Pure structured+combined scoring (no I/O) — unit-tested |
| `src/lib/alignment/normalize.ts` | Supplier freeform sector/region → RAP enum (LLM + cache) |
| `src/lib/alignment/engine.ts` | Orchestrate: fetch pool → score → semantic → rationale → upsert `Opportunity` |
| `src/lib/alignment/types.ts` | `Opportunity` + interfaces |
| `src/lib/repo` (or a dedicated `alignment` repo) | `Opportunity` persistence (mock + dynamo), behind the seam |
| `src/functions/alignment.ts` | DynamoDB Streams-triggered recompute Lambda |
| `src/app/(company)/…` commitment panel | Company read surface (approach A) |
| `src/app/alignment/page.tsx` | Institute radar (approach C, `INDIGENOMICS_ONLY`) |
| `sst.config.ts` | Stream → alignment Lambda; Titan embed perms (already present for cases) |

**Table decision:** opportunities can live in the existing `Commitments`/`RapData` single-table (they key off commitments) **or** a small dedicated `Alignment` table. Recommend a **dedicated `Alignment` table** so the Streams trigger and access patterns stay isolated from the commitments hot path. (Finalize in the plan.)

---

## 8. Error handling

- Matching is **best-effort + async** — never blocks a user path.
- LLM **rationale failure** → still store the `Opportunity` with its structured+semantic score; `rationale` is optional and regenerable later.
- **Embeddings unavailable** (dev/offline/rate-limited) → fall back to structured-only score (the stub-hash embedder already exists for exactly this).
- **Idempotent + cached** → retries are cheap and safe.
- Stale/duplicate: keyed by `commitmentId::supplierId`; re-runs overwrite, sub-threshold matches are pruned.

---

## 9. Testing

- **Scoring unit tests** (`tsx` verify harness): commitment+supplier fixtures → expected score + ranking; deterministic via the **stub embedder**.
- **Opportunity repo parity:** mock ≡ dynamo via the existing `verify` harness pattern.
- **Scenario test:** a seeded procurement commitment (e.g. energy/AB) + a matching seeded supplier → the engine produces the expected `Opportunity` (score ≥ threshold, correct reasons).
- **Normalization:** freeform sector strings → expected enum (stubbed classifier for determinism).

---

## 10. Future work (documented, not built)

- **Approach B — proactive push/notifications:** when a partner/company publishes a new commitment, alert the connected party (needs a relationship-edge model + a notification/inbox surface). The `Opportunity` records are the substrate.
- **Capital/equity commitments** in matching.
- **Feedback loop:** track opportunity → actual `ReportedLine` to tune weights.
- **External CRM integration** if Indigenomics later exposes a real partner database.

---

## 11. Data prerequisites

- **Normalize existing suppliers** (`sectorNorm`/`regionNorm`) via a one-time LLM backfill + on-save.
- **Seed ~5 real Indigenous suppliers** with accurate sector/region/verification so matches are credible for the demo (per the team's plan).
