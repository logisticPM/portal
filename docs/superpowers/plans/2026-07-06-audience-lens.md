# Audience Lens (client idea #5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user-differentiated "View as" lens (Indigenous government / legal advisor / corporate) that reorders + reframes the same `/cases` corpus per audience — never filtering or hiding (governance: reads open to all).

**Architecture:** A pure `src/lib/cases/lenses.ts` (resolveLens / lensConfig / applyLens set-preserving reorder / lensHref) plus a zero-client-JS `LensSwitcher` in `ui.tsx`, wired into the browse page (reorder only when there's no search query) and a light framing line on the activation page.

**Tech Stack:** TypeScript, Next.js 14 RSC (zero client JS — anchors + server components), tsx + node:assert/strict.

**Spec:** `docs/specs/2026-07-06-audience-lens-design.md` — read it before starting.

---

## Context you must know (read once)

- **Repo root:** `C:\Users\chntw\Documents\7980\demo`. Branch: `feat/audience-lens` (Task 1 creates it from `main`, commits spec + plan).
- **Test convention:** standalone `scripts/test-cases-*.ts`, `node:assert/strict`, async IIFE (repo is NOT ESM). Run `npx tsx scripts/<file>.ts`. ALWAYS also `npm run typecheck`; for UI tasks `npm run build`.
- **NEVER run `npm run verify`** (freshSeed resets the local corpus). This change is presentation-only, additive; `dynamo≡mock` unaffected.
- **Seams:** `getSession()` from `@/lib/auth` → `{ kind: "company"|"supplier"|"indigenomics"; partyId? } | null`; `Session` type exported there. `LegalCase`/`Theme`/`CorpusTier`/`CourtLevel`/`WinType` from `@/lib/cases` (barrel) or `@/lib/cases/types`. `LegalCase` fields used: `themes: Theme[]`, `citingCount: number`, `level: CourtLevel`, `id`.
- **Browse page (`src/app/cases/page.tsx`) shape:** `searchParams: Record<string,string|undefined>`; `q = searchParams.q ?? ""`; `cases = q ? hybridSearch(...) : listCases(filter)`; renders `<CaseListItem>` per case. Imports `Link`, `casesRepo`, types, `CaseListItem` from `./ui`. Intro `<p>` at line ~30; result-count `<div>` at line ~59.
- **`src/app/cases/ui.tsx`** exports `TierBadge`, `CaseListItem`, `StatCard`, `Bar`, `ProvenanceFooter`, `FullTextReader` (all RSC, no "use client"). Add `LensSwitcher` here.
- Palette classes: amber / ink / ink2 / ink3 / line / panel / bg.
- Commit messages: conventional; NO Co-Authored-By trailer.

---

### Task 1: pure lens module

**Files:**
- Create: `src/lib/cases/lenses.ts`
- Create: `scripts/test-cases-lenses.ts`

- [ ] **Step 1: Branch + docs commit**

```bash
git checkout main && git pull && git checkout -b feat/audience-lens
git add docs/specs/2026-07-06-audience-lens-design.md docs/superpowers/plans/2026-07-06-audience-lens.md
git commit -m "docs: spec + plan for audience lens (client idea #5)"
```

- [ ] **Step 2: Write the failing test** — create `scripts/test-cases-lenses.ts`:

```ts
// Audience lens (spec 2026-07-06): resolve/config/reorder/href — all pure.
import assert from "node:assert/strict";

(async () => {
  const { resolveLens, lensConfig, applyLens, lensHref, LENSES } =
    await import("../src/lib/cases/lenses");
  type LC = import("../src/lib/cases/types").LegalCase;

  const mk = (id: string, themes: string[], citingCount: number, level = "provincial_superior"): LC => ({
    id, citation: id, styleOfCause: id, court: level, level: level as LC["level"], year: 2010,
    jurisdiction: "CA", nations: [], themes: themes as LC["themes"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "", holding: "" },
    casesCited: [], casesCiting: [], citingCount, enrichmentLevel: "index", corpusTier: "core",
    fullTextAvailable: true,
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026", unofficial: true },
  });

  // --- resolveLens: param wins; persona default; unknown ignored; logged-out → corporate ---
  assert.equal(resolveLens("legal_advisor", { kind: "company" }), "legal_advisor");
  assert.equal(resolveLens(undefined, { kind: "indigenomics" }), "indigenous_gov");
  assert.equal(resolveLens(undefined, { kind: "company" }), "corporate");
  assert.equal(resolveLens(undefined, { kind: "supplier" }), "corporate");
  assert.equal(resolveLens(undefined, null), "corporate");
  assert.equal(resolveLens("bogus", null), "corporate");
  assert.equal(resolveLens("indigenous_gov", null), "indigenous_gov"); // legal_advisor/indigenous_gov only via param when logged out

  // --- lensConfig: three lenses, shape ---
  assert.deepEqual(LENSES, ["indigenous_gov", "legal_advisor", "corporate"]);
  const ig = lensConfig("indigenous_gov");
  assert.ok(ig.label && ig.tagline && Array.isArray(ig.emphasisThemes));
  assert.ok(ig.emphasisThemes.includes("self_determination"));
  assert.equal(lensConfig("legal_advisor").sortByStrength, true);
  assert.deepEqual(lensConfig("legal_advisor").emphasisThemes, []);
  assert.ok(lensConfig("corporate").emphasisThemes.includes("duty_to_consult"));

  // --- applyLens: SET-PRESERVING permutation (no drops) ---
  const input = [
    mk("a", ["treaty"], 5),
    mk("b", ["self_determination", "land_rights"], 1),
    mk("c", [], 99),
    mk("d", ["resource_revenue"], 2),
  ];
  const out = applyLens(input, "indigenous_gov");
  assert.equal(out.length, input.length);
  assert.deepEqual([...out.map((x) => x.id)].sort(), ["a", "b", "c", "d"]); // same set
  // b (2 emphasis themes) and d (1) precede a and c (0 emphasis)
  assert.ok(out.findIndex((x) => x.id === "b") < out.findIndex((x) => x.id === "a"));
  assert.ok(out.findIndex((x) => x.id === "d") < out.findIndex((x) => x.id === "c"));
  // within the 0-emphasis group, higher citingCount first (c=99 before a=5)
  assert.ok(out.findIndex((x) => x.id === "c") < out.findIndex((x) => x.id === "a"));
  // b (2 matches) before d (1 match)
  assert.ok(out.findIndex((x) => x.id === "b") < out.findIndex((x) => x.id === "d"));

  // --- applyLens legal_advisor: court level then citingCount, theme-agnostic ---
  const byLevel = [mk("low", ["treaty"], 100, "tribunal"), mk("high", [], 1, "scc")];
  const la = applyLens(byLevel, "legal_advisor");
  assert.equal(la[0].id, "high", "SCC ranks above tribunal regardless of citingCount/theme");

  // --- applyLens is a pure copy (does not mutate input order) ---
  const before = input.map((x) => x.id).join(",");
  applyLens(input, "corporate");
  assert.equal(input.map((x) => x.id).join(","), before, "input not mutated");

  // --- lensHref: preserves params, sets lens, drops empties ---
  assert.equal(lensHref({ q: "treaty", tier: "all", theme: "" }, "corporate"),
    "/cases?q=treaty&tier=all&lens=corporate");
  assert.equal(lensHref({ lens: "corporate" }, "legal_advisor"), "/cases?lens=legal_advisor");
  assert.equal(lensHref({}, "indigenous_gov"), "/cases?lens=indigenous_gov");

  console.log("✅ test-cases-lenses passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run — must FAIL** (module not found): `npx tsx scripts/test-cases-lenses.ts`

- [ ] **Step 4: Create `src/lib/cases/lenses.ts`**

```ts
// Audience lens (spec 2026-07-06, client idea #5). A relevance lens over the SAME
// corpus: reorders + reframes per audience, never filters or hides (governance:
// reads open to all). All functions pure.
import type { LegalCase, Theme } from "./types";
import type { Session } from "@/lib/auth";

export type Lens = "indigenous_gov" | "legal_advisor" | "corporate";
export const LENSES: Lens[] = ["indigenous_gov", "legal_advisor", "corporate"];

export interface LensConfig {
  label: string;
  tagline: string;
  emphasisThemes: Theme[];
  sortByStrength: boolean; // legal_advisor: order by court level then citingCount
}

const CONFIGS: Record<Lens, LensConfig> = {
  indigenous_gov: {
    label: "Indigenous government",
    tagline: "Precedents affirming your community's economic rights and self-determination.",
    emphasisThemes: ["self_determination", "land_rights", "resource_revenue"],
    sortByStrength: false,
  },
  legal_advisor: {
    label: "Legal advisor",
    tagline: "Precedent strength and citation lineage — highest courts and most-cited first.",
    emphasisThemes: [],
    sortByStrength: true,
  },
  corporate: {
    label: "Corporate / advisory",
    tagline: "What consultation, accommodation and treaty obligations look like in practice.",
    emphasisThemes: ["duty_to_consult", "treaty", "fiduciary"],
    sortByStrength: false,
  },
};

export function lensConfig(lens: Lens): LensConfig { return CONFIGS[lens]; }

function isLens(v: string | undefined): v is Lens {
  return v === "indigenous_gov" || v === "legal_advisor" || v === "corporate";
}

// URL param wins; else map from the logged-in persona; else corporate (neutral,
// most general). legal_advisor has no persona → reachable only via the switcher.
export function resolveLens(param: string | undefined, session: Session | null): Lens {
  if (isLens(param)) return param;
  if (session?.kind === "indigenomics") return "indigenous_gov";
  return "corporate"; // company / supplier / logged-out
}

// Court-level strength rank (higher = stronger); unknown levels sort last.
const LEVEL_RANK: Record<string, number> = {
  scc: 6, fca: 5, provincial_appeal: 4, fc: 3, provincial_superior: 2, tribunal: 1,
};

// Pure, STABLE, SET-PRESERVING reorder (output is a permutation of input — never
// drops a case). Emphasis lenses: (# of case.themes in emphasisThemes, citingCount)
// descending. Strength lens: (court-level rank, citingCount) descending.
export function applyLens(cases: LegalCase[], lens: Lens): LegalCase[] {
  const cfg = CONFIGS[lens];
  const key = (c: LegalCase): [number, number] => {
    if (cfg.sortByStrength) return [LEVEL_RANK[c.level] ?? 0, c.citingCount];
    const emphasis = c.themes.filter((t) => cfg.emphasisThemes.includes(t)).length;
    return [emphasis, c.citingCount];
  };
  // decorate-sort-undecorate for a stable sort keyed on original index for ties
  return cases
    .map((c, i) => ({ c, i, k: key(c) }))
    .sort((a, b) => (b.k[0] - a.k[0]) || (b.k[1] - a.k[1]) || (a.i - b.i))
    .map((x) => x.c);
}

// Build a /cases href preserving current params, setting lens, dropping empties.
export function lensHref(current: Record<string, string | undefined>, lens: Lens): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (k === "lens") continue;
    if (v != null && v !== "") params.set(k, v);
  }
  params.set("lens", lens);
  return `/cases?${params.toString()}`;
}
```

- [ ] **Step 5: Run tests + typecheck** — `npx tsx scripts/test-cases-lenses.ts` → PASS; `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/lenses.ts scripts/test-cases-lenses.ts
git commit -m "feat(cases): audience lens module — resolve, config, set-preserving reorder, href"
```

---

### Task 2: LensSwitcher component + browse-page wiring

**Files:**
- Modify: `src/app/cases/ui.tsx` (add `LensSwitcher`)
- Modify: `src/app/cases/page.tsx`

- [ ] **Step 1: Add `LensSwitcher` to `src/app/cases/ui.tsx`**

At the top of the file it already imports `Link` from next? Check — if not, add `import Link from "next/link";`. Then add:

```tsx
import { LENSES, lensConfig, lensHref, type Lens } from "@/lib/cases/lenses";

export function LensSwitcher({ active, params }: { active: Lens; params: Record<string, string | undefined> }) {
  return (
    <div className="mt-3 rounded border border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink3">View as</span>
        {LENSES.map((l) => (
          <a
            key={l}
            href={lensHref(params, l)}
            className={
              l === active
                ? "rounded-full bg-amber/20 px-3 py-1 text-amber"
                : "rounded-full border border-line px-3 py-1 text-ink2 hover:border-amber/50 hover:text-amber"
            }
          >
            {lensConfig(l).label}
          </a>
        ))}
      </div>
      <p className="mt-1 text-xs text-ink3">
        {lensConfig(active).tagline} <span className="text-ink3">· The same public record, reordered for your context — anyone can switch; nothing is hidden.</span>
      </p>
    </div>
  );
}
```

(If `Link` is unused by the new component, don't add the import — the switcher uses plain `<a>` so query-param hrefs render as given without Next's client-side prefetch quirks on param-only changes. Plain `<a>` is intentional and matches the zero-JS convention.)

- [ ] **Step 2: Wire the browse page `src/app/cases/page.tsx`**

Add imports at the top:
```tsx
import { getSession } from "@/lib/auth";
import { resolveLens, applyLens } from "@/lib/cases/lenses";
import { LensSwitcher } from "./ui";
```
(extend the existing `./ui` import if present, e.g. `import { CaseListItem, LensSwitcher } from "./ui";`)

Inside the component, after computing `cases` (the `const cases = q ? ... : ...` line), add:
```tsx
  const session = getSession();
  const lens = resolveLens(searchParams.lens, session);
  // Lens reorders the BROWSE list only. When there's a search query, retrieval
  // ranking (dense/BM25) is authoritative — the lens contributes framing, not order.
  const ordered = q ? cases : applyLens(cases, lens);
```
Change the render loop to iterate `ordered` instead of `cases`:
```tsx
        {ordered.map((c) => <CaseListItem key={c.id} c={c} q={q} />)}
```
(and the empty-state check stays on `cases.length`/`ordered.length` — they're equal, use `ordered.length`).

Insert `<LensSwitcher active={lens} params={searchParams} />` directly AFTER the intro `<p>` (the "Canada's Indigenous economic-justice case law…" paragraph, ~line 30) and BEFORE the `<form>`.

- [ ] **Step 3: Verify** — `npm run typecheck` → clean; `npm run build` → `/cases` compiles; `npx tsx scripts/test-cases-lenses.ts` → still PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/cases/ui.tsx src/app/cases/page.tsx
git commit -m "feat(cases): LensSwitcher + browse reorder by audience lens (browse only; search keeps ranking)"
```

---

### Task 3: activation-page framing line

**Files:**
- Modify: `src/app/cases/activation/page.tsx`

- [ ] **Step 1: Read `src/app/cases/activation/page.tsx`** — note whether it already reads `searchParams` (if its signature has no `searchParams`, add `{ searchParams }: { searchParams: Record<string,string|undefined> }`), and find the top heading/intro area.

- [ ] **Step 2: Add the lens tagline** — imports:
```tsx
import { getSession } from "@/lib/auth";
import { resolveLens, lensConfig } from "@/lib/cases/lenses";
```
After the page's top heading, add a framing line (aggregates are audience-neutral — this is framing only, no data change):
```tsx
      <p className="mt-1 text-sm text-ink3">{lensConfig(resolveLens(searchParams?.lens, getSession())).tagline}</p>
```
(Use optional chaining on `searchParams?.lens` in case the existing signature omits it; if you added the param in Step 1, plain `searchParams.lens` is fine.)

- [ ] **Step 3: Verify** — `npm run typecheck` → clean; `npm run build` → `/cases/activation` compiles.

- [ ] **Step 4: Commit**

```bash
git add src/app/cases/activation/page.tsx
git commit -m "feat(cases): activation-page audience-lens framing line"
```

---

### Task 4: validation sweep + browser verification

**Files:** none (verification only)

- [ ] **Step 1: Battery**

```bash
npm run typecheck
npx tsx scripts/test-cases-lenses.ts
npx tsx scripts/test-cases-artifact.ts
npm run build
```
All green; `/cases` + `/cases/activation` compile. Do NOT run `npm run verify`.

- [ ] **Step 2: Spec coverage sweep** — confirm §1 (lenses.ts: resolveLens/lensConfig/applyLens/lensHref) → Task 1, §2 (browse wiring, no reorder on search) → Task 2, §3 (LensSwitcher + transparency note) → Task 2, §4 (activation framing) → Task 3, Governance (set-preserving assertion) → Task 1 test. Confirm no case-filtering was introduced anywhere (lens only reorders).

- [ ] **Step 3: Browser verification (Preview MCP)** — start the cases preview server, then:
  - Load `/cases` (no session cookie) → default lens is "Corporate / advisory" (selected), tagline present, transparency note present.
  - Click each "View as" lens → the browse list **reorders** and the result count is **unchanged** (no case dropped); URL gains `?lens=…`.
  - Load `/cases?q=treaty&lens=indigenous_gov` → results are in retrieval order (lens did NOT reorder search results), lens tagline still shown.
  - Set `document.cookie = "portal_session=indigenomics"` then load `/cases` → default lens is "Indigenous government".
  - Screenshot the switcher for the PR.

- [ ] **Step 4: Leave branch ready for PR.**

---

## Notes

Presentation-only, additive, no backend/credentials/deploy-time dependency; ships on merge (auto-deploy). No `npm run verify`. The governance invariant — the lens is a set-preserving reorder, never a filter — is enforced by the Task 1 permutation test and the "nothing is hidden" UI note.
