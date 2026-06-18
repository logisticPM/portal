# Editable + Persisted Context Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/report` questionnaire's profile + context sections (A · profile, C · workforce & culture, D · governance & relationships) editable and persisted through the survey repo seam, for any logged-in company.

**Architecture:** Pure, testable core (a default-object factory + form parse/merge functions) with thin `"use server"` action shells that do load-merge-write against `surveyRepo`. The page stays a `force-dynamic` server component; edit state is a `?edit=profile|context` search-param toggle that swaps a read-only card for a client form. Section A writes `Organization`; sections C+D write `SurveyResponse`.

**Tech Stack:** Next.js 14.2 App Router (server components + server actions), TypeScript, Tailwind. No test framework — pure logic is verified with committed `tsx` assertion scripts (matching the repo's `scripts/verify.ts` convention); wiring is verified with `npm run typecheck`, `npm run build`, and in-browser checks.

## Global Constraints

- **The moat:** context (A/C/D) is self-report — it **never** flows to coverage or the Index. Editable context stays self-report and keeps the "self-reported · unverified" stamp on C/D. Do not touch coverage, the Index, or Section B.
- **Option A only:** edit ONLY the fields already displayed. Build NO inputs for the ~28 un-surfaced `SurveyResponse` fields (procurement $, donations, NRW, the Reconciliation-Australia Likerts, employment targets, outcome free-text, etc.).
- **Load-merge-write:** every write loads the existing object (or a blank default), overlays only the edited slice, and writes the whole object back — preserving every un-surfaced field so Option B is purely additive later.
- **House validation style:** light validation, **silent no-op on bad input** (page re-renders), no throws, no per-field error messages, no client-side validation library, no optimistic UI (YAGNI).
- **Persistence scope:** "persisted" means writes go through the `surveyRepo` seam correctly. The mock is in-memory and resets on restart; durable persistence is the `REPO_IMPL=dynamo` deploy-env toggle (infra, out of scope). Make NO DynamoDB / deploy changes.
- **Identity:** reuse `partyIdFrom` (already merged). `orgId` is derived on the page (`companyToOrgId`) and passed to forms/actions as a hidden field. Missing `orgId` → action no-ops.
- **Branch:** `feat/editable-context-sections`, already created off `main` (current branch). Commit message trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Add `"unspecified"` industry member

Make a blank industry representable in a type-safe way (no empty-string casting).

**Files:**
- Modify: `src/lib/survey/types.ts` (the `Industry` union)
- Modify: `src/app/report/ContextSections.tsx` (render `"unspecified"` as "—")

**Interfaces:**
- Consumes: nothing.
- Produces: `Industry` now includes the literal `"unspecified"`. `humanIndustry("unspecified")` returns `"—"`.

- [ ] **Step 1: Add the union member**

In `src/lib/survey/types.ts`, change the `Industry` union to add the member as the last entry:

```ts
export type Industry =
  | "architecture"
  | "arts_culture"
  | "consulting"
  | "community_dev"
  | "construction"
  | "education"
  | "environment"
  | "finance_insurance"
  | "governance"
  | "health"
  | "legal"
  | "marketing"
  | "media"
  | "mining"
  | "property"
  | "recruitment"
  | "retail"
  | "safety_security"
  | "science_tech_eng"
  | "social_services"
  | "sport"
  | "tourism"
  | "transport"
  | "unspecified"; // blank — new org has not chosen an industry yet
```

- [ ] **Step 2: Render the blank value as a dash**

In `src/app/report/ContextSections.tsx`, add an `unspecified` entry to `industryLabels`:

```ts
const industryLabels: Partial<Record<Industry, string>> = {
  finance_insurance: "Finance & insurance",
  consulting: "Consulting",
  construction: "Construction",
  mining: "Mining",
  transport: "Transport",
  retail: "Retail",
  unspecified: "—",
};
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/survey/types.ts src/app/report/ContextSections.tsx
git commit -m "feat(survey): add 'unspecified' industry for blank new-org default

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Default-object factory (`defaults.ts`)

Pure factories that build a complete `Organization` / `SurveyResponse` from neutral defaults, used by create-on-save. Timestamp is passed in (deterministic, testable).

**Files:**
- Create: `src/lib/survey/defaults.ts`
- Create: `scripts/test-survey-defaults.ts`

**Interfaces:**
- Consumes: `Organization`, `SurveyResponse` types from `./types`.
- Produces:
  - `blankOrganization(id: string, now: string): Organization`
  - `blankResponse(orgId: string, year: string, now: string): SurveyResponse`
  - Guarantees: `industry: "unspecified"`, `indigenousStaff.total: null`, `governanceStructures: ["none"]`, all counts `0`, all required Q8–Q41 fields populated.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-survey-defaults.ts`:

```ts
import assert from "node:assert/strict";
import { blankOrganization, blankResponse } from "../src/lib/survey/defaults";

const now = "2026-06-18T00:00:00.000Z";

// blankOrganization
const org = blankOrganization("org-acme", now);
assert.equal(org.id, "org-acme");
assert.equal(org.industry, "unspecified");
assert.equal(org.latestRapType, "reflect");
assert.equal(org.asx200, false);
assert.equal(org.totalEmployees, 0);
assert.equal(org.contactName, "");
assert.equal(org.contactEmail, "");
assert.equal(org.createdAt, now);
assert.deepEqual(org.members, { organisations: 0, individuals: 0 });

// blankResponse
const r = blankResponse("org-acme", "2025", now);
assert.equal(r.orgId, "org-acme");
assert.equal(r.year, "2025");
assert.equal(r.reportingPeriod, "2024-07-01..2025-06-30");
assert.equal(r.indigenousStaff.total, null);
assert.deepEqual(r.indigenousStaffByLevel, {
  board: 0, councillors: 0, seniorExec: 0, middleManagement: 0, entryLevel: 0,
});
assert.deepEqual(r.culturalLearning, { elearning: 0, faceToFace: 0, immersion: 0 });
assert.deepEqual(r.governanceStructures, ["none"]);
assert.equal(r.seniorLeaderEngagement, 1);
assert.deepEqual(r.partnerships, { formal: 0, informal: 0 });
assert.deepEqual(r.partneredWith, []);
assert.equal(r.hasCulturalProtocolsDoc, false);
assert.equal(r.hasEmploymentStrategy, false);
assert.equal(r.submittedAt, now);

console.log("ok: survey-defaults");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-survey-defaults.ts`
Expected: FAIL — `Cannot find module '../src/lib/survey/defaults'`.

- [ ] **Step 3: Write the factory**

Create `src/lib/survey/defaults.ts`:

```ts
// Neutral default objects for create-on-save: when a company has no survey
// Organization / SurveyResponse yet, the editable context form builds one from
// these and overlays the typed slice. Every required Q8–Q41 field is populated so
// a future Option-B form only overwrites fields it owns. `now` is passed in for
// deterministic tests.
import type { Organization, SurveyResponse } from "./types";

export function blankOrganization(id: string, now: string): Organization {
  return {
    id,
    contactName: "",
    contactEmail: "",
    industry: "unspecified",
    latestRapType: "reflect",
    asx200: false,
    totalEmployees: 0,
    members: { organisations: 0, individuals: 0 },
    totalStudents: 0,
    createdAt: now,
  };
}

export function blankResponse(orgId: string, year: string, now: string): SurveyResponse {
  const startYear = Number(year) - 1;
  return {
    orgId,
    year,
    reportingPeriod: `${startYear}-07-01..${year}-06-30`,

    // Engagement with Reconciliation Australia (Q8–Q13)
    raSupportDevelop: "neutral",
    raSupportImplement: "neutral",
    rapStage: "developing",
    raEngagementRating: 1,
    raEventsAttended: "0",
    firstRapInLast12Months: "no",

    // Relationships (Q14–Q20)
    hasEngagementStrategy: false,
    partnerships: { formal: 0, informal: 0 },
    partneredWith: [],
    nrwParticipation: [],
    nrwEventsHosted: { internal: 0, external: 0 },
    staffEngagementStrategy: "unsure",
    antiDiscrimination: "unsure",

    // Respect (Q21–Q25)
    culturalLearningStrategy: "unsure",
    culturalLearning: { elearning: 0, faceToFace: 0, immersion: 0 },
    hasCulturalProtocolsDoc: false,
    changedExternalPractices: false,
    changedInternalPractices: false,

    // Opportunities (Q26–Q37)
    hasEmploymentStrategy: false,
    employmentTarget: { hasTarget: false, overall: 0, leadership: 0 },
    indigenousStaff: {
      total: null,
      breakdown: {
        permanent: 0,
        nonOngoing: 0,
        casual: 0,
        apprenticeships: 0,
        traineeships: 0,
        contractors: 0,
      },
    },
    indigenousStaffByLevel: {
      board: 0,
      councillors: 0,
      seniorExec: 0,
      middleManagement: 0,
      entryLevel: 0,
    },
    procurementRange: "0-5k",
    procurementTotal: 0,
    procurementSupplyNationCertified: 0,
    businessesContracted: 0,
    supplyNationMember: false,
    donations: 0,
    education: { scholarships: 0, contributions: 0 },
    proBono: { hours: 0, dollarValue: 0 },

    // Governance (Q38–Q39)
    governanceStructures: ["none"],
    seniorLeaderEngagement: 1,

    submittedAt: now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-survey-defaults.ts`
Expected: prints `ok: survey-defaults`, exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/survey/defaults.ts scripts/test-survey-defaults.ts
git commit -m "feat(survey): blank Organization/SurveyResponse factories for create-on-save

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Form parse + merge logic (`context-form.ts`)

Pure functions that parse `FormData` into a typed patch and overlay it onto a base object. This is the testable heart of the validation rules.

**Files:**
- Create: `src/lib/survey/context-form.ts`
- Create: `scripts/test-survey-context-form.ts`

**Interfaces:**
- Consumes: `Organization`, `SurveyResponse`, `Industry`, `RapType`, `Rating1to5`, `GovernanceStructure` from `./types`.
- Produces:
  - `type ProfilePatch`, `type ContextPatch`
  - `parseProfileForm(fd: FormData): ProfilePatch`
  - `parseContextForm(fd: FormData): ContextPatch`
  - `applyProfilePatch(base: Organization, patch: ProfilePatch): Organization`
  - `applyContextPatch(base: SurveyResponse, patch: ContextPatch): SurveyResponse`
- Rules encoded: numbers non-finite/negative → `undefined` (keep base); text empty → `undefined` (keep base); booleans/selects always set; `staffNotCollected=true` → `total: null`; governance empty → `["none"]`; `partneredWith` comma-split/trim/drop-empties; engagement clamped to 1–5.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-survey-context-form.ts`:

```ts
import assert from "node:assert/strict";
import {
  parseProfileForm,
  parseContextForm,
  applyProfilePatch,
  applyContextPatch,
} from "../src/lib/survey/context-form";
import { blankOrganization, blankResponse } from "../src/lib/survey/defaults";

const now = "2026-06-18T00:00:00.000Z";

// --- profile: parse + apply overwrites the slice, preserves the rest ---
const orgBase = { ...blankOrganization("org-acme", now), totalStudents: 7 };
const pf = new FormData();
pf.set("industry", "mining");
pf.set("latestRapType", "stretch");
pf.set("totalEmployees", "1200");
pf.set("asx200", "true");
pf.set("contactName", "  Dana Whitefeather ");
pf.set("contactEmail", "dana@acme.example");
const org = applyProfilePatch(orgBase, parseProfileForm(pf));
assert.equal(org.industry, "mining");
assert.equal(org.latestRapType, "stretch");
assert.equal(org.totalEmployees, 1200);
assert.equal(org.asx200, true);
assert.equal(org.contactName, "Dana Whitefeather");
assert.equal(org.contactEmail, "dana@acme.example");
assert.equal(org.totalStudents, 7); // un-surfaced field preserved
assert.equal(org.createdAt, now);

// unchecked checkbox → false; blank/negative number → keep base; empty text → keep base
const orgBase2 = { ...blankOrganization("org-acme", now), totalEmployees: 50, asx200: true, contactName: "Prior" };
const pf2 = new FormData();
pf2.set("industry", "retail");
pf2.set("latestRapType", "reflect");
pf2.set("totalEmployees", ""); // blank → keep base
pf2.set("contactName", "   ");  // whitespace → keep base
pf2.set("contactEmail", "");    // blank → keep base
// asx200 absent → false
const org2 = applyProfilePatch(orgBase2, parseProfileForm(pf2));
assert.equal(org2.totalEmployees, 50);
assert.equal(org2.asx200, false);
assert.equal(org2.contactName, "Prior");

// --- context: parse + apply ---
const rBase = blankResponse("org-acme", "2025", now);
const cf = new FormData();
cf.set("staffTotal", "210");
cf.set("board", "1");
cf.set("seniorExec", "4");
cf.set("middleManagement", "35");
cf.set("entryLevel", "170");
cf.set("clElearning", "8000");
cf.set("clFaceToFace", "1500");
cf.set("clImmersion", "40");
cf.set("hasCulturalProtocolsDoc", "true");
cf.set("hasEmploymentStrategy", "true");
cf.append("governanceStructures", "internal_employee_group");
cf.append("governanceStructures", "external_advisory");
cf.set("seniorLeaderEngagement", "5");
cf.set("partnershipsFormal", "4");
cf.set("partnershipsInformal", "2");
cf.set("partneredWith", "Supply Nation, CareerTrackers ,, Jawun");
const r = applyContextPatch(rBase, parseContextForm(cf));
assert.equal(r.indigenousStaff.total, 210);
assert.equal(r.indigenousStaffByLevel.board, 1);
assert.equal(r.indigenousStaffByLevel.entryLevel, 170);
assert.equal(r.indigenousStaffByLevel.councillors, 0); // untouched field preserved
assert.deepEqual(r.culturalLearning, { elearning: 8000, faceToFace: 1500, immersion: 40 });
assert.equal(r.hasCulturalProtocolsDoc, true);
assert.equal(r.hasEmploymentStrategy, true);
assert.deepEqual(r.governanceStructures, ["internal_employee_group", "external_advisory"]);
assert.equal(r.seniorLeaderEngagement, 5);
assert.deepEqual(r.partnerships, { formal: 4, informal: 2 });
assert.deepEqual(r.partneredWith, ["Supply Nation", "CareerTrackers", "Jawun"]);
assert.equal(r.procurementTotal, 0); // un-surfaced field preserved

// "not collected" wins over the number; empty governance → ["none"]
const cf2 = new FormData();
cf2.set("staffTotal", "999");
cf2.set("staffNotCollected", "true");
cf2.set("seniorLeaderEngagement", "9"); // out of range → keep base (1)
cf2.set("partneredWith", "");
const r2 = applyContextPatch(blankResponse("org-acme", "2025", now), parseContextForm(cf2));
assert.equal(r2.indigenousStaff.total, null);
assert.deepEqual(r2.governanceStructures, ["none"]);
assert.equal(r2.seniorLeaderEngagement, 1);
assert.deepEqual(r2.partneredWith, []);

console.log("ok: survey-context-form");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-survey-context-form.ts`
Expected: FAIL — `Cannot find module '../src/lib/survey/context-form'`.

- [ ] **Step 3: Write the parse + merge module**

Create `src/lib/survey/context-form.ts`:

```ts
// Pure parse + merge for the editable context slice. The server actions
// (actions.ts) are thin shells around these. Validation is light and silent:
// bad numeric/text input yields `undefined`, and applyXPatch keeps the base
// value for undefined fields (never wipes). Booleans and selects always set.
import type {
  GovernanceStructure,
  Industry,
  Organization,
  RapType,
  Rating1to5,
  SurveyResponse,
} from "./types";

// --- helpers ---------------------------------------------------------------
// A non-negative integer, or undefined when blank/invalid (→ keep base value).
function num(fd: FormData, key: string): number | undefined {
  const raw = fd.get(key);
  if (raw === null || String(raw).trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

// Trimmed string, or undefined when empty (→ keep base value).
function text(fd: FormData, key: string): string | undefined {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? undefined : v;
}

function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "true";
}

const VALID_GOVERNANCE: GovernanceStructure[] = [
  "internal_employee_group",
  "external_advisory",
  "consulted",
  "formal_evaluation",
  "none",
  "other",
];

// --- profile (Section A → Organization) ------------------------------------
export interface ProfilePatch {
  industry: Industry;
  latestRapType: RapType;
  totalEmployees: number | undefined;
  asx200: boolean;
  contactName: string | undefined;
  contactEmail: string | undefined;
}

export function parseProfileForm(fd: FormData): ProfilePatch {
  return {
    industry: String(fd.get("industry") ?? "unspecified") as Industry,
    latestRapType: String(fd.get("latestRapType") ?? "reflect") as RapType,
    totalEmployees: num(fd, "totalEmployees"),
    asx200: bool(fd, "asx200"),
    contactName: text(fd, "contactName"),
    contactEmail: text(fd, "contactEmail"),
  };
}

export function applyProfilePatch(base: Organization, patch: ProfilePatch): Organization {
  return {
    ...base,
    industry: patch.industry,
    latestRapType: patch.latestRapType,
    totalEmployees: patch.totalEmployees ?? base.totalEmployees,
    asx200: patch.asx200,
    contactName: patch.contactName ?? base.contactName,
    contactEmail: patch.contactEmail ?? base.contactEmail,
  };
}

// --- context (Sections C + D → SurveyResponse) ------------------------------
export interface ContextPatch {
  // C
  staffTotal: number | null | undefined; // null = "not collected"; undefined = keep base
  board: number | undefined;
  seniorExec: number | undefined;
  middleManagement: number | undefined;
  entryLevel: number | undefined;
  clElearning: number | undefined;
  clFaceToFace: number | undefined;
  clImmersion: number | undefined;
  hasCulturalProtocolsDoc: boolean;
  hasEmploymentStrategy: boolean;
  // D
  governanceStructures: GovernanceStructure[];
  seniorLeaderEngagement: Rating1to5 | undefined;
  partnershipsFormal: number | undefined;
  partnershipsInformal: number | undefined;
  partneredWith: string[];
}

export function parseContextForm(fd: FormData): ContextPatch {
  const notCollected = bool(fd, "staffNotCollected");
  const staffTotal = notCollected ? null : num(fd, "staffTotal");

  const governance = fd
    .getAll("governanceStructures")
    .map(String)
    .filter((g): g is GovernanceStructure => VALID_GOVERNANCE.includes(g as GovernanceStructure));

  const engagementRaw = num(fd, "seniorLeaderEngagement");
  const seniorLeaderEngagement =
    engagementRaw !== undefined && engagementRaw >= 1 && engagementRaw <= 5
      ? (engagementRaw as Rating1to5)
      : undefined;

  const partneredWith = String(fd.get("partneredWith") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    staffTotal,
    board: num(fd, "board"),
    seniorExec: num(fd, "seniorExec"),
    middleManagement: num(fd, "middleManagement"),
    entryLevel: num(fd, "entryLevel"),
    clElearning: num(fd, "clElearning"),
    clFaceToFace: num(fd, "clFaceToFace"),
    clImmersion: num(fd, "clImmersion"),
    hasCulturalProtocolsDoc: bool(fd, "hasCulturalProtocolsDoc"),
    hasEmploymentStrategy: bool(fd, "hasEmploymentStrategy"),
    governanceStructures: governance.length ? governance : ["none"],
    seniorLeaderEngagement,
    partnershipsFormal: num(fd, "partnershipsFormal"),
    partnershipsInformal: num(fd, "partnershipsInformal"),
    partneredWith,
  };
}

export function applyContextPatch(base: SurveyResponse, patch: ContextPatch): SurveyResponse {
  return {
    ...base,
    indigenousStaff: {
      ...base.indigenousStaff,
      total: patch.staffTotal === undefined ? base.indigenousStaff.total : patch.staffTotal,
    },
    indigenousStaffByLevel: {
      ...base.indigenousStaffByLevel,
      board: patch.board ?? base.indigenousStaffByLevel.board,
      seniorExec: patch.seniorExec ?? base.indigenousStaffByLevel.seniorExec,
      middleManagement: patch.middleManagement ?? base.indigenousStaffByLevel.middleManagement,
      entryLevel: patch.entryLevel ?? base.indigenousStaffByLevel.entryLevel,
    },
    culturalLearning: {
      elearning: patch.clElearning ?? base.culturalLearning.elearning,
      faceToFace: patch.clFaceToFace ?? base.culturalLearning.faceToFace,
      immersion: patch.clImmersion ?? base.culturalLearning.immersion,
    },
    hasCulturalProtocolsDoc: patch.hasCulturalProtocolsDoc,
    hasEmploymentStrategy: patch.hasEmploymentStrategy,
    governanceStructures: patch.governanceStructures,
    seniorLeaderEngagement: patch.seniorLeaderEngagement ?? base.seniorLeaderEngagement,
    partnerships: {
      formal: patch.partnershipsFormal ?? base.partnerships.formal,
      informal: patch.partnershipsInformal ?? base.partnerships.informal,
    },
    partneredWith: patch.partneredWith,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-survey-context-form.ts`
Expected: prints `ok: survey-context-form`, exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/survey/context-form.ts scripts/test-survey-context-form.ts
git commit -m "feat(survey): pure parse+merge for editable context slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Server actions (`actions.ts`)

Thin `"use server"` shells: derive identity, load-or-blank, apply patch, persist, revalidate, redirect.

**Files:**
- Create: `src/lib/survey/actions.ts`

**Interfaces:**
- Consumes: `surveyRepo` from `./index`; `blankOrganization`/`blankResponse` from `./defaults`; the four functions from `./context-form`.
- Produces:
  - `updateProfileAction(formData: FormData): Promise<void>`
  - `updateContextAction(formData: FormData): Promise<void>`
  - Both read hidden fields `orgId`, `companyId` (and `year` for context); no-op on missing `orgId`; redirect to `/report?as=<companyId>`.

- [ ] **Step 1: Write the actions**

Create `src/lib/survey/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { surveyRepo } from "./index";
import { blankOrganization, blankResponse } from "./defaults";
import {
  parseProfileForm,
  parseContextForm,
  applyProfilePatch,
  applyContextPatch,
} from "./context-form";

// Section A: edit the organisation profile. Load-or-blank → overlay → persist.
export async function updateProfileAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!orgId) return; // identity guard — silent no-op

  const now = new Date().toISOString();
  const base = (await surveyRepo.getOrganization(orgId)) ?? blankOrganization(orgId, now);
  const merged = applyProfilePatch(base, parseProfileForm(formData));
  await surveyRepo.putOrganization(merged);

  revalidatePath("/report");
  redirect(companyId ? `/report?as=${companyId}` : "/report");
}

// Sections C + D: edit self-report context. Load-or-blank → overlay → persist.
export async function updateContextAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const year = String(formData.get("year") ?? "2025").trim();
  if (!orgId) return; // identity guard — silent no-op

  const now = new Date().toISOString();
  const base = (await surveyRepo.getResponse(orgId, year)) ?? blankResponse(orgId, year, now);
  const merged = applyContextPatch(base, parseContextForm(formData));
  await surveyRepo.putResponse(merged);

  revalidatePath("/report");
  redirect(companyId ? `/report?as=${companyId}` : "/report");
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/survey/actions.ts
git commit -m "feat(survey): server actions for editable profile + context (load-merge-write)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Profile edit form (`ProfileForm.tsx`)

Client form for Section A. Pre-filled from the current org (or blank defaults when none).

**Files:**
- Create: `src/app/report/ProfileForm.tsx`

**Interfaces:**
- Consumes: `updateProfileAction` from `@/lib/survey/actions`; `Organization`, `Industry`, `RapType` types.
- Produces: `ProfileForm({ companyId, orgId, org }: { companyId: string; orgId: string; org?: Organization })` — a `<form action={updateProfileAction}>`.

- [ ] **Step 1: Write the component**

Create `src/app/report/ProfileForm.tsx`:

```tsx
"use client";

import { updateProfileAction } from "@/lib/survey/actions";
import type { Industry, Organization, RapType } from "@/lib/survey";

// Q2 industries (value → label). Ordered for the dropdown; "unspecified" is the
// blank placeholder and is not offered as a real choice.
const INDUSTRY_OPTIONS: { value: Industry; label: string }[] = [
  { value: "architecture", label: "Architecture" },
  { value: "arts_culture", label: "Arts & culture" },
  { value: "community_dev", label: "Community development" },
  { value: "construction", label: "Construction" },
  { value: "consulting", label: "Consulting" },
  { value: "education", label: "Education" },
  { value: "environment", label: "Environment" },
  { value: "finance_insurance", label: "Finance & insurance" },
  { value: "governance", label: "Governance" },
  { value: "health", label: "Health" },
  { value: "legal", label: "Legal" },
  { value: "marketing", label: "Marketing" },
  { value: "media", label: "Media" },
  { value: "mining", label: "Mining" },
  { value: "property", label: "Property" },
  { value: "recruitment", label: "Recruitment" },
  { value: "retail", label: "Retail" },
  { value: "safety_security", label: "Safety & security" },
  { value: "science_tech_eng", label: "Science, tech & engineering" },
  { value: "social_services", label: "Social services" },
  { value: "sport", label: "Sport" },
  { value: "tourism", label: "Tourism" },
  { value: "transport", label: "Transport" },
];

const RAP_OPTIONS: { value: RapType; label: string }[] = [
  { value: "reflect", label: "Reflect" },
  { value: "innovate", label: "Innovate" },
  { value: "stretch", label: "Stretch" },
  { value: "elevate", label: "Elevate" },
];

const inputCls = "w-full bg-bg border border-ink/15 rounded px-2 py-2";
const labelCls = "text-ink3 text-xs uppercase tracking-widest";

export function ProfileForm({
  companyId,
  orgId,
  org,
}: {
  companyId: string;
  orgId: string;
  org?: Organization;
}) {
  const industry: Industry = org?.industry ?? "unspecified";
  return (
    <section>
      <div className="flex items-center gap-3 mb-2">
        <span className={labelCls}>A · Organisation profile</span>
        <span className="text-ink3 text-xs">editing</span>
      </div>
      <form
        action={updateProfileAction}
        className="bg-panel rounded border border-line shadow-card p-5 space-y-4"
      >
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="companyId" value={companyId} />

        <div className="grid sm:grid-cols-3 gap-4">
          <label className="space-y-1">
            <span className={labelCls}>Industry</span>
            <select name="industry" defaultValue={industry} className={inputCls}>
              <option value="unspecified" disabled>
                Select an industry…
              </option>
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelCls}>Latest RAP type</span>
            <select name="latestRapType" defaultValue={org?.latestRapType ?? "reflect"} className={inputCls}>
              {RAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelCls}>Employees</span>
            <input
              name="totalEmployees"
              type="number"
              min="0"
              step="1"
              defaultValue={org?.totalEmployees ?? 0}
              className={inputCls}
            />
          </label>

          <label className="flex items-center gap-2 text-ink2 text-sm">
            <input type="checkbox" name="asx200" value="true" defaultChecked={org?.asx200 ?? false} />
            Listed (TSX 200)
          </label>

          <label className="space-y-1">
            <span className={labelCls}>Primary contact</span>
            <input name="contactName" type="text" defaultValue={org?.contactName ?? ""} className={inputCls} />
          </label>

          <label className="space-y-1">
            <span className={labelCls}>Contact email</span>
            <input name="contactEmail" type="email" defaultValue={org?.contactEmail ?? ""} className={inputCls} />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
            Save profile
          </button>
          <a className="text-ink3 underline text-sm" href={`/report?as=${companyId}`}>
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/report/ProfileForm.tsx
git commit -m "feat(report): ProfileForm — editable Section A

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Context edit form (`ContextForm.tsx`)

Client form for Sections C + D. Pre-filled from the current response (or blank defaults when none). Keeps the unverified stamp.

**Files:**
- Create: `src/app/report/ContextForm.tsx`

**Interfaces:**
- Consumes: `updateContextAction` from `@/lib/survey/actions`; `SurveyResponse`, `GovernanceStructure` types.
- Produces: `ContextForm({ companyId, orgId, year, survey }: { companyId: string; orgId: string; year: string; survey?: SurveyResponse })` — a `<form action={updateContextAction}>`.

- [ ] **Step 1: Write the component**

Create `src/app/report/ContextForm.tsx`:

```tsx
"use client";

import { updateContextAction } from "@/lib/survey/actions";
import type { GovernanceStructure, SurveyResponse } from "@/lib/survey";

const GOVERNANCE_OPTIONS: { value: GovernanceStructure; label: string }[] = [
  { value: "internal_employee_group", label: "Internal employee group" },
  { value: "external_advisory", label: "External advisory body" },
  { value: "consulted", label: "Consulted on RAP" },
  { value: "formal_evaluation", label: "Formal evaluation process" },
  { value: "other", label: "Other" },
];

const inputCls = "w-full bg-bg border border-ink/15 rounded px-2 py-2";
const labelCls = "text-ink3 text-xs uppercase tracking-widest";

export function ContextForm({
  companyId,
  orgId,
  year,
  survey,
}: {
  companyId: string;
  orgId: string;
  year: string;
  survey?: SurveyResponse;
}) {
  const byLevel = survey?.indigenousStaffByLevel;
  const cl = survey?.culturalLearning;
  const selectedGov = new Set(survey?.governanceStructures ?? []);
  const staffTotal = survey?.indigenousStaff.total ?? null;

  return (
    <div className="space-y-6">
      <form
        action={updateContextAction}
        className="bg-panel/60 rounded border border-line p-5 space-y-6"
      >
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="year" value={year} />

        {/* C · Workforce & culture */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={labelCls}>C · Workforce & culture</span>
            <span className="text-[0.6rem] uppercase tracking-wider border border-ink3/40 text-ink3 rounded px-1.5 py-0.5">
              self-reported · unverified
            </span>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <label className="space-y-1">
              <span className={labelCls}>Indigenous staff (total)</span>
              <input
                name="staffTotal"
                type="number"
                min="0"
                step="1"
                defaultValue={staffTotal ?? ""}
                className={inputCls}
              />
            </label>
            <label className="flex items-center gap-2 text-ink2 text-sm">
              <input type="checkbox" name="staffNotCollected" value="true" defaultChecked={staffTotal === null} />
              We do not collect this
            </label>
            <div />

            <label className="space-y-1">
              <span className={labelCls}>Board</span>
              <input name="board" type="number" min="0" step="1" defaultValue={byLevel?.board ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Senior exec</span>
              <input name="seniorExec" type="number" min="0" step="1" defaultValue={byLevel?.seniorExec ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Middle management</span>
              <input name="middleManagement" type="number" min="0" step="1" defaultValue={byLevel?.middleManagement ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Entry level</span>
              <input name="entryLevel" type="number" min="0" step="1" defaultValue={byLevel?.entryLevel ?? 0} className={inputCls} />
            </label>

            <label className="space-y-1">
              <span className={labelCls}>Cultural learning — e-learning (hrs)</span>
              <input name="clElearning" type="number" min="0" step="1" defaultValue={cl?.elearning ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Face-to-face (hrs)</span>
              <input name="clFaceToFace" type="number" min="0" step="1" defaultValue={cl?.faceToFace ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Immersion (hrs)</span>
              <input name="clImmersion" type="number" min="0" step="1" defaultValue={cl?.immersion ?? 0} className={inputCls} />
            </label>

            <label className="flex items-center gap-2 text-ink2 text-sm">
              <input type="checkbox" name="hasCulturalProtocolsDoc" value="true" defaultChecked={survey?.hasCulturalProtocolsDoc ?? false} />
              Cultural protocols doc
            </label>
            <label className="flex items-center gap-2 text-ink2 text-sm">
              <input type="checkbox" name="hasEmploymentStrategy" value="true" defaultChecked={survey?.hasEmploymentStrategy ?? false} />
              Employment strategy
            </label>
          </div>
        </div>

        {/* D · Governance & relationships */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={labelCls}>D · Governance & relationships</span>
            <span className="text-[0.6rem] uppercase tracking-wider border border-ink3/40 text-ink3 rounded px-1.5 py-0.5">
              self-reported · unverified
            </span>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <fieldset className="sm:col-span-3 space-y-1">
              <legend className={labelCls}>Governance structures</legend>
              <div className="flex flex-wrap gap-3">
                {GOVERNANCE_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-ink2 text-sm">
                    <input
                      type="checkbox"
                      name="governanceStructures"
                      value={o.value}
                      defaultChecked={selectedGov.has(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="space-y-1">
              <span className={labelCls}>Senior-leader engagement (1–5)</span>
              <select name="seniorLeaderEngagement" defaultValue={String(survey?.seniorLeaderEngagement ?? 1)} className={inputCls}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Partnerships — formal</span>
              <input name="partnershipsFormal" type="number" min="0" step="1" defaultValue={survey?.partnerships.formal ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Partnerships — informal</span>
              <input name="partnershipsInformal" type="number" min="0" step="1" defaultValue={survey?.partnerships.informal ?? 0} className={inputCls} />
            </label>

            <label className="sm:col-span-3 space-y-1">
              <span className={labelCls}>Partnered with (comma-separated)</span>
              <input
                name="partneredWith"
                type="text"
                defaultValue={(survey?.partneredWith ?? []).join(", ")}
                placeholder="Supply Nation, CareerTrackers, Jawun"
                className={inputCls}
              />
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
            Save context
          </button>
          <a className="text-ink3 underline text-sm" href={`/report?as=${companyId}`}>
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/report/ContextForm.tsx
git commit -m "feat(report): ContextForm — editable Sections C + D

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Wire the toggle into the page + Edit affordances

Add `?edit=` branching to the page and Edit links to the read-only cards. Final in-browser verification.

**Files:**
- Modify: `src/app/report/page.tsx`
- Modify: `src/app/report/ContextSections.tsx`

**Interfaces:**
- Consumes: `ProfileForm`, `ContextForm`, `ProfileCard`, `ContextBlocks`; `companyToOrgId`, `SURVEY_YEAR`.
- Produces: final page behaviour — read-only by default, forms under `?edit=profile|context`.

- [ ] **Step 1: Accept `edit` in searchParams and branch each section**

In `src/app/report/page.tsx`:

(a) Add the imports near the existing ones:

```tsx
import { ProfileForm } from "./ProfileForm";
import { ContextForm } from "./ContextForm";
```

(b) Widen the `searchParams` type and read `edit`:

```tsx
export default async function ReportPage({
  searchParams,
}: {
  searchParams: { as?: string; edit?: string };
}) {
  const companyId = partyIdFrom(searchParams);
  const edit = searchParams.edit;
```

(c) Replace the Section A render line (`{org ? <ProfileCard org={org} /> : null}`) with:

```tsx
      {/* A · Organisation profile (self-report) — read-only card or edit form */}
      {edit === "profile" ? (
        <ProfileForm companyId={companyId} orgId={orgId} org={org ?? undefined} />
      ) : (
        <ProfileCard org={org ?? undefined} companyId={companyId} />
      )}
```

(d) Replace the Section C/D render line (`{survey ? <ContextBlocks survey={survey} /> : null}`) with:

```tsx
      {/* C / D · self-report context — read-only blocks or edit form */}
      {edit === "context" ? (
        <ContextForm
          companyId={companyId}
          orgId={orgId}
          year={SURVEY_YEAR}
          survey={survey ?? undefined}
        />
      ) : (
        <ContextBlocks survey={survey ?? undefined} companyId={companyId} />
      )}
```

- [ ] **Step 2: Make the read-only renderers accept absence + show an Edit link**

In `src/app/report/ContextSections.tsx`, update both exported components so they always render (with an Edit affordance) even when data is absent.

(a) Change `ProfileCard` to accept an optional org + `companyId` and render an empty-state when absent:

```tsx
export function ProfileCard({ org, companyId }: { org?: Organization; companyId: string }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-ink3 text-xs uppercase tracking-widest">A · Organisation profile</span>
        <a className="ml-auto text-ink3 underline text-sm" href={`/report?as=${companyId}&edit=profile`}>
          {org ? "Edit" : "Add profile"}
        </a>
      </div>
      {org ? (
        <div className="bg-panel rounded border border-line shadow-card p-5 grid sm:grid-cols-3 gap-4">
          <Field label="Industry" value={humanIndustry(org.industry)} />
          <Field label="Latest RAP type" value={rapTypeLabels[org.latestRapType]} />
          <Field label="Employees" value={org.totalEmployees.toLocaleString("en-CA")} />
          <Field label="Listed (TSX 200)" value={org.asx200 ? "Yes" : "No"} />
          <Field label="Primary contact" value={org.contactName || "—"} />
          <Field label="Contact email" value={org.contactEmail || "—"} />
        </div>
      ) : (
        <p className="text-ink3">No profile yet. Add one to describe this organisation.</p>
      )}
    </section>
  );
}
```

(b) Change `ContextBlocks` to accept an optional survey + `companyId`, with an Edit link in each section header and an empty-state when absent. Replace the existing `ContextBlocks` with:

```tsx
export function ContextBlocks({ survey, companyId }: { survey?: SurveyResponse; companyId: string }) {
  const editHref = `/report?as=${companyId}&edit=context`;

  if (!survey) {
    return (
      <section>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-ink3 text-xs uppercase tracking-widest">C / D · Context</span>
          <a className="ml-auto text-ink3 underline text-sm" href={editHref}>
            Add context
          </a>
        </div>
        <p className="text-ink3">No self-reported context yet. Add workforce, culture, and governance details.</p>
      </section>
    );
  }

  const staff = survey.indigenousStaff;
  const byLevel = survey.indigenousStaffByLevel;
  const cl = survey.culturalLearning;

  return (
    <div className="space-y-6">
      {/* C · Workforce & culture */}
      <section>
        <div className="flex items-center gap-3 mb-2">
          <SectionHeader letter="C" title="Workforce & culture" stamped />
          <a className="ml-auto text-ink3 underline text-sm" href={editHref}>
            Edit
          </a>
        </div>
        <div className="bg-panel/60 rounded border border-line p-5 grid sm:grid-cols-3 gap-4">
          <Field
            label="Indigenous staff"
            value={staff.total === null ? "Not collected" : staff.total.toLocaleString("en-CA")}
          />
          <Field label="Senior exec / board" value={`${byLevel.seniorExec} exec · ${byLevel.board} board`} />
          <Field label="Mgmt / entry-level" value={`${byLevel.middleManagement} · ${byLevel.entryLevel}`} />
          <Field
            label="Cultural learning (hrs)"
            value={`${(cl.elearning + cl.faceToFace + cl.immersion).toLocaleString("en-CA")} total`}
          />
          <Field label="Cultural protocols doc" value={survey.hasCulturalProtocolsDoc ? "Yes" : "No"} />
          <Field label="Employment strategy" value={survey.hasEmploymentStrategy ? "Yes" : "No"} />
        </div>
      </section>

      {/* D · Governance & relationships */}
      <section>
        <SectionHeader letter="D" title="Governance & relationships" stamped />
        <div className="bg-panel/60 rounded border border-line p-5 grid sm:grid-cols-3 gap-4">
          <Field
            label="Governance structures"
            value={
              survey.governanceStructures.length
                ? survey.governanceStructures.map((g) => governanceLabels[g] ?? g).join(", ")
                : "None"
            }
          />
          <Field label="Senior-leader engagement" value={`${survey.seniorLeaderEngagement} / 5`} />
          <Field
            label="Partnerships"
            value={`${survey.partnerships.formal} formal · ${survey.partnerships.informal} informal`}
          />
          {survey.partneredWith.length ? (
            <div className="sm:col-span-3">
              <Field label="Partnered with" value={survey.partneredWith.join(", ")} />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2b: Confirm `Organization`/`SurveyResponse` are imported in ContextSections.tsx**

These types are already imported at the top of the file (`import type { Industry, Organization, RapType, SurveyResponse } from "@/lib/survey";`). No change needed — verify the line is present.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles, type-check passes, `/report` listed in the route table, exit 0.

- [ ] **Step 4: In-browser verification**

Start the dev server (`npm run dev`) and check, in a browser tab:

1. `/report?as=c-cedartrust` → A/C/D render read-only with the unverified stamp on C/D, each with an "Edit" link.
2. Click A's "Edit" (`?edit=profile`) → form pre-filled; change Employees + Industry → **Save profile** → redirected to read-only view showing the new values. Reload → values persist (within the dev server process).
3. C/D "Edit" (`?edit=context`) → check "We do not collect this" and change the governance checkboxes + partnered-with → **Save context** → read-only view reflects "Not collected" and the new governance list.
4. `/report?as=c-northway` (no survey org) → A shows "Add profile", C/D shows "Add context". Click "Add profile" → fill + Save → new org created, profile now populated. Same for "Add context".
5. Confirm Section B, `/coverage?as=c-cedartrust`, and `/analytics` are unchanged (context never flows to the Index).
6. Open the browser console — no app errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/report/page.tsx src/app/report/ContextSections.tsx
git commit -m "feat(report): edit toggle + Edit affordances wire context editing into /report

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin feat/editable-context-sections
gh pr create --base main --title "Questionnaire: editable + persisted profile + context sections (A/C/D)" --body "$(cat <<'EOF'
## Summary
Makes the `/report` questionnaire's profile (A) and self-report context (C/D) sections editable and persisted through the survey repo seam, for any logged-in company. Follows PR #21 (read-only sections).

- `?edit=profile|context` search-param toggle swaps the read-only card for a client form.
- Load-merge-write through `surveyRepo` preserves all un-surfaced Q8–Q41 fields (Option B stays additive).
- Create-on-save: companies with no survey org yet (e.g. Northway) build one from neutral defaults on first save.
- Context stays self-report — keeps the "self-reported · unverified" stamp and never flows to coverage/Index.

## Scope
Option A (the displayed slice) only — no inputs for the ~28 un-surfaced survey fields. No coverage/Index/Section B changes. No DynamoDB/deploy changes.

## Verification
- Pure logic covered by `scripts/test-survey-defaults.ts` and `scripts/test-survey-context-form.ts` (`npx tsx`).
- `npm run build` green; in-browser checks for Cedar Trust (edit) and Northway (create-on-save).

Spec: `docs/superpowers/specs/2026-06-18-editable-context-sections-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Editable field set (A / C / D slice) → Tasks 5, 6 (forms), Task 3 (parse/merge). ✓
- Server actions / load-merge-write → Task 4. ✓
- Default factory (create-on-save) → Task 2. ✓
- Blank industry (`"unspecified"`) → Task 1. ✓
- Search-param toggle + per-entity split → Task 7. ✓
- Validation rules (silent no-op, null staff total, governance empty→none, partnered-with split, identity guard) → Tasks 3 (logic) + 4 (guard). ✓
- Unverified stamp retained on C/D edit + display → Tasks 6, 7. ✓
- Persistence assumption / no dynamo / moat untouched → Global Constraints; Task 7 step 4.5. ✓
- Verification (build + in-browser + tsx tests) → Tasks 2, 3 (tsx), Task 7 (build + browser). ✓

**Placeholder scan:** No "TBD"/"add validation"/"similar to Task N" — every code step shows complete code. ✓

**Type consistency:** `ProfilePatch`/`ContextPatch` field names used identically across Task 3 (definition), Task 4 (consumption is via the exported functions, not field access). Form `name` attributes in Tasks 5/6 match the keys read in `parseProfileForm`/`parseContextForm` (Task 3): `industry`, `latestRapType`, `totalEmployees`, `asx200`, `contactName`, `contactEmail`, `staffTotal`, `staffNotCollected`, `board`, `seniorExec`, `middleManagement`, `entryLevel`, `clElearning`, `clFaceToFace`, `clImmersion`, `hasCulturalProtocolsDoc`, `hasEmploymentStrategy`, `governanceStructures`, `seniorLeaderEngagement`, `partnershipsFormal`, `partnershipsInformal`, `partneredWith`, plus hidden `orgId`/`companyId`/`year`. ✓
- `ProfileCard`/`ContextBlocks` signatures changed to accept `companyId` + optional data — both call sites updated in Task 7. ✓
- `blankOrganization`/`blankResponse`/`updateProfileAction`/`updateContextAction` names consistent across Tasks 2, 4, 5, 6. ✓
