# Editable + persisted context sections (A / C / D) — design

**Date:** 2026-06-18 · **Owner:** En-Ping Su (company side) · **Follows:** the read-only
context sections shipped in PR #21 (`2026-06-17-questionnaire-context-sections-design.md`).

## Problem

We are moving off the demo. The `/report` questionnaire's profile + context sections
(A · profile, C · workforce & culture, D · governance & relationships) are **read-only**
displays sourced from the RAP Impact Survey domain (`src/lib/survey`), and only
`org-cedartrust` has data. A logged-in company cannot fill in or change its own context —
the page reads as a fixture viewer, not a live questionnaire.

Section B (confirmable economic lines) is already live: `ReportLineForm` writes through
`repo` via the `createLineAction` server action. The context sections need the same
treatment against the survey seam.

## Decision — Option A (editable displayed slice), not the full 41

Make **exactly the slice already rendered** in A / C / D editable and persisted. Do not
build inputs for the ~28 un-surfaced `SurveyResponse` fields (procurement $, donations,
NRW, the six Reconciliation-Australia Likerts, employment targets, outcome free-text, …).

The product will **eventually move to Option B** (the full 41-question survey as the
company's annual submission tool). This design is built so B is **purely additive**: writes
go through the repo seam with **load-merge-write**, preserving every un-surfaced field, so a
later per-section Option-B form only overwrites fields it owns. B, when it comes, should be
planned as a sequence of section-by-section PRs, not one big bang. It is out of scope here.

### Editable field set (the displayed slice)

- **A · Organisation profile** (→ `Organization`): industry (Q2, select; blank default —
  see "Blank industry" below),
  latest RAP type (Q3, 4-option select), total employees (Q5, number), listed/ASX-200
  (Q4, checkbox), contact name + email (Q1, text).
- **C · Workforce & culture** (→ `SurveyResponse`): Indigenous staff total (Q28, number +
  "not collected" → `null`), staff by level (Q29: board, seniorExec, middleManagement,
  entryLevel — councillors stays defaulted), cultural-learning hours (Q22: elearning,
  faceToFace, immersion), cultural-protocols doc (Q23, checkbox), employment strategy
  (Q26, checkbox).
- **D · Governance & relationships** (→ `SurveyResponse`): governance structures (Q38,
  multi-select), senior-leader engagement (Q39, 1–5 select), partnerships formal/informal
  (Q15, numbers), partnered-with (Q16, comma-separated text → `string[]`).

## Architecture & write path

New file `src/lib/survey/actions.ts` (`"use server"`), mirroring `src/lib/repo/actions.ts`
(closest analog: `updateSupplierProfileAction` — a partial update via `FormData`).

- `updateProfileAction(formData)` — Section A → `surveyRepo.putOrganization`.
- `updateContextAction(formData)` — Sections C + D → `surveyRepo.putResponse`.

Both use **load-merge-write**:

1. Read `orgId` (hidden field, derived on the page from `partyIdFrom` → `companyToOrgId`)
   and, for context, `year` (`SURVEY_YEAR = "2025"`).
2. Load the existing `Organization` / `SurveyResponse`.
3. If absent, start from a **default factory** (see below) — this is create-on-save.
4. Overlay the parsed editable slice onto the loaded/blank object.
5. `putOrganization` / `putResponse` the merged object.
6. `revalidatePath("/report")` and `redirect("/report?as=<companyId>")`.

Identity: `orgId` comes from the form's hidden input, derived on the page the same way
Section B derives `companyId`. No `orgId` → action no-ops (mirrors Section B).

### Default factory (create-on-save)

New `src/lib/survey/defaults.ts` exporting `blankOrganization(id)` and
`blankResponse(orgId, year)`. Neutral values that render correctly in the display and are
safe for a future Option-B form to overwrite:

- `Organization`: empty contact name/email, `industry: "unspecified"` (blank — see below),
  `latestRapType: "reflect"`, `asx200: false`, `totalEmployees: 0`,
  `members: { organisations: 0, individuals: 0 }`, `totalStudents: 0`, `createdAt` stamped.
- `SurveyResponse`: `indigenousStaff.total: null` (+ zeroed breakdown), all by-level counts
  `0`, cultural-learning `0/0/0`, `governanceStructures: ["none"]`,
  `seniorLeaderEngagement: 1`, `partnerships: { formal: 0, informal: 0 }`,
  `partneredWith: []`, all un-surfaced required fields (Likerts, procurement, donations,
  etc.) set to safe neutral defaults, `submittedAt`/`reportingPeriod` stamped.

### Blank industry

`Industry` is a strict 23-member union with no empty value. Add an `"unspecified"` member
to the union in `src/lib/survey/types.ts` so a new org's industry can be genuinely blank in
a type-safe way (no empty-string casting). The `ProfileForm` industry `<select>` shows a
disabled placeholder ("Select an industry…") that maps to `"unspecified"`; the read-only
`humanIndustry` (in `ContextSections.tsx`) renders `"unspecified"` as "—". This is the only
data-layer type touch in this change, and it is additive (no existing fixture uses it).

## UI / components

The page stays a `force-dynamic` server component. Edit state is driven by a
**search-param toggle** — no new client state:

- `?edit=profile` → render `ProfileForm` in place of `ProfileCard` (Section A).
- `?edit=context` → render `ContextForm` in place of the C/D cards.
- default (no `edit`) → the existing read-only cards, with the "self-reported · unverified"
  stamps on C/D intact.

`page.tsx` reads `searchParams.edit` and branches per section. Each read-only card gains a
small **"Edit"** link (`/report?as=<id>&edit=profile|context`); each form has a **Save**
button (submits the action) and a **Cancel** link (back to `/report?as=<id>`).

New client components (`"use client"`), following `ReportLineForm`'s shape (hidden ids +
named fields):

- `src/app/report/ProfileForm.tsx` — Section A inputs → `updateProfileAction`.
- `src/app/report/ContextForm.tsx` — Sections C + D inputs → `updateContextAction`,
  keeping the unverified stamp.

`ContextSections.tsx` keeps the read-only renderers (`ProfileCard`, `ContextBlocks`) and
gains the "Edit" links. Per-entity split is intentional: A maps to `Organization`, C+D map
to `SurveyResponse`, so two forms / two actions / two write targets.

## Validation & edge cases

House style — light validation, **silent no-op on bad input** (page re-renders), no throws,
no per-field error messages, no client-side validation library, no optimistic UI (YAGNI).

- Numbers via `Number()`, clamped `≥ 0`; non-finite → keep the existing value for that field.
- Text (contact name/email) trimmed; empty optional fields keep prior values rather than
  wiping them.
- **Staff total**: a "not collected" checkbox wins — if checked, `total = null` regardless
  of the number input.
- **Governance structures**: `formData.getAll("governanceStructures")`; empty selection →
  `["none"]`.
- **Partnered-with**: split on commas, trim, drop empties → `string[]`.
- **Identity guard**: missing `orgId` → no-op.

## Persistence reality (assumption, not scope)

"Persisted" here means **writes go through the `surveyRepo` seam correctly**. The default
mock repo is in-memory and resets on server restart/redeploy. Making the *deployed* site
durably persist is the `REPO_IMPL=dynamo` infra toggle (deploy-env concern, owned by infra
/ @SharonHuang77) — **not** a code change in this branch. The code works identically against
mock and dynamo seams.

## Scope / non-goals

- No inputs for the ~28 un-surfaced `SurveyResponse` fields (that is Option B).
- No change to `coverage`, the Index, or Section B — context **never** flows to the Index
  (the confirmability moat). Editable context stays self-report and stays stamped.
- No new write paths in the data layer — `putOrganization`/`putResponse` already exist.
  The only data-layer touch is the additive `"unspecified"` `Industry` member (above).
- No DynamoDB / deploy-env changes.
- No auth/session changes beyond reusing `partyIdFrom` (already merged).

## Files

- `src/lib/survey/types.ts` — add `"unspecified"` to the `Industry` union (additive).
- `src/lib/survey/actions.ts` (new) — `updateProfileAction`, `updateContextAction`.
- `src/lib/survey/defaults.ts` (new) — `blankOrganization`, `blankResponse`.
- `src/app/report/ProfileForm.tsx` (new) — Section A editable form.
- `src/app/report/ContextForm.tsx` (new) — Sections C + D editable form.
- `src/app/report/ContextSections.tsx` — add "Edit" links to read-only cards.
- `src/app/report/page.tsx` — read `searchParams.edit`, branch read-only vs form per section.

## Verification

- `npm run build` green (authoritative type-check).
- In-browser (`?as=c-cedartrust` and `?as=c-northway`):
  1. Cedar Trust → edit profile → Save → values persist on reload.
  2. Cedar Trust → edit context → toggle "not collected", change governance multi-select →
     Save → reflected in the read-only view.
  3. Northway (no org) → edit → Save → new org/response created via the default factory;
     read-only cards now populate.
  4. C/D still carry the "self-reported · unverified" stamp; Section B, coverage, and the
     Index are unchanged.
