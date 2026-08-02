# Per-field edit + verify in the extraction review queue

**Date:** 2026-08-01 · Surface: `/extract?tab=review` (INDIGENOMICS-only) · Stages: all (feature is stage-agnostic; matters where real extraction runs — `ca`, `production`)

## Context

The review queue (`ReviewPanel.tsx`) now shows each flagged field as an evidence card — the value the
AI read, the quote it cited, the page, and a jump-to-PDF link (shipped in PR #215). But a reviewer
still can only **Approve & publish** (whole document) or **Reject**. There is no way to *correct* a
wrong value, and no way to record that a human *confirmed* a value against the source. So a RAP with
one wrong pillar can only be rejected wholesale and re-run, and "approved" carries no per-field trail.

This spec adds **per-field editing + a "verified" check-off** on the flagged fields, so a reviewer can
fix what's wrong, confirm what's right, and publish corrected, human-checked data — with an audit
record of exactly which fields were verified.

**Why this is safe to add:** the confirm path already publishes `job.extracted` (`confirmExtractionAction`
→ `publishAndConfirm` → `buildCanonical`). Editing simply means submitting a corrected `extracted`
before that runs. The controlled-vocabulary fields (`sector`, `commitmentType`, `pillar`, …) are the
only real hazard: DynamoDB enforces nothing, and `oneOf()` in `publish.ts` silently coerces any
out-of-set value to `"other"`. Editing those through **dropdowns of the canonical values** removes
that hazard by construction.

## Scope

- **In:** edit + verify on the **flagged fields only** (the "What to check" evidence cards). Approve
  gated until every flagged field is verified (plus the existing Business Number gate). Persist an
  audit record of verified paths + reviewer + timestamp on the confirmed job.
- **Out:** editing non-flagged fields (the full `ExtractedView` stays read-only reference);
  draft-save of in-progress edits; the extras/`pillars` redundancy cleanup (separate concern);
  changing what the extractor produces or what `isClean` gates.

## Design

### 1. Field-edit registry — how each field is edited (correctness core)

A pure map from field key → edit descriptor, so a value can never leave its allowed set:

| Field(s) | Control | Edit target | Notes |
|---|---|---|---|
| `action`, `deliverable`, `owner`, `timeline`, `metric`, `endorsementStatus`, `orgName`, `rapTitle`, `governanceBody`, `reviewCycle`, `publicationDate` | text input | same path | free text — anything |
| `sector`, `commitmentType`, `jurisdiction`, `rapType`, `pairLevel` | dropdown | same path | canonical values + `other` |
| `pillarRaw` (flagged path) | dropdown | **`pillarNormalized`** | the 10-value `Pillar` set; `pillarRaw` + quote shown read-only as evidence. Flagged-path ≠ edit-target special case |
| `frameworkRefs` | multi-select checklist | same path | the 5 `FrameworkRef` values |
| `periodCovered` | two date inputs (start/end) | same path | object `{start,end}` |

Canonical value lists come from `extraction-schema.ts` (`SECTORS`, `PILLARS`, `COMMITMENT_TYPES`) and
`types.ts` (`Jurisdiction`, `RapType`, `PairLevel`, `FrameworkRef`); labels from `taxonomy.ts`
`labelFor` + the framework labels added in PR #215 (`validation-display.ts`). The **server** builds a
serializable descriptor per flagged field (`{ path, editTarget, control, options?: {value,label}[],
currentValue, label, quote, page }`) and passes it to the client — the client renders controls without
importing any server logic.

A field type with no registered editor is still **check-off-able** (verify isn't gated on editability);
editing is only offered where a control exists.

### 2. UI / interaction — client-side, batched

`ReviewCard` stays a server component (collapsed summary, document-level callout, read-only
`ExtractedView`, Reject form, PDF links). The flagged-fields block becomes a **client child**
`FlaggedFieldsEditor` (`"use client"`) that receives the field descriptors + `jobId` + `needsBn` as
plain props and holds local state:

- `edits: Record<path, value>` — only changed fields.
- `verified: Set<path>` — checked-off flagged paths.

Each evidence card renders its edit control (from the descriptor) + a **Verified** checkbox, and shows
an "edited" marker when the value differs from the AI's. One **Save & publish** button, enabled only
when **every flagged path ∈ `verified`** and `!needsBn`. On click it calls a single batched server
action. Reject stays as-is; the "Open source PDF" links stay (server-action forms invoked from the
client card — supported).

### 3. Data flow & persistence

`confirmReviewedExtractionAction({ jobId, edits, verifiedFields })` (`"use server"`, indigenomics-
guarded like every action in `actions.ts`):

1. Load the job; bail if missing / not `PENDING_REVIEW` / `!canPublish`.
2. Apply `edits` to a copy of `job.extracted` via a pure `applyFieldEdits(extracted, edits)` that
   honors the registry's `editTarget` (so a `pillarRaw` edit writes `pillarNormalized`). Enum values
   arrive canonical, so `oneOf` never downgrades them.
3. `publishAndConfirm(job, editedExtracted, reviewedBy)` — unchanged.
4. Persist `verifiedFields` + reviewer + timestamp on the CONFIRMED job row.
5. `revalidatePath("/extract")`, `revalidatePath("/my-rap")`, redirect to `/extract?tab=review`.

The existing `confirmExtractionAction` (no-edit approve) can remain for callers/tests or be folded in;
the new action is the review-queue path.

### 4. Data-model change

Add `verifiedFields: string[]` to `ExtractionJob` (`types.ts`); older rows read as `[]` (mirror the
`attempts`/`itemToJob` back-compat pattern in `repo.dynamo.ts`). Thread it through `confirmJob` /
the marshaller in `rap-table.ts`. No new entity, no GSI.

## Reuse / patterns

- `pathToField` / `summarizeIssues` / framework labels — `validation-display.ts` (PR #215); extend
  with the field-edit registry + `applyFieldEdits`, both pure and unit-tested.
- `confirmExtractionAction` / `publishAndConfirm` / `canPublish` — `actions.ts`, `stage-extraction.ts`,
  `actions-core.ts` (the guard + publish machinery, reused unchanged).
- Server-action-from-client-component — standard Next.js App Router; the card imports the action.
- `oneOf` canonical coercion — `publish.ts` (the safety net the dropdowns make redundant for enums).
- `check()`-style tests — `scripts/test-validation-display.ts`.

## Edge cases

- **Unsaved edits are client state** → navigating away mid-review discards them (no draft-save).
  Acceptable for one focused pass; documented in the UI copy.
- **Retry / re-extract** produces fresh `extracted` → `verifiedFields` resets to `[]` (correct — the
  data changed).
- **Enum edit out of set** — impossible: the control only offers canonical values + `other`.
- **`pillarNormalized` edit** leaves `pillarRaw` (provenance) intact.

## Testing

**Offline (pure):** `scripts/test-review-field-edit.ts` — the registry (key → control/editTarget/
options, incl. `pillarRaw → pillarNormalized`), and `applyFieldEdits` (text edit lands; enum edit
lands canonical; pillar edit writes `pillarNormalized` not `pillarRaw`; unknown path is a no-op; input
not mutated). Plus `tsc --noEmit`, `next build`, and existing `test-validation-display` still green.

**Live on `ca`** (`npm run ca:deploy`; user drives the browser):
1. Expand a flagged doc → edit a free-text field (e.g. a deliverable) and a dropdown field (pillar),
   tick every flagged field Verified → **Save & publish** enables only when all are ticked + BN set.
2. Confirm the published RAP on `/my-rap` shows the corrected values, and (with `RAP_INDEX_SOURCE=merge`)
   the pillar edit is reflected in Explore's pillar dimension.
3. Confirm the confirmed job row carries `verifiedFields`.

## Rollout

New branch `feat/review-field-edit-verify` → spec (this doc) → implementation plan (writing-plans) →
PR → test on `ca` → merge (auto-deploys `production`, or manual per `docs/deploy.md` if OIDC isn't
wired). Independent of PR #215 (already merged).
