# Situation → Similar Cases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided situation intake (`/cases/similar`) that ranks the most similar core cases by an explainable, deterministic composite similarity, with match-strength honesty and a "research starting point, not a prediction" framing.

**Architecture:** A pure scoring module (`similarity.ts`) + a new case-level profile embedding (`pvec` on core PROFILE items) drive a `CaseRepo.findSimilarCases` seam method (dynamo embeds the narrative + scores using `pvec`; mock is structured-only, excluded from parity like `hybridSearch`). An RSC page renders the form + ranked results.

**Tech Stack:** TypeScript, Next.js 14 App Router (RSC), DynamoDB (`@aws-sdk/lib-dynamodb`), Bedrock Titan v2 embeddings (existing `getEmbedder`), Node test scripts via `tsx`, Tailwind.

**Spec:** `docs/specs/2026-07-14-situation-similarity-design.md`

---

## File Structure

| File | Change |
|---|---|
| `src/lib/cases/types.ts` | Add `SituationInput`/`SimilarityBreakdown`/`ScoredCase` + `findSimilarCases` to `CaseRepo`. |
| `src/lib/cases/index.ts` | Re-export the three new types from the barrel. |
| `src/lib/cases/similarity.ts` | **New pure.** `assembleProfileText`, `strengthLabel`, `scoreSituation`, weights/thresholds. |
| `scripts/test-cases-similarity.ts` | **New** unit tests. |
| `src/lib/cases/repo.mock.ts` | Implement `findSimilarCases` (structured-only). |
| `src/lib/cases/repo.dynamo.ts` | Implement `findSimilarCases` + cached `coreSimilarityData()` loader. |
| `scripts/cases-embed-profiles.ts` | **New** batch enrichment + npm scripts in `package.json`. |
| `src/app/cases/similar/page.tsx` | **New** intake form + results page. |
| `src/app/cases/ui.tsx` | New `SimilarCaseCard` component. |
| `src/app/cases/layout.tsx` | Nav link `Find similar`. |
| `src/app/cases/page.tsx` | Callout link to `/cases/similar`. |
| `src/app/cases/methodology/page.tsx` | Methodology note. |

Types confirmed present on `LegalCase`: `id`, `styleOfCause`, `themes: Theme[]`, `level: CourtLevel`, `court`, `year`, `citingCount`, `outcome.holding`, `summary?.claims[].text`, `corpusTier`. Reuse `dot()` from `src/lib/cases/search/hybrid.ts` and `packF32`/`unpackF32` from `src/lib/cases/search/pack.ts`.

---

### Task 1: Pure similarity module + tests (TDD)

**Files:**
- Modify: `src/lib/cases/types.ts` (add types only — NOT the CaseRepo method yet)
- Modify: `src/lib/cases/index.ts` (re-export the new types from the barrel)
- Create: `src/lib/cases/similarity.ts`
- Create: `scripts/test-cases-similarity.ts`

- [ ] **Step 1: Add the types to `types.ts` and re-export from the barrel**

(1a) Append to `types.ts` near the other interfaces (after `EconomicFigures`, before `CaseRepo` — anywhere in the type-declaration region; do NOT touch `CaseRepo` in this task):

```ts
export interface SituationInput { themes: Theme[]; level?: CourtLevel; narrative: string }
export interface SimilarityBreakdown {
  semantic: number;          // cosine(situationVec, caseVec) clamped to [0,1]; 0 if no vector
  themeOverlap: number;      // |selected ∩ case.themes| / |selected|; 0 when no themes chosen
  jurisdictionMatch: number; // 1 if level matches else 0; 0 when no level chosen
  composite: number;         // renormalized weighted blend, [0,1]
  strength: "strong" | "moderate" | "weak";
  matchedThemes: Theme[];
  sameJurisdiction: boolean;
}
export interface ScoredCase { case: LegalCase; breakdown: SimilarityBreakdown }
```

(1b) `src/lib/cases/index.ts` uses an **explicit** `export type { … } from "./types"` list — add the three new names to it so `@/lib/cases` re-exports them (T2/T4 import `ScoredCase`/`SituationInput` from the barrel):

```ts
export type {
  LegalCase, CaseRepo, CaseFilter, Facets, ActivationSummary,
  CitationGraph, CaseExportBundle, Theme, CourtLevel, WinType, CorpusTier, RealizationStatus,
  CaseChunk, SituationInput, SimilarityBreakdown, ScoredCase,
} from "./types";
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-cases-similarity.ts`:

```ts
// Tests for the pure situation-similarity module (spec 2026-07-14). Offline, no network.
import assert from "node:assert/strict";

(async () => {
  const { assembleProfileText, strengthLabel, scoreSituation } =
    await import("../src/lib/cases/similarity");
  type LC = import("../src/lib/cases/types").LegalCase;
  type SI = import("../src/lib/cases/types").SituationInput;

  const mk = (id: string, over: Partial<LC> = {}): LC => ({
    id, citation: id.toUpperCase(), styleOfCause: `Nation v. Crown (${id})`,
    court: "SCC", level: "scc", year: 2004, jurisdiction: "CA",
    nations: ["Testwa"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "Nation",
      holding: "The Crown owed a duty to consult before acting." },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "core", fullTextAvailable: true,
    summary: { claims: [{ text: "Consultation was required.", sourceParagraph: "para-1", sourceUrl: "u" }] },
    summaryMeta: { method: "llm" },
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026-07-14", unofficial: true },
    ...over,
  });

  // --- assembleProfileText: deterministic, includes style/themes/holding/summary ---
  const t = assembleProfileText(mk("case-a"));
  assert.ok(t.includes("Nation v. Crown (case-a)"));
  assert.ok(t.includes("duty to consult"));           // theme underscores → spaces
  assert.ok(t.includes("duty to consult before acting")); // holding
  assert.ok(t.includes("Consultation was required."));    // summary claim
  assert.equal(assembleProfileText(mk("case-a")), t, "deterministic");
  const bare = assembleProfileText(mk("case-x", { summary: undefined, summaryMeta: undefined, outcome: { outcomeType: "precedent", winType: "unclassified", whoWon: "?", holding: "" } }));
  assert.ok(bare.includes("Nation v. Crown (case-x)")); // degrades cleanly

  // --- strengthLabel thresholds (STRONG_MIN=0.55, MODERATE_MIN=0.40) ---
  assert.equal(strengthLabel(0.7), "strong");
  assert.equal(strengthLabel(0.55), "strong");
  assert.equal(strengthLabel(0.45), "moderate");
  assert.equal(strengthLabel(0.40), "moderate");
  assert.equal(strengthLabel(0.3), "weak");
  assert.equal(strengthLabel(0), "weak");

  // --- scoreSituation: weights + renormalization + structured signals ---
  const cases = [
    mk("a", { themes: ["duty_to_consult", "treaty"], level: "scc", citingCount: 5 }),
    mk("b", { themes: ["fiduciary"], level: "fc", citingCount: 1 }),
  ];
  const vec = (n: number) => Float32Array.from([n, 0]); // unit-ish along axes for dot control
  const caseVecs = new Map<string, Float32Array>([["a", vec(1)], ["b", vec(0)]]);

  // narrative-only (semantic weight → 1.0). situationVec parallel to a → dot 1, b → 0.
  const sv = Float32Array.from([1, 0]);
  const rNarr = scoreSituation({ themes: [], narrative: "x" } as SI, cases, sv, caseVecs);
  assert.equal(rNarr[0].case.id, "a");
  assert.ok(Math.abs(rNarr[0].breakdown.composite - 1) < 1e-6);       // semantic-only weight 1.0
  assert.equal(rNarr[0].breakdown.strength, "strong");

  // themes + narrative: user picks duty_to_consult → a overlaps 1/1, b 0/1.
  const rTheme = scoreSituation({ themes: ["duty_to_consult"], narrative: "x" } as SI, cases, sv, caseVecs);
  // active weights semantic 0.6 + theme 0.3 = 0.9; a: (0.6*1 + 0.3*1)/0.9 = 1.0
  assert.ok(Math.abs(rTheme[0].breakdown.composite - 1) < 1e-6);
  assert.equal(rTheme[0].breakdown.themeOverlap, 1);
  assert.deepEqual(rTheme[0].breakdown.matchedThemes, ["duty_to_consult"]);

  // jurisdiction: pick scc → a matches, b doesn't.
  const rJur = scoreSituation({ themes: [], level: "scc", narrative: "x" } as SI, cases, sv, caseVecs);
  assert.equal(rJur.find((s) => s.case.id === "a")!.breakdown.sameJurisdiction, true);
  assert.equal(rJur.find((s) => s.case.id === "b")!.breakdown.sameJurisdiction, false);

  // null situationVec → semantic 0 for all, still ranks by structured dims (theme)
  const rNull = scoreSituation({ themes: ["fiduciary"], narrative: "x" } as SI, cases, null, caseVecs);
  assert.equal(rNull[0].case.id, "b"); // only b has fiduciary
  assert.equal(rNull[0].breakdown.semantic, 0);

  // empty caseVecs → no crash, semantic 0
  const rEmpty = scoreSituation({ themes: [], narrative: "x" } as SI, cases, sv, new Map());
  assert.equal(rEmpty[0].breakdown.semantic, 0);

  // topN slice + tie-break (equal composite → higher citingCount first)
  const tie = [mk("lo", { citingCount: 1 }), mk("hi", { citingCount: 9 })];
  const rTie = scoreSituation({ themes: [], narrative: "x" } as SI, tie, null, new Map(), 1);
  assert.equal(rTie.length, 1);
  assert.equal(rTie[0].case.id, "hi");

  console.log("✅ test-cases-similarity passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-similarity.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/similarity'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/lib/cases/similarity.ts`:

```ts
// Pure situation→case similarity (spec 2026-07-14). Deterministic, explainable, NOT learned.
// The scoring lives here; the repo embeds/loads and calls scoreSituation.
import type { LegalCase, Theme, SituationInput, SimilarityBreakdown, ScoredCase } from "./types";
import { dot } from "./search/hybrid";

// Heuristic weights + strength thresholds — documented constants, tunable by the post-merge
// mini-eval. NOT learned (we have no situation↔case similarity labels).
const WEIGHTS = { semantic: 0.6, theme: 0.3, jurisdiction: 0.1 };
const STRONG_MIN = 0.55;
const MODERATE_MIN = 0.40;

// Deterministic profile text for the case-level embedding: what this case is ABOUT.
export function assembleProfileText(c: LegalCase): string {
  return [
    c.styleOfCause,
    c.themes.map((t) => t.replace(/_/g, " ")).join(", "),
    c.outcome?.holding ?? "",
    (c.summary?.claims ?? []).map((cl) => cl.text).join(" "),
  ].filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
}

export function strengthLabel(composite: number): "strong" | "moderate" | "weak" {
  if (composite >= STRONG_MIN) return "strong";
  if (composite >= MODERATE_MIN) return "moderate";
  return "weak";
}

export function scoreSituation(
  input: SituationInput,
  cases: LegalCase[],
  situationVec: Float32Array | null,
  caseVecs: Map<string, Float32Array>,
  topN = 10,
): ScoredCase[] {
  const selThemes = new Set<Theme>(input.themes);
  const activeTheme = selThemes.size > 0;
  const activeJuris = !!input.level;
  const totalW =
    WEIGHTS.semantic + (activeTheme ? WEIGHTS.theme : 0) + (activeJuris ? WEIGHTS.jurisdiction : 0);

  const scored: ScoredCase[] = cases.map((c) => {
    const cv = caseVecs.get(c.id);
    const semantic = situationVec && cv ? Math.max(0, dot(situationVec, cv)) : 0;
    const matchedThemes = c.themes.filter((t) => selThemes.has(t));
    const themeOverlap = activeTheme ? matchedThemes.length / selThemes.size : 0;
    const sameJurisdiction = activeJuris && c.level === input.level;
    const jurisdictionMatch = sameJurisdiction ? 1 : 0;
    const composite =
      (WEIGHTS.semantic * semantic +
        (activeTheme ? WEIGHTS.theme * themeOverlap : 0) +
        (activeJuris ? WEIGHTS.jurisdiction * jurisdictionMatch : 0)) / totalW;
    const breakdown: SimilarityBreakdown = {
      semantic, themeOverlap, jurisdictionMatch, composite,
      strength: strengthLabel(composite), matchedThemes, sameJurisdiction,
    };
    return { case: c, breakdown };
  });

  scored.sort((a, b) =>
    b.breakdown.composite - a.breakdown.composite ||
    b.case.citingCount - a.case.citingCount ||
    b.case.year - a.case.year ||
    a.case.id.localeCompare(b.case.id));
  return scored.slice(0, topN);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-similarity.ts`  → expect `✅ test-cases-similarity passed`.
Also `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/index.ts src/lib/cases/similarity.ts scripts/test-cases-similarity.ts
git commit -m "feat: pure situation-similarity scoring module + tests"
```

---

### Task 2: `findSimilarCases` — interface + mock + dynamo

**Files:**
- Modify: `src/lib/cases/types.ts` (add the method to `CaseRepo`)
- Modify: `src/lib/cases/repo.mock.ts`
- Modify: `src/lib/cases/repo.dynamo.ts`

All three change together so `typecheck` stays green (interface + both impls land atomically).

- [ ] **Step 1: Add the method to the `CaseRepo` interface (`types.ts`)**

In the `CaseRepo` interface, add (near `hybridSearch`):

```ts
  findSimilarCases(input: SituationInput): Promise<ScoredCase[]>;
```

- [ ] **Step 2: Implement in the mock (`repo.mock.ts`)**

Add the import at the top:

```ts
import { scoreSituation } from "./similarity";
```

Add the method to `mockCaseRepo` (structured-only — fixtures have no vectors; EXCLUDED from
`dynamo ≡ mock` golden checks, exactly like `hybridSearch`):

```ts
  async findSimilarCases(input) {
    const cases = [...filterCases(caseFixtures, { tier: "core" })];
    return scoreSituation(input, cases, null, new Map());
  },
```

- [ ] **Step 3: Implement in dynamo (`repo.dynamo.ts`)**

Add imports:

```ts
import { unpackF32 } from "./search/pack";
import { assembleProfileText, scoreSituation } from "./similarity";
```

Add a cached loader next to `scanAll` (reuses the GSI1 scan; captures the embedder that wrote
the vectors for the mismatch guard):

```ts
// Request-memoized core cases + their profile vectors (pvec) for similarity. One GSI1 scan.
const coreSimilarityData = cache(async (): Promise<{
  cases: LegalCase[]; vecs: Map<string, Float32Array>; embedderId: string | null;
}> => {
  const cases: LegalCase[] = [];
  const vecs = new Map<string, Float32Array>();
  let embedderId: string | null = null;
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, IndexName: "GSI1", ExclusiveStartKey: start }));
    for (const it of r.Items ?? []) {
      if (it.et !== "Case") continue;
      const c = itemToCase(it);
      if (c.corpusTier !== "core") continue;
      cases.push(c);
      if (it.pvec && it.pvecDim) {
        vecs.set(c.id, unpackF32(it.pvec as Uint8Array, Number(it.pvecDim)));
        if (!embedderId) embedderId = (it.pvecEmbedderId as string | undefined) ?? null;
      }
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return { cases, vecs, embedderId };
});
```

Add the method to `dynamoCaseRepo` (embed the narrative ONLY when the active embedder matches
the one that wrote `pvec` — otherwise structured-only, mirroring `hybridSearch`'s BM25 fallback):

```ts
  async findSimilarCases(input) {
    const { cases, vecs, embedderId } = await coreSimilarityData();
    const embedder = getEmbedder();
    let situationVec: Float32Array | null = null;
    if (vecs.size > 0 && embedderId === embedder.id && input.narrative.trim()) {
      const q = `${input.narrative} ${input.themes.join(" ")}`.trim();
      situationVec = (await embedder.embed([q]))[0];
    } else if (vecs.size > 0 && embedderId !== embedder.id) {
      console.warn(`[similar] embedder mismatch active=${embedder.id} stored=${embedderId} → structured-only`);
    }
    return scoreSituation(input, cases, situationVec, vecs);
  },
```

- [ ] **Step 4: Verify**

Run: `npx tsx scripts/test-cases-similarity.ts` (still green) then `npm run typecheck && npm run build`.
Expected: typecheck clean; build compiles. (Dynamo path needs DynamoDB to execute; correctness
of the pure scoring is covered by Task 1; the mock path is exercised in dev/verify.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/repo.mock.ts src/lib/cases/repo.dynamo.ts
git commit -m "feat: findSimilarCases repo method (mock structured-only, dynamo pvec-backed)"
```

---

### Task 3: Profile-embedding batch script

**Files:**
- Create: `scripts/cases-embed-profiles.ts`
- Modify: `package.json` (npm scripts)

- [ ] **Step 1: Create the batch script**

`scripts/cases-embed-profiles.ts` (mirrors `cases-embed.ts`; core PROFILE items only;
additive, idempotent; `UpdateItem` SET so the profile `data` is never rewritten):

```ts
// Idempotent, additive profile-embedding pass (spec 2026-07-14): for every CORE profile
// whose pvec is missing or was written by a different embedder, embed assembleProfileText
// and write pvec/pvecEmbedderId/pvecDim on the PROFILE item. Never touches CHUNK vectors.
import "./fetch-polyfill";
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { getEmbedder } from "../src/lib/cases/search/embedder";
import { packF32 } from "../src/lib/cases/search/pack";
import { itemToCase } from "../src/lib/cases/dynamo/cases-table";
import { assembleProfileText } from "../src/lib/cases/similarity";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

export function needsProfileEmbed(item: { pvec?: unknown; pvecEmbedderId?: string }, activeId: string): boolean {
  return !item.pvec || item.pvecEmbedderId !== activeId;
}

async function run() {
  const embedder = getEmbedder();
  console.log(`embedder = ${embedder.id} (dim ${embedder.dim})`);
  let embedded = 0, skipped = 0, total = 0;
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, IndexName: "GSI1", ExclusiveStartKey: start }));
    const profiles = (r.Items ?? []).filter((it) => it.et === "Case" && itemToCase(it).corpusTier === "core");
    total += profiles.length;
    const todo = profiles.filter((it) => needsProfileEmbed(it as any, embedder.id));
    skipped += profiles.length - todo.length;
    if (todo.length) {
      const vecs = await embedder.embed(todo.map((it) => assembleProfileText(itemToCase(it))));
      for (let i = 0; i < todo.length; i++) {
        const it = todo[i];
        await ddbDoc.send(new UpdateCommand({
          TableName: TABLE, Key: { PK: it.PK, SK: it.SK },
          UpdateExpression: "SET pvec = :v, pvecEmbedderId = :e, pvecDim = :d",
          ExpressionAttributeValues: { ":v": packF32(vecs[i]), ":e": embedder.id, ":d": embedder.dim },
        }));
      }
      embedded += todo.length;
    }
    start = r.LastEvaluatedKey;
  } while (start);
  console.log(`✅ profile-embedded ${embedded} · skipped-current ${skipped} · total core ${total}`);
}

if (require.main === module) run().catch((e) => { console.error("❌ cases-embed-profiles failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts (`package.json`)**

Find the existing `"cases:embed:bedrock:cloud"` script and add, right after it, mirroring its
env (stub variant for local, bedrock+cloud for the credentialed run):

```json
    "cases:embed-profiles": "cross-env EMBED_PROVIDER=stub tsx scripts/cases-embed-profiles.ts",
    "cases:embed-profiles:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases EMBED_PROVIDER=bedrock EMBED_MODEL=amazon.titan-embed-text-v2:0 EMBED_DIM=1024 tsx scripts/cases-embed-profiles.ts",
```

(Match the exact env of the sibling `cases:embed:bedrock*` scripts already in the file — copy their variable set verbatim if it differs.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → clean. (No credentialed run here — that's the post-merge ops step.)

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-embed-profiles.ts package.json
git commit -m "feat: cases-embed-profiles batch (core profile vectors for similarity)"
```

---

### Task 4: Page + card + nav + callout + methodology

**Files:**
- Create: `src/app/cases/similar/page.tsx`
- Modify: `src/app/cases/ui.tsx` (add `SimilarCaseCard`)
- Modify: `src/app/cases/layout.tsx` (nav link)
- Modify: `src/app/cases/page.tsx` (callout link)
- Modify: `src/app/cases/methodology/page.tsx` (note)

Presentation — verified by `typecheck` + `build`.

- [ ] **Step 1: `SimilarCaseCard` in `ui.tsx`**

Add the import at the top of `src/app/cases/ui.tsx`:

```tsx
import type { ScoredCase } from "@/lib/cases";
```

Append the component:

```tsx
export function SimilarCaseCard({ scored }: { scored: ScoredCase }) {
  const { case: c, breakdown: b } = scored;
  const chip =
    b.strength === "strong" ? "bg-cedar/15 text-cedar"
    : b.strength === "moderate" ? "bg-amber/15 text-amber"
    : "bg-ink/10 text-ink3";
  const closestOn = [
    ...b.matchedThemes.map((t) => t.replace(/_/g, " ")),
    b.sameJurisdiction ? c.court : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="rounded border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/cases/${c.id}`} className="font-serif hover:text-amber hover:underline">
          {c.styleOfCause} ({c.court}, {c.year})
        </Link>
        <span className={`rounded px-2 py-0.5 text-xs ${chip}`}>{b.strength} match</span>
        <TierBadge tier={c.corpusTier} fullTextAvailable={c.fullTextAvailable} />
      </div>
      {closestOn && <div className="mt-1 text-xs text-ink3">Closest on: {closestOn}</div>}
      {c.outcome.holding && <p className="mt-1 text-sm text-ink2">What it established: {c.outcome.holding}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/cases/similar/page.tsx`**

```tsx
import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import type { Theme, CourtLevel } from "@/lib/cases";
import { SimilarCaseCard } from "../ui";
import { isAdviceSeeking } from "@/lib/cases/briefs/advice";

export const dynamic = "force-dynamic";

const THEMES: Theme[] = ["land_rights", "resource_revenue", "duty_to_consult", "treaty", "fiduciary", "self_determination"];
const LEVELS: CourtLevel[] = ["scc", "fca", "fc", "provincial_appeal", "provincial_superior", "tribunal"];

export default async function SimilarPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const narrative = String(searchParams.s ?? "").trim();
  const themes = (Array.isArray(searchParams.theme) ? searchParams.theme : searchParams.theme ? [searchParams.theme] : []) as Theme[];
  const level = (typeof searchParams.level === "string" ? searchParams.level : "") as CourtLevel | "";
  const results = narrative ? await casesRepo.findSimilarCases({ themes, level: level || undefined, narrative }) : [];
  const topWeak = results.length > 0 && results[0].breakdown.strength === "weak";
  const showAdvice = !!narrative && isAdviceSeeking(narrative);
  const sel = "rounded border border-line bg-panel px-2 py-1";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Situation → precedents</div>
        <h1 className="font-serif text-2xl">Find similar cases</h1>
        <p className="mt-1 text-sm text-ink3">
          Describe your situation to find prior cases in the same territory — a starting point
          for reading and research, <strong>not a legal match or prediction</strong>. Matches
          are within our curated core; this is legal information, not advice.
        </p>
      </div>

      <form action="/cases/similar" className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm">
          {THEMES.map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" name="theme" value={t} defaultChecked={themes.includes(t)} /> {t.replace(/_/g, " ")}
            </label>
          ))}
        </div>
        <select name="level" defaultValue={level} className={sel} aria-label="Jurisdiction">
          <option value="">Any court</option>{LEVELS.map((l) => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}
        </select>
        <textarea name="s" rows={4} required minLength={20} maxLength={1200} defaultValue={narrative}
          placeholder="Describe your situation: sector, what the government/company did, the agreement or right at issue, where…"
          className="w-full rounded border border-line bg-panel p-3 text-sm" />
        <button className="rounded bg-ink px-4 py-2 text-bg hover:bg-ink/90">Find similar cases →</button>
      </form>

      {narrative && (
        <section className="space-y-3">
          {showAdvice && (
            <p className="rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink2">
              This reads as asking about a specific situation. This provides <strong>general legal
              information, not advice</strong> — for advice, consult qualified counsel or an Indigenous legal clinic.
            </p>
          )}
          {topWeak && (
            <p className="rounded border border-line bg-amber/10 px-3 py-2 text-sm text-ink2">
              No strongly comparable case in the curated core. The following are the closest we
              found — read them with caution; a close precedent for your situation may simply not
              be in this corpus.
            </p>
          )}
          <h2 className="font-serif text-lg">Closest cases to explore</h2>
          <div className="space-y-3">
            {results.map((s) => <SimilarCaseCard key={s.case.id} scored={s} />)}
            {results.length === 0 && <p className="text-sm text-ink3">No cases to show.</p>}
          </div>
          <p className="border-t border-line pt-3 text-xs text-ink3">
            Similarity is a descriptive research aid over the curated core — matched themes,
            jurisdiction, and semantic closeness. It is not a prediction of any outcome.
          </p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Nav link (`layout.tsx`)**

Add after the `Cases` nav `<Link>` (keep the row consistent):

```tsx
            <Link href="/cases/similar" className="hover:text-amber">Find similar</Link>
```

- [ ] **Step 4: Callout on `/cases` (`page.tsx`)**

Add directly under the intro `<p>` (the one after the `<h1>Legal cases — economic justice</h1>`):

```tsx
      <p className="mt-1 text-sm"><Link href="/cases/similar" className="text-amber hover:underline">Describe your situation to find similar cases →</Link></p>
```

- [ ] **Step 5: Methodology note (`methodology/page.tsx`)**

Add a new `<div>` section (mirroring the existing section markup) after the "Legal information assistant" section:

```tsx
        <div>
          <h2 className="font-serif text-lg">Find similar cases</h2>
          <p>The similar-cases tool ranks curated cases against a described situation by a <strong>deterministic, explainable</strong> blend of semantic closeness (a case-level embedding), theme overlap, and jurisdiction — never a trained predictor. Each result shows a match-strength label and <em>why</em> it matched; when nothing is strongly comparable it says so. It is a <strong>research starting point, not a legal match or prediction</strong>, and not legal advice.</p>
        </div>
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed; `/cases/similar` appears in the route table.

- [ ] **Step 7: Commit**

```bash
git add src/app/cases/similar/page.tsx src/app/cases/ui.tsx src/app/cases/layout.tsx src/app/cases/page.tsx src/app/cases/methodology/page.tsx
git commit -m "feat: /cases/similar guided situation intake + explainable results"
```

---

## Self-Review

**Spec coverage:** intake form + dimensions (T4 step 2) ✓; case-level profile embedding (`pvec`) enrichment (T3) ✓; multi-signal deterministic scoring + renormalization (T1) ✓; match-strength + weak-caution honesty mechanisms (T1 `strengthLabel`, T4 chips + caution) ✓; research-starting-point framing (T4 copy) ✓; `findSimilarCases` seam + mock/dynamo + parity exclusion (T2) ✓; advice-deflection reuse (T4 `isAdviceSeeking`) ✓; tests (T1) ✓; methodology (T4) ✓. Mini-eval is a post-merge ops step (spec §Operational run), not a code task.

**Placeholder scan:** none — every code step is complete.

**Type/name consistency:** `SituationInput`/`SimilarityBreakdown`/`ScoredCase` defined in T1 (types.ts), used identically in T2 (interface + impls), T1 (similarity.ts), and T4 (page/card). `findSimilarCases(input: SituationInput): Promise<ScoredCase[]>` matches across interface + mock + dynamo. `pvec`/`pvecEmbedderId`/`pvecDim` written in T3 and read in T2's `coreSimilarityData`. `packF32`/`unpackF32`, `dot`, `getEmbedder`, `itemToCase`, `cache` all already exist on this branch.

**Note:** `findSimilarCases` is excluded from the `dynamo ≡ mock` golden parity (mock is structured-only), exactly like `hybridSearch` — call this out in the final review so it isn't flagged as a parity break.
