# Design — RAP org identity (Business Number) + company progress tracking

**Owner:** Nate (En-Ping) · **Prepared:** 2026-07-10 · CS7980 capstone · **Status:** proposed
**Repo:** `logisticPM/portal` (active dev; syncs to `indigenomics-data-platform`)

## 1. Context & problem

The RAP extraction pipeline (`/extract` → BDA/Bedrock → review → publish) derives an organization's identity entirely from the **model-extracted org name**. PR #151 hardened same-document dedup (content-hash `rapId` + `normalizeOrgName`), but a name is fundamentally **not an identity**:

- **False merge:** a RAP says "Enbridge" (the brand), but Corporations Canada lists *three* distinct legal entities — Enbridge Inc. (BN `119653384`), Enbridge Pipelines Inc. (`102505641`), Enbridge Frontier Inc. (`837654714`). A name key can attach commitments to the wrong legal entity.
- **False split:** the same entity written two ways ("Enbridge Inc." vs "Enbridge Gas Inc.") fragments into two orgs.

Only the **Canada Revenue Agency Business Number (BN)** disambiguates. Separately, the platform tracks *progress over time* but the RAP domain has **no way to record it** — the `Observation`/`CommitmentRollup` model exists and the `RollupAggregator` Lambda recomputes on writes, yet no action/UI appends observations (only `publish.ts` seeds one baseline).

This design adds (a) **BN as authoritative org identity, resolved at review against the federal registry**, and (b) a **company-owned progress-update flow**, under a **hybrid** ownership model.

## 2. Goals / non-goals

**Goals (v1)**
- Org identity keyed on **BN** (9-digit), resolved at **review** and verified free against the **ISED Federal Corporation API**, with a **prefilled CBR deep-link** for the lookup.
- **Hybrid ownership:** staff *and* companies can upload; only a **claimed** company can post progress; grounded extraction is never edited by the company.
- **Append-only progress** on RAP commitments (company-scoped), reusing the existing `Observation` → `RollupAggregator` machinery.
- **No silent mis-attribution of progress** (see the re-extraction lock, §7).

**Non-goals (deferred)**
- **Inline fuzzy `searchByName`** (the "three Enbridges" candidate list). Designed as a pluggable seam; v1 uses verify-by-BN + CBR deep-link. A commercial provider (OpenCorporates, etc.) is the later drop-in.
- **Cross-version reconciliation** — matching this year's commitments to last year's across annual RAPs. A new annual RAP is a **new document** under the same BN'd org.
- **Stable commitment IDs / carry-forward across re-extraction.** Replaced by the re-extraction *lock* (§7). Chosen over stable-commitId+matching because the latter risks *silent* mis-attribution.
- **Provincial-registry verification** (ISED free API is federal-only). Provincial-only entities publish as **`self_asserted`** BN, badged.
- **Stricter claim verification** (email-domain / letter-of-authority). v1 grants on successful BN verify + an attestation checkbox.

## 3. Design principles

1. **Name is a hint, never identity.** Published orgs are keyed on a resolved BN; the registry's canonical legal name wins over the extracted name.
2. **Three parties, three claims** (extends the existing provenance ≠ grounding ≠ confirmation model): *extracted-by* (staff/pipeline) ≠ *progress-reported-by* (the company). Surface both; never conflate.
3. **Progress is a separate append-only layer** over the immutable grounded extraction.
4. **Fail safe on identity & progress.** When unsure, flag for a human; never guess an entity or silently move progress.

## 4. Identity model (three levels)

| Level | v1 key | Set when |
|---|---|---|
| **Org** | `orgId = "org-bn-" + <9-digit BN>` when resolved; else `orgIdFor(name)` (#151 fallback), flagged `self_asserted` | BN at **review**; name fallback at publish |
| **Document** | `stableRapId(orgId, contentHash)` (#151) | publish |
| **Commitment** | current per-publish id (unchanged) — safe because of the re-extraction lock (§7) | publish |

The BN's **9-digit root** is the org key (program-account suffixes like `RC0001` denote accounts of the *same* business → same org).

## 5. Data model changes

All additive; RapData single-table (`PK/SK` + GSI1/GSI2), types in `src/lib/rap/types.ts`.

**`RapOrganization`** — add:
```ts
businessNumber: string | null;   // 9-digit root, null only for self_asserted-less legacy
legalName: string | null;        // registry-canonical name (overrides extracted display name)
registryStatus: string | null;   // e.g. "Active"
registrySource: "ised" | "self_asserted" | null;
verifiedAt: string | null;       // ISO; when verifyBN last succeeded
```

**`ExtractionJob`** — add (populated at review, before publish):
```ts
businessNumber: string | null;
businessNumberSource: "ised" | "self_asserted" | null;
registryLegalName: string | null;
registryStatus: string | null;
```

**New entity `OrgClaim`** — links a company login (`partyId`) to a BN'd org:
```ts
interface OrgClaim {
  businessNumber: string;  // 9-digit
  partyId: string;         // session.partyId (company login)
  status: "granted";       // v1 single state; "pending"/"revoked" reserved
  attestedAt: string;      // ISO
  grantedBy: string;       // "system:bn-verify" (v1) | staff id
}
// key: PK = "ORGCLAIM#<bn>", SK = "PARTY#<partyId>"  (+ GSI1PK = "PARTY#<partyId>" for reverse lookup)
```

**`Observation`** — unchanged shape; `recordedBy` carries `partyId` for company-recorded points (vs `"system"` baseline). This distinction drives the re-extraction lock.

## 6. Registry adapter

New module `src/lib/rap/registry.ts` — provider-agnostic:
```ts
interface RegistryEntity {
  businessNumber: string;      // 9-digit
  legalName: string;
  status: string;              // "Active", ...
  jurisdiction: string;        // "CA-federal" | province code
  officeLocation: string | null;
  source: "ised";
}
interface RegistryProvider {
  verifyBN(bn9: string): Promise<RegistryEntity | null>;      // v1 — ISED Federal Corp API
  searchByName?(query: string): Promise<RegistryEntity[]>;    // v2 seam — unimplemented in v1
}
```
- **`IsedFederalCorpProvider.verifyBN`** — calls the free ISED Federal Corporation API (public plan, 60 hits/min; keyed by corp#/BN). Endpoint + response mapping to be confirmed from the OpenAPI spec at `api.ised-isde.canada.ca` during planning. Returns `null` on not-found (→ `self_asserted` path).
- **`cbrSearchUrl(name: string): string`** — builds a prefilled deep-link to `https://ised-isde.canada.ca/cbr-rec/` for the extracted name (exact query-param to confirm from the site). Shown in the review UI so staff copy the BN back.
- **BN validation** (`isValidBN(raw): { bn9: string } | null`) — strip formatting, accept optional program identifier (`RC`/`RT`/… + 4-digit ref), validate the 9-digit **check-digit** (mod-10) as a cheap pre-filter before any network call.
- **Test seam:** a `StubRegistryProvider` returns canned entities; no live ISED calls in tests. Selected by env (default stub in dev/test, ISED in prod) — same pattern as `EXTRACTION_IMPL`.

## 7. Flows

### 7.1 Upload (staff or company)
`uploadRapAction` (`src/lib/rap/actions.ts`) accepts **both** `session.kind === "indigenomics"` and `"company"`.
- **Company upload:** auto-tag `job.businessNumber` from the uploader's *granted* `OrgClaim` (they've claimed their org). No BN typing.
- **Staff upload:** `job.businessNumber` left null → resolved at review.
- Everything else (S3 presigned PUT, async extractor invoke) unchanged.

### 7.2 Extraction (unchanged)
Engine-agnostic (`pipeline.ts` → bda/bedrock/mock). Produces `ExtractionResult` → `stageExtraction` → job `PENDING_REVIEW`. **BN plays no part in extraction.**

### 7.3 Review + BN resolution (staff only)
`ReviewPanel.tsx` gains an **Organization** block per job:
- Shows the extracted name + a **`cbrSearchUrl` deep-link** ("Look up in Canada's Business Registries ↗").
- Staff enter the **BN** → new action **`resolveOrgAction(jobId, bnRaw)`**: `isValidBN` → `provider.verifyBN` → on hit, store `businessNumber` (9-digit), `registryLegalName`, `registryStatus`, `businessNumberSource: "ised"` on the job and display the canonical entity for confirmation. On miss/provincial-only, staff may mark **`self_asserted`** (badged) to proceed.
- **Publish gate:** `confirmExtractionAction` refuses to publish unless the job has a `businessNumber` (verified) **or** an explicit `self_asserted` acknowledgement.
- `publishAndConfirm` (`stage-extraction.ts`) changes: `orgId = job.businessNumber ? "org-bn-" + bn9 : orgIdFor(name)`; the published `RapOrganization` carries `legalName`/`registryStatus`/`registrySource`/`verifiedAt`. `rapId = stableRapId(orgId, contentHash)` (unchanged mechanics).

### 7.4 Claim your organization (company)
New route `/my-rap/claim` (company session):
- Company enters its **BN** → `verifyBN` → shows legal name → **attestation checkbox** ("I am authorized to report on behalf of this organization") → creates a **granted** `OrgClaim{bn, partyId}`.
- v1 auto-grants on successful verify + attestation (`grantedBy: "system:bn-verify"`). Stricter proof deferred.

### 7.5 Record progress (claimed company)
New route `/my-rap` + action **`recordRapProgressAction(formData)`**:
- Guard: `session.kind === "company"`, and a **granted `OrgClaim`** exists linking `session.partyId` to the commitment's org BN (mirrors the `/my-commitments` `cur.orgId !== ctx.orgId` ownership check).
- Appends an `Observation{commitId, observedAt: now, status, observedValue, note, recordedBy: partyId}`. The existing **`RollupAggregator`** recomputes the rollup — no new aggregation code.
- Company **cannot** edit grounded fields (action/deliverable/target/quote) — only append progress.

### 7.6 Re-extraction lock (the Option-A guarantee)
Before `publishAndConfirm` writes on a re-extraction (target `rapId` already exists):
- Query the rapId's commitments' observations. If **any** `Observation.recordedBy !== "system"` (i.e. company-recorded progress exists), **block** the re-publish with a clear message ("This RAP has company-reported progress and is locked from re-extraction; upload a corrected version as a new document").
- If only baseline `system` observations exist → replace freely (existing #151 dedup behavior, no progress to lose).
- Net: progress is **never** silently wiped or mis-attributed.

## 8. Permissions matrix

| Action | indigenomics (staff) | company (claimed) | company (unclaimed) |
|---|---|---|---|
| Upload RAP | ✅ | ✅ (auto-tags own BN) | ✅ (must claim first to tag) |
| Review / resolve BN / publish | ✅ | ❌ | ❌ |
| Claim org (BN) | n/a | — | ✅ |
| Record progress | ❌ | ✅ (own org only) | ❌ |
| Edit grounded extraction | ❌ (only via re-extract, pre-progress) | ❌ | ❌ |

## 9. Error handling & edge cases

- **Invalid BN format / bad checksum:** reject before any network call; inline error.
- **`verifyBN` network/timeout/rate-limit (60/min):** surface "registry unavailable — retry or mark self-asserted"; never auto-`self_asserted` silently.
- **Provincial-only entity:** federal API returns null → staff choose `self_asserted` (badged) or abort.
- **Two program accounts (`…RC0001`, `…RT0001`) of one business:** collapse to the 9-digit root → one org.
- **Company claims a BN with no extracted RAP yet:** claim succeeds; `/my-rap` simply shows nothing to update until a RAP for that BN is published.
- **Re-extraction of a locked RAP:** blocked with guidance (§7.6).
- **Legacy orgs (pre-BN, from earlier name-key publishes):** remain `businessNumber: null`; unaffected until re-published. No migration required (prod RapData is currently empty).

## 10. Testing approach

`tsx` scripts + `node:assert/strict` (repo convention), all against the **mock repo + StubRegistryProvider** (no AWS/ISED calls):
- `test-rap-bn.ts` — `isValidBN` (format + checksum, program-suffix strip), 9-digit-root org key, self_asserted fallback.
- `test-rap-identity.ts` — `publishAndConfirm` with a resolved BN → `orgId = org-bn-…`; two program accounts → one org; the three Enbridges (distinct BNs) → three distinct orgs.
- `test-rap-progress.ts` — `recordRapProgressAction` appends an observation + rollup recompute; permission guard (unclaimed/ wrong-org company rejected); grounded fields immutable.
- `test-rap-reextract-lock.ts` — re-extract with only baseline observations → replaces; with a company observation → blocked.
- `test-rap-claim.ts` — claim creates a granted `OrgClaim`; reverse lookup by `partyId`.
- Extend `test-rap-dedup.ts` to assert BN-keyed rapId stability.

## 11. Rollout & ordering

1. Ship this feature (BN identity + progress) behind the normal flow; extractor stays `mock` in prod (harmless — mock output still exercises review/BN/publish).
2. **Then** activate real extraction by merging **#153** and redeploying — real extractions land already BN-keyed, no identity migration. (#153 is held for exactly this reason.)

## 12. Open questions (non-blocking)

- Exact ISED Federal Corp API endpoint + response field mapping (confirm from the OpenAPI spec during planning).
- Exact CBR deep-link query parameter (confirm from the site).
- Whether `/my-rap` and `/my-commitments` should merge into one company home later (out of scope now).
