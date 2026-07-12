# Design — P0 domain reconciliation: link company accounts to seeded RAP data (BN crosswalk)

**Owner:** Nate (En-Ping) · **Prepared:** 2026-07-11 · CS7980 capstone · **Status:** proposed
**Repo:** `logisticPM/portal` · **Priority:** P0 (from `docs/2026-07-14-action-items-eval.md`, Finding A)

## 1. Context & problem

We seeded ~115 public commitments across ~103 organizations into the **commitments domain**
(`src/lib/commitments`, `Commitments` table). This powers the public RAP Index (`/commitments`).
Separately, the **BN-identity + progress feature** (spec `2026-07-10-rap-bn-identity-and-progress`)
lives entirely in the **RAP-extraction domain** (`src/lib/rap`, `RapData` table). The two are
**disjoint**, with no shared identity:

- Seeded commitments are grouped by **name slug** — `slugifyOrg(orgName)` → `"cenovus-energy"`
  (`src/lib/commitments/orgs.ts:20`). Of 117 fixture rows, only 9 carry an `orgId` (the 3 demo
  companies); the ~108 real public rows have **no `orgId` and no `businessNumber`**
  (`src/lib/commitments/types.ts:24-44` has no BN field).
- The claim/progress feature keys on **BN** — a company claims a Business Number, gets a granted
  `OrgClaim`, and posts progress against `RapData` commitments whose `orgId = org-bn-<bn9>`
  (`src/lib/rap/actions-core.ts:70-131`).
- **No crosswalk exists.** `"cenovus-energy"` and `"org-bn-123456789"` never reconcile.

**Consequences.**
1. A company that signs up and claims its BN **cannot see, claim, or update its own seeded
   public commitments**. To contribute anything it must re-upload its RAP and be re-extracted into a
   *parallel* `RapData` identity — duplicating itself and still not touching the public board.
2. **Misleading UX:** `uploadRapAction`/`confirmExtractionAction` call `revalidatePath("/commitments")`
   and `/my-rap` copy claims uploads appear "in the public RAP Index" (`src/app/my-rap/page.tsx:220-222`).
   `/commitments` never reads `RapData`, so the claim is false.

This design links the two domains on the **Business Number** (the identity axis we already committed
to) via an additive **crosswalk**, so one claim resolves to *both* a company's seeded commitments and
its uploaded RAPs — without a risky big-bang migration of either table.

## 2. Goals / non-goals

**Goals (v1)**
- **BN as the shared key across both domains.** Add `businessNumber` to the commitments domain and a
  BN-keyed crosswalk so a granted `OrgClaim` resolves to a company's seeded commitments *and* its
  `RapData` orgs.
- **A claimed company can update progress on its seeded public commitments** (status/progress only —
  never the committed substance or the public source), reusing the existing `OrgClaim` authz.
- **One honest ownership model** across both domains: claim-by-verified-BN, same as the RAP side.
- **Fix the misleading UX** (uploads no longer falsely advertised as hitting the public Index; or, if
  we choose to surface them, they genuinely appear).
- **Ship the backfill WITH the code** (the ccib-incident lesson: a populated prod table needs its data
  migration in the same PR).

**Non-goals (deferred)**
- **Fuzzy name→BN auto-mapping** for the seed backfill. BN assignment to seeded orgs is **curated and
  confidence-gated** (see §7); ambiguous orgs stay `businessNumber: null` and display-only. This
  preserves the "three Enbridges" principle — a name is never silently promoted to a legal identity.
- **Merging the two tables into one domain** (Option B in the eval). Rejected for v1 as high-risk; the
  crosswalk gets the user value incrementally and keeps a clean path to unify later.
- **The "confirmed" metric** (eval Finding B) — separate P1 workstream.
- **Canadian residency / consent layer** (eval Finding C) — separate P1 workstream.
- **Cross-version RAP reconciliation** — unchanged from the prior spec; a new annual RAP is a new doc.

## 3. Design principles

1. **BN is the one shared identity.** Both domains already want it; the crosswalk just makes the
   commitments domain carry it too. Name slugs remain a *display* grouping, never identity.
2. **Additive, not destructive.** No table is migrated into another. We add a nullable BN column +
   a crosswalk read; existing reads keep working with `businessNumber` absent.
3. **Reuse the existing authz, don't fork it.** A company edits a seeded commitment under the *same*
   `OrgClaim`-on-verified-BN gate that already guards RAP progress. One mechanism, two surfaces.
4. **Provenance survives company edits.** Editing progress on a public-sourced commitment never drops
   its `source`; each progress point records *who* authored it (public research vs the company).
5. **Confidence-gated identity.** A seeded org gets a BN only when the legal entity is unambiguous;
   otherwise it stays unclaimed and display-only. Never guess an entity to make the link.

## 4. Identity model & the crosswalk

Today's identity forms (unchanged, for reference):

| Context | Key form | Source |
|---|---|---|
| Seeded public commitment | name slug `cenovus-energy` (no stored id) | `orgs.ts:20` |
| Company self-created commitment | `orgId = session.partyId` (`c-northway`) | `actions.ts:31,58` |
| RAP org, BN-verified | `org-bn-<bn9>` | `stage-extraction.ts:39` |
| `OrgClaim` | `(bn9, partyId)` | `types.ts:267` |

**The change:** introduce **BN (`bn9`) as the crosswalk key** and stamp it on both domains.

```
                    OrgClaim(bn9, partyId, status=granted)
                                   │  (company proves it owns bn9)
              ┌────────────────────┴─────────────────────┐
              ▼                                           ▼
   Commitments where businessNumber == bn9      RapData org  org-bn-<bn9>
   (seeded public + company-created)            (uploaded → extracted RAPs)
              └──────────────── one company view ─────────┘
```

A claimed company resolves to **everything keyed on its BN** in either table. Seeded rows we can
confidently attribute get a `businessNumber`; the rest stay display-only until curated or claimed.

## 5. Data-model changes

**5.1 `Commitment` gains a nullable BN + progress authorship** (`src/lib/commitments/types.ts`)
```ts
export interface Commitment {
  // ...existing...
  businessNumber?: string; // 9-digit BN root; the crosswalk key. Absent ⇒ not yet attributed.
}
export interface ProgressPoint {
  period: string;
  status: CommitmentStatus;
  progressPct: number;
  authoredBy?: string; // partyId of the claiming company, or "public-research" for seeded points
}
```
`CommitmentFilter` gains `businessNumber?: string` so reads can filter by BN. `CommitmentPatch` is
unchanged (still `status | progressPct | history`; company edits never touch `title`/`targetYear`).

**5.2 Shared identity seam** (new `src/lib/identity/`) — resolves the "two domains must not import each
other" boundary cleanly by extracting the shared concern *upward* rather than sideways.
- Move the `OrgClaim` type + claim reads (`getClaim`, `listClaimsByParty`) behind a narrow
  `ClaimReader` interface both domains depend on. (Storage stays in the RAP repo for v1; only the
  read interface is shared — a full move of the claim store is a later refactor.)
- Add `resolveOrgForParty(partyId): Promise<{ bns: string[] }>` — a company's granted BNs.
- Add `crosswalk` read: `listCommitmentsForBNs(bns)` + `listRapsForBNs(bns)` composed for the unified
  view (each stays within its own repo; the identity module just fans out by BN).

**5.3 Curated BN map** (new data file `src/lib/commitments/org-bn-map.ts`) — `{ [orgNameSlug]: bn9 }`
for the seeded orgs we can attribute with confidence, sourced from Corporations Canada. Consumed by
the backfill (§7). Ambiguous/unfound orgs are simply absent (→ `businessNumber` stays undefined).

## 6. Authorization change (the core behavioral change)

`updateCommitmentAction` (`src/lib/commitments/actions.ts:73`) ownership check becomes:

```ts
// current:  if (!cur || cur.orgId !== ctx.orgId) return;   // only your own self-created rows
// new:      allow if the caller owns the row by partyId OR holds a granted claim on its BN
const owns =
  cur.orgId === ctx.orgId ||
  (cur.businessNumber && claimedBNs.has(cur.businessNumber)); // claimedBNs from identity seam
if (!cur || !owns) return;
```

- `claimedBNs` comes from the shared `resolveOrgForParty(session.partyId)` (§5.2) — the *same* granted
  `OrgClaim`s that gate RAP progress. No new trust path.
- Company edits stay **capped at `reported`** (`SUBMITTABLE_STATUS`) and **progress-only**; the public
  `source` and the committed `title`/`targetYear` are immutable to the company.
- Each write stamps `authoredBy = session.partyId` on the appended `ProgressPoint`, so a company's
  self-reported update is visibly distinct from the original public-research baseline.

`createCommitmentAction` also stamps `businessNumber` from the company's single granted claim (reusing
`uploadBNForSession`'s "exactly one granted claim" rule), so new self-created rows are BN-keyed too.

## 7. Backfill & migration (ships in the SAME PR — ccib lesson)

The prod `Commitments` table is **populated** (~115 real rows). Per the 2026-07-09 incident lesson, an
identity change on a populated table needs its data migration shipped with it.

- **Curate `org-bn-map.ts`** for the seeded orgs. Confidence-gated: include an org only when its
  Corporations Canada legal entity is unambiguous. Target the high-value orgs first (the ones a real
  company is most likely to claim). Ambiguous/multi-entity brands (e.g. "Enbridge") are **left out**
  until resolved — they remain display-only, honoring §3.5.
- **Idempotent migration** `scripts/migrate-commitment-bn.ts` (mirrors `migrate-supplier-ccib.ts`):
  for each seeded commitment whose org slug is in the map, set `businessNumber`; stamp existing
  `history` points with `authoredBy: "public-research"`. Re-runnable; only writes rows that change.
  Run against prod under `AWS_PROFILE=isb` after merge (`aws sso login --profile isb` first).
- **Fixtures updated in lockstep** with the map (so local/dev and any reseed match prod).
- **No RapData migration needed** — its orgs are already BN-keyed.

## 8. UX changes

- **Unified "your organization" view.** Extend `/my-rap` (or a `/my-commitments`-adjacent surface) so a
  claimed company sees, under one org header: (a) its **seeded/public commitments** (by BN, editable
  progress) and (b) its **uploaded RAPs** (existing RapData view). Clearly badge each row's origin
  (public-research vs company-uploaded) and each progress point's author.
- **Fix the misleading copy + revalidation.** Either (a) remove the false "appears in the public RAP
  Index" claim and the `revalidatePath("/commitments")` on the RAP publish path, or (b) — preferred if
  cheap — make it *true* by surfacing BN-matched RapData commitments on the org's Index card. v1: do
  (a) now (honest immediately); (b) is a fast-follow once the crosswalk read exists.

## 9. Phasing / PR breakdown (incremental, each independently mergeable)

1. **PR-1 (schema + honest-copy fix, no behavior):** add `businessNumber?`/`authoredBy?` to types;
   remove the misleading `/my-rap` copy + stray `revalidatePath`. Ships value (stops lying) with near-zero risk.
2. **PR-2 (identity seam):** `src/lib/identity/` with `ClaimReader` + `resolveOrgForParty` +
   crosswalk reads; unit-tested with the mock repo.
3. **PR-3 (backfill):** `org-bn-map.ts` + `migrate-commitment-bn.ts` + fixture updates + test. Run on prod.
4. **PR-4 (authz + write path):** reroute `updateCommitmentAction` through claimed-BN ownership;
   stamp `authoredBy`; `createCommitmentAction` stamps BN.
5. **PR-5 (unified view):** the org-scoped company view across both domains.

## 10. Testing

- **Unit (mock repo):** `resolveOrgForParty` returns exactly the granted BNs; crosswalk fan-out
  returns commitments + raps for a BN; `updateCommitmentAction` allows a claimed company to update a
  BN-matched seeded row and **rejects** a party with no claim on that BN (directly-POSTable action —
  test the raw path, not just the UI). `authoredBy` is stamped. Company still cannot edit `title`/`targetYear`.
- **Migration:** idempotent (second run is a no-op); only maps confidence-listed orgs; leaves unmapped
  orgs untouched with `businessNumber` absent; existing history gets `authoredBy: "public-research"`.
- **Regression:** `/commitments` renders unchanged when `businessNumber` is absent; existing 11
  `test-rap-*` scripts + commitments tests stay green.

## 11. Open decisions (for sprint planning)

1. **Backfill breadth:** curate BNs for all ~103 seeded orgs now, or only the top-N most-likely-to-claim
   and expand later? (Recommend: top-N first; the map is additive.)
2. **Misleading-copy fix:** honest-removal now (recommended) vs wait and do the real surfacing (PR-5)
   in one shot.
3. **Claim-store ownership:** keep `OrgClaim` storage in the RAP repo behind a shared read interface
   (recommended, incremental) vs fully relocate it into `src/lib/identity/` now (cleaner, larger diff).

## 12. Risks & mitigations

- **Wrong-entity attribution** (a seeded row mapped to the wrong BN). Mitigation: confidence-gated
  curation; ambiguous brands excluded; the map is auditable and reversible (idempotent re-run).
- **A company edits public data it shouldn't.** Mitigation: edits are progress-only, capped at
  `reported`, `authoredBy`-stamped, and `source` is immutable — the public baseline is always visible.
- **Cross-domain coupling creep.** Mitigation: the shared `identity` seam depends on neither domain's
  internals; both domains depend on *it* (dependency points upward, not sideways).
- **Prod data drift** (the ccib trap). Mitigation: migration ships in PR-3, run on prod immediately;
  fixtures kept in lockstep.
