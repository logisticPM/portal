# Legal-Cases Portal Rich Front-End — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the MVP `/cases` pages into a usable rich front-end over the real corpus — shared layout+nav, substrate-inclusive search with filters + tier toggle, a full-text reading detail view, activation $ aggregates, and a methodology page.

**Architecture:** Next.js 14 **React Server Components** reading only via the `@/lib/cases` seam; URL-driven state (`searchParams`); **no client JS** (native `<details>` for expand, server-side highlight); **no new deps**. A small **additive, pure** query-layer change (`CaseFilter.tier:"all"`, `buildCorpusStats`/`getCorpusStats`) keeps `dynamo ≡ mock`.

**Tech Stack:** TypeScript, Next.js 14 App Router (server components), Tailwind with CSS-var tokens (`bg/panel/ink/ink2/ink3/line/amber/cedar`), `tsx` assertion tests. No React testing framework — pure helpers are unit-tested; pages are gated by `npm run build` + `npm run typecheck`.

**Spec:** `docs/specs/2026-07-01-cases-portal-rich-fe-design.md`. **Branch:** `feat/legal-cases-portal-fe` (already created, off `main`).

**Conventions:**
- Tests: `npx tsx scripts/test-cases-<name>.ts`, `import assert from "node:assert/strict"`, end with `console.log("✅ … passed")`. Async tests wrap the body in `(async () => { … })().catch((e) => { console.error("❌ test failed:", e); process.exit(1); });` (this repo is CJS — no top-level await).
- Commit after each task with trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Windows: the Bash shell resets cwd — prefix `cd /c/Users/chntw/Documents/7980/demo && …` or use `git -C …`.
- Existing token classes to reuse: `font-serif`, `text-ink/ink2/ink3`, `bg-panel`, `bg-bg`/`text-bg`, `border-line`, `text-amber`/`bg-amber/…`, `text-cedar`/`bg-cedar/…`.
- Tier badge semantics (refined): `core` → "core"; substrate **with** full text → "full text"; substrate **without** full text → "index only".

---

## File Structure

**Modify (data layer):**
- `src/lib/cases/types.ts` — widen `CaseFilter.tier`; add `CorpusStats`; add `getCorpusStats` to `CaseRepo`.
- `src/lib/cases/query.ts` — `filterCases` `tier:"all"`; add `buildCorpusStats`.
- `src/lib/cases/repo.dynamo.ts` / `repo.mock.ts` — implement `getCorpusStats`.
- `scripts/verify.ts` — `getCorpusStats` parity + `tier:"all"` checks.

**Create (app layer):**
- `src/app/cases/highlight.ts` — pure `splitHighlight` (no React).
- `src/app/cases/ui.tsx` — server components: `TierBadge`, `CaseListItem`, `StatCard`, `Bar`, `ProvenanceFooter`, `FullTextReader`.
- `src/app/cases/layout.tsx` — nav + disclaimer + footer.
- `src/app/cases/methodology/page.tsx`.

**Modify (app layer):**
- `src/app/cases/page.tsx` (search), `src/app/cases/[id]/page.tsx` (detail), `src/app/cases/activation/page.tsx`.

**Create (tests):** `scripts/test-cases-filter-tier.ts`, `scripts/test-cases-corpusstats.ts`, `scripts/test-cases-highlight.ts`.

**Untouched:** `search/*`, `ingest/*`, `cases-table.ts`, `searchCases`/`hybridSearch` bodies (only `filterCases` gains an additive branch).

---

## Task 1: Query layer — `tier:"all"` + `buildCorpusStats`

**Files:** Modify `src/lib/cases/types.ts`, `src/lib/cases/query.ts`; Test `scripts/test-cases-filter-tier.ts`, `scripts/test-cases-corpusstats.ts`.

- [ ] **Step 1: Write the failing tests**

`scripts/test-cases-filter-tier.ts`:
```ts
import assert from "node:assert/strict";
import { filterCases } from "../src/lib/cases/query";
import type { LegalCase } from "../src/lib/cases/types";

const mk = (id: string, tier: "core" | "substrate"): LegalCase => ({
  id, corpusTier: tier, themes: [], level: "scc", year: 2000, fullTextAvailable: false,
  outcome: { winType: "unclassified" }, nations: [],
} as unknown as LegalCase);

const cases = [mk("a", "core"), mk("b", "substrate"), mk("c", "core")];
assert.equal(filterCases(cases).length, 2, "omitted → core-only");
assert.equal(filterCases(cases, { tier: "core" }).length, 2, "tier core");
assert.equal(filterCases(cases, { tier: "substrate" }).length, 1, "tier substrate");
assert.equal(filterCases(cases, { tier: "all" }).length, 3, "tier all → both");
console.log("✅ filter-tier tests passed");
```

`scripts/test-cases-corpusstats.ts`:
```ts
import assert from "node:assert/strict";
import { buildCorpusStats } from "../src/lib/cases/query";
import { caseFixtures } from "../src/lib/cases/fixtures";
import type { LegalCase } from "../src/lib/cases/types";

const s = buildCorpusStats(caseFixtures);
assert.equal(s.total, 4, "total");
assert.equal(s.core, 4, "all fixtures are core");
assert.equal(s.substrate, 0, "no substrate fixtures");
assert.equal(s.fullText, 3, "3 fixtures have full text");
assert.equal(s.byLevel.scc, 3, "3 SCC");

const mk = (y: number): LegalCase => ({ corpusTier: "core", level: "scc", year: y, fullTextAvailable: true } as unknown as LegalCase);
const d = buildCorpusStats([mk(2014), mk(2019), mk(2004)]);
assert.equal(d.byDecade["2010s"], 2, "decade bucketing");
assert.equal(d.byDecade["2000s"], 1, "decade bucketing 2000s");
console.log("✅ corpusstats tests passed");
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx scripts/test-cases-corpusstats.ts`
Expected: FAIL — `buildCorpusStats` is not exported.

- [ ] **Step 3: Implement — `types.ts`**

In `src/lib/cases/types.ts`, change the `CaseFilter.tier` line and add `CorpusStats` + the repo method. Replace the `CaseFilter` interface's tier field:
```ts
export interface CaseFilter {
  themes?: Theme[]; level?: CourtLevel; winType?: WinType;
  nation?: string; yearFrom?: number; yearTo?: number;
  tier?: CorpusTier | "all";
}
```
Add after the `ActivationSummary` interface:
```ts
export interface CorpusStats {
  total: number; core: number; substrate: number; fullText: number;
  byLevel: Partial<Record<CourtLevel, number>>;
  byDecade: Record<string, number>;
}
```
Add to the `CaseRepo` interface (after `getActivationSummary`):
```ts
  getCorpusStats(): Promise<CorpusStats>;
```

- [ ] **Step 4: Implement — `query.ts`**

In `src/lib/cases/query.ts`, add `CorpusStats` to the type import from `./types`. Replace the `filterCases` tier predicate line:
```ts
    (f?.tier === "all" ? true : f?.tier ? c.corpusTier === f.tier : c.corpusTier === "core") &&
```
Add a new exported function (after `buildActivation`):
```ts
export function buildCorpusStats(cases: LegalCase[]): import("./types").CorpusStats {
  const byLevel: Partial<Record<import("./types").CourtLevel, number>> = {};
  const byDecade: Record<string, number> = {};
  let core = 0, substrate = 0, fullText = 0;
  for (const c of cases) {
    if (c.corpusTier === "core") core++; else substrate++;
    if (c.fullTextAvailable) fullText++;
    byLevel[c.level] = (byLevel[c.level] ?? 0) + 1;
    const d = `${Math.floor(c.year / 10) * 10}s`;
    byDecade[d] = (byDecade[d] ?? 0) + 1;
  }
  return { total: cases.length, core, substrate, fullText, byLevel: sortKeys(byLevel), byDecade: sortKeys(byDecade) };
}
```
(`sortKeys` already exists in `query.ts`; `CourtLevel` is already imported there — if so, use it directly instead of the inline `import(...)`. Prefer the already-imported names; the inline `import("./types")` form is a safe fallback that also type-checks.)

- [ ] **Step 5: Run tests to verify pass**

Run: `npx tsx scripts/test-cases-filter-tier.ts && npx tsx scripts/test-cases-corpusstats.ts`
Expected: both print `✅ … passed`.

- [ ] **Step 6: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/lib/cases/types.ts src/lib/cases/query.ts scripts/test-cases-filter-tier.ts scripts/test-cases-corpusstats.ts
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): additive query layer — CaseFilter tier:all + buildCorpusStats

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `getCorpusStats` on both repos + verify parity

**Files:** Modify `src/lib/cases/repo.dynamo.ts`, `src/lib/cases/repo.mock.ts`, `scripts/verify.ts`.

- [ ] **Step 1: Implement mock**

In `src/lib/cases/repo.mock.ts`: add `buildCorpusStats` to the `./query` import, and add this method to `mockCaseRepo` (after `getActivationSummary`):
```ts
  async getCorpusStats() {
    return buildCorpusStats(caseFixtures);
  },
```

- [ ] **Step 2: Implement dynamo**

In `src/lib/cases/repo.dynamo.ts`: add `buildCorpusStats` to the `./query` import, and add to `dynamoCaseRepo` (after `getActivationSummary`):
```ts
  async getCorpusStats() {
    return buildCorpusStats(await scanAll());
  },
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0 (both repos now satisfy `CaseRepo`).

- [ ] **Step 4: Add verify checks**

In `scripts/verify.ts`, in the `# 4. cases (dynamo ≡ mock)` section, immediately after the existing `check("cases: search mock≡dynamo", …)` line, add:
```ts
  check("cases: getCorpusStats mock≡dynamo", eq(await mockCaseRepo.getCorpusStats(), await dynamoCaseRepo.getCorpusStats()));
```
Then, in the Phase 2-A block, immediately after the existing `check("cases: tier:substrate returns substrate", …)` line, add:
```ts
  const allTier = await dynamoCaseRepo.listCases({ tier: "all" });
  check("cases: tier:all returns both tiers",
    allTier.some((c) => c.corpusTier === "core") && allTier.some((c) => c.corpusTier === "substrate"));
```

- [ ] **Step 5: Run verify (needs Docker + `npm run ddb:up`)**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run verify`
Expected: `🎉 ALL PASS` with the 2 new checks green (getCorpusStats parity holds because right after `freshSeed` the dynamo table equals the mock fixtures; the `tier:all` check runs after the `verify-substrate` case is inserted). If `ECONNREFUSED :8000`, start Docker — not a code failure.

- [ ] **Step 6: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/lib/cases/repo.dynamo.ts src/lib/cases/repo.mock.ts scripts/verify.ts
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): getCorpusStats on both repos + verify dynamo≡mock + tier:all

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Pure `splitHighlight` helper

**Files:** Create `src/app/cases/highlight.ts`; Test `scripts/test-cases-highlight.ts`.

- [ ] **Step 1: Write the failing test** — `scripts/test-cases-highlight.ts`:
```ts
import assert from "node:assert/strict";
import { splitHighlight } from "../src/app/cases/highlight";

assert.deepEqual(splitHighlight("the duty to consult", "duty"),
  [{ text: "the ", mark: false }, { text: "duty", mark: true }, { text: " to consult", mark: false }]);
assert.deepEqual(splitHighlight("Consult and CONSULT", "consult"),
  [{ text: "Consult", mark: true }, { text: " and ", mark: false }, { text: "CONSULT", mark: true }], "case-insensitive, preserves original case");
assert.deepEqual(splitHighlight("no match here", "xyz"), [{ text: "no match here", mark: false }], "no match → whole");
assert.deepEqual(splitHighlight("anything", ""), [{ text: "anything", mark: false }], "empty query → whole");
console.log("✅ highlight tests passed");
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx scripts/test-cases-highlight.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/app/cases/highlight.ts`:
```ts
export interface Seg { text: string; mark: boolean; }

// Split text into segments, marking case-insensitive matches of q. Preserves the
// original casing of matched substrings. Empty q → the whole text, unmarked.
export function splitHighlight(text: string, q: string): Seg[] {
  const query = q.trim();
  if (!query) return [{ text, mark: false }];
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const out: Seg[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) { out.push({ text: text.slice(i), mark: false }); break; }
    if (idx > i) out.push({ text: text.slice(i, idx), mark: false });
    out.push({ text: text.slice(idx, idx + query.length), mark: true });
    i = idx + query.length;
  }
  return out.filter((s) => s.text.length > 0);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx scripts/test-cases-highlight.ts`
Expected: `✅ highlight tests passed`.

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/app/cases/highlight.ts scripts/test-cases-highlight.ts
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): pure splitHighlight helper for full-text query highlighting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Shared UI components (`ui.tsx`)

**Files:** Create `src/app/cases/ui.tsx`.

- [ ] **Step 1: Implement** — `src/app/cases/ui.tsx`:
```tsx
import Link from "next/link";
import type { LegalCase, CaseChunk } from "@/lib/cases";
import { splitHighlight } from "./highlight";

export function TierBadge({ tier, fullTextAvailable }: { tier: "core" | "substrate"; fullTextAvailable: boolean }) {
  if (tier === "core") return <span className="rounded bg-cedar/15 px-2 py-0.5 text-xs text-cedar">core</span>;
  if (fullTextAvailable) return <span className="rounded bg-amber/15 px-2 py-0.5 text-xs text-amber">full text</span>;
  return <span className="rounded bg-ink/10 px-2 py-0.5 text-xs text-ink3">index only</span>;
}

export function CaseListItem({ c, q }: { c: LegalCase; q: string }) {
  const href = q ? `/cases/${c.id}?q=${encodeURIComponent(q)}` : `/cases/${c.id}`;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href} className="font-medium hover:text-amber hover:underline">{c.styleOfCause}</Link>
        <TierBadge tier={c.corpusTier} fullTextAvailable={c.fullTextAvailable} />
      </div>
      <div className="text-sm text-ink3">{c.citation} · {c.court} · {c.year}</div>
      {c.outcome.holding
        ? <div className="text-sm text-ink2">{c.outcome.holding}</div>
        : c.fullTextAvailable ? <div className="text-sm text-ink3">Full-text judgment — open to read.</div> : null}
    </li>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-line bg-panel p-3 shadow-card">
      <div className="font-serif text-2xl">{value}</div>
      <div className="text-xs text-ink3">{label}</div>
    </div>
  );
}

export function Bar({ label, n, max }: { label: string; n: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-40 shrink-0 text-ink2">{label}</div>
      <div className="h-4 flex-1 overflow-hidden rounded bg-ink/10">
        <div className="h-4 rounded bg-amber" style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
      </div>
      <div className="w-10 text-right text-ink3">{n}</div>
    </div>
  );
}

export function ProvenanceFooter({ c }: { c: LegalCase }) {
  return (
    <footer className="mt-6 border-t border-line pt-3 text-xs text-ink3">
      {c.provenance.unofficial && "Unofficial reproduction. "}
      Source: <a href={c.provenance.sourceUrl} className="text-amber hover:underline" target="_blank" rel="noreferrer">official decision</a>. License: {c.provenance.upstreamLicense}
    </footer>
  );
}

export function FullTextReader({ chunks, q }: { chunks: CaseChunk[]; q: string }) {
  const HEAD = 12;
  const renderPara = (ch: CaseChunk, i: number) => (
    <p key={i} id={`para-${i + 1}`} className="mb-3 text-sm leading-7 text-ink2">
      <span className="mr-2 text-xs text-ink3">¶{i + 1}</span>
      {splitHighlight(ch.text, q).map((s, j) =>
        s.mark ? <mark key={j} className="bg-amber/20 text-ink">{s.text}</mark> : <span key={j}>{s.text}</span>)}
    </p>
  );
  return (
    <section className="mt-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg">Full text</h2>
        <span className="text-xs text-ink3">{chunks.length} paragraphs{q ? ` · highlighting “${q}”` : ""}</span>
      </div>
      <div className="mt-2 border-l-2 border-line pl-4">
        {chunks.slice(0, HEAD).map(renderPara)}
        {chunks.length > HEAD && (
          <details>
            <summary className="cursor-pointer text-sm text-amber">Show all {chunks.length} paragraphs</summary>
            <div className="mt-3">{chunks.slice(HEAD).map((ch, i) => renderPara(ch, i + HEAD))}</div>
          </details>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0. (Confirms `CaseChunk`/`LegalCase` are exported from `@/lib/cases` — they are re-exported in `src/lib/cases/index.ts`; if `CaseChunk` is not re-exported there, add it to the `export type { … }` list in `index.ts` as part of this task.)

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/app/cases/ui.tsx src/lib/cases/index.ts
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): shared server UI components (TierBadge, CaseListItem, FullTextReader, …)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Shared layout (nav + disclaimer + footer)

**Files:** Create `src/app/cases/layout.tsx`.

- [ ] **Step 1: Implement** — `src/app/cases/layout.tsx`:
```tsx
import Link from "next/link";
import type { ReactNode } from "react";

export default function CasesLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl items-center gap-5 px-4 py-3 text-sm">
          <Link href="/cases" className="font-serif text-base">Legal Cases</Link>
          <nav className="flex gap-4 text-ink3">
            <Link href="/cases" className="hover:text-amber">Cases</Link>
            <Link href="/cases/activation" className="hover:text-amber">Activation</Link>
            <Link href="/cases/methodology" className="hover:text-amber">Methodology</Link>
          </nav>
        </div>
        <div className="border-t border-line bg-amber/5 px-4 py-1.5 text-center text-xs text-ink3">
          Unofficial reproductions of public court decisions · not legal advice · every claim links to its source
        </div>
      </header>
      <main className="px-4 py-6">{children}</main>
      <footer className="border-t border-line px-4 py-4 text-center text-xs text-ink3">
        Indigenomics Institute · Economic Justice Legal Cases · methodology transparent by design
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/app/cases/layout.tsx
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): shared /cases layout — nav, global unofficial-reproduction disclaimer, footer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Search page (substrate-inclusive + filters + tier rule)

**Files:** Modify `src/app/cases/page.tsx` (replace the whole file).

- [ ] **Step 1: Implement** — replace `src/app/cases/page.tsx` with:
```tsx
import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import type { Theme, CourtLevel, WinType, CorpusTier } from "@/lib/cases";
import { CaseListItem } from "./ui";

const THEMES: Theme[] = ["land_rights", "resource_revenue", "duty_to_consult", "treaty", "fiduciary", "self_determination"];
const LEVELS: CourtLevel[] = ["scc", "fca", "fc", "provincial_appeal", "provincial_superior", "tribunal"];
const WINTYPES: WinType[] = ["doctrine_win", "party_win", "mixed", "loss", "unclassified"];

export default async function CasesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const q = searchParams.q ?? "";
  const tier: CorpusTier | "all" = (searchParams.tier as CorpusTier | "all") || (q ? "all" : "core");
  const filter = {
    themes: searchParams.theme ? [searchParams.theme as Theme] : undefined,
    level: (searchParams.level as CourtLevel) || undefined,
    winType: (searchParams.winType as WinType) || undefined,
    nation: searchParams.nation || undefined,
    yearFrom: searchParams.yearFrom ? Number(searchParams.yearFrom) : undefined,
    yearTo: searchParams.yearTo ? Number(searchParams.yearTo) : undefined,
    tier,
  };
  const cases = q ? await casesRepo.hybridSearch(q, filter) : await casesRepo.listCases(filter);
  const facets = await casesRepo.listFacets({ tier: "all" });
  const nations = Object.keys(facets.byNation).sort();

  const sel = "rounded border border-line bg-panel px-2 py-1";
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-serif text-2xl">Legal cases — economic justice</h1>
      <p className="mt-1 text-sm text-ink3">Canada&apos;s Indigenous economic-justice case law, searchable and citation-anchored.</p>

      <form action="/cases" className="mt-4 space-y-2">
        <div className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search citation, case name, or full text…" className="flex-1 rounded border border-line bg-panel px-3 py-2" />
          <button className="rounded bg-ink px-4 py-2 text-bg hover:bg-ink/90">Search</button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select name="tier" defaultValue={searchParams.tier ?? ""} className={sel} aria-label="Tier">
            <option value="">Tier: auto</option><option value="core">Core only</option><option value="all">All tiers</option>
          </select>
          <select name="theme" defaultValue={searchParams.theme ?? ""} className={sel} aria-label="Theme">
            <option value="">All themes</option>{THEMES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <select name="level" defaultValue={searchParams.level ?? ""} className={sel} aria-label="Court level">
            <option value="">All courts</option>{LEVELS.map((l) => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}
          </select>
          <select name="winType" defaultValue={searchParams.winType ?? ""} className={sel} aria-label="Outcome">
            <option value="">All outcomes</option>{WINTYPES.map((w) => <option key={w} value={w}>{w.replace(/_/g, " ")}</option>)}
          </select>
          <select name="nation" defaultValue={searchParams.nation ?? ""} className={sel} aria-label="Nation">
            <option value="">All nations</option>{nations.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input name="yearFrom" defaultValue={searchParams.yearFrom ?? ""} placeholder="from yr" className={`w-20 ${sel}`} aria-label="Year from" />
          <input name="yearTo" defaultValue={searchParams.yearTo ?? ""} placeholder="to yr" className={`w-20 ${sel}`} aria-label="Year to" />
          <Link href="/cases" className="rounded-full border border-line px-3 py-1 hover:bg-ink/5">clear</Link>
        </div>
      </form>

      <div className="mt-3 text-xs text-ink3">
        {cases.length} result{cases.length === 1 ? "" : "s"} · {q ? "ranked by relevance" : "browse"} · tier: {tier}
      </div>

      <ul className="mt-3 divide-y divide-line">
        {cases.map((c) => <CaseListItem key={c.id} c={c} q={q} />)}
        {cases.length === 0 && <li className="py-3 text-ink3">No cases match.</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0. (Confirms `Theme`/`CourtLevel`/`WinType`/`CorpusTier` are exported from `@/lib/cases`; `CorpusTier` is in `types.ts` — if not already in the `index.ts` re-export list, add it.)

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/app/cases/page.tsx src/lib/cases/index.ts
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): search page — substrate-inclusive, full filter form, tier rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Detail page (full-text reader + core sections)

**Files:** Modify `src/app/cases/[id]/page.tsx` (replace the whole file).

- [ ] **Step 1: Implement** — replace `src/app/cases/[id]/page.tsx` with:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { casesRepo } from "@/lib/cases";
import { TierBadge, FullTextReader, ProvenanceFooter } from "../ui";

export default async function CaseDetail({
  params, searchParams,
}: { params: { id: string }; searchParams: { q?: string } }) {
  const c = await casesRepo.getCase(params.id);
  if (!c) notFound();
  const q = searchParams.q ?? "";
  const graph = await casesRepo.getCitationGraph(c.id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/cases" className="text-sm text-ink3 hover:text-amber hover:underline">← all cases</Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="font-serif text-2xl">{c.styleOfCause}</h1>
        <TierBadge tier={c.corpusTier} fullTextAvailable={c.fullTextAvailable} />
      </div>
      <div className="text-sm text-ink3">{c.citation}{c.citation2 ? ` · ${c.citation2}` : ""} · {c.court} · {c.year}</div>
      {c.themes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 text-xs">
          {c.themes.map((t) => <span key={t} className="rounded border border-line bg-ink/5 px-2 py-0.5">{t.replace(/_/g, " ")}</span>)}
        </div>
      )}

      {c.outcome.holding && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">Holding</h2>
          <p className="text-sm text-ink2">{c.outcome.holding}</p>
          {c.outcome.whoWon && <p className="text-xs text-ink3">Who won: {c.outcome.whoWon}</p>}
        </section>
      )}

      {c.economic && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">Economic dimension</h2>
          <p className="text-sm text-ink2">{c.economic.economicSummary}</p>
          {c.economic.settlementAmount != null && <p className="text-sm text-ink2">Settlement: ${c.economic.settlementAmount.toLocaleString()} CAD</p>}
        </section>
      )}

      {c.valueRealization && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">Value realization</h2>
          <p className="text-sm text-ink2"><span className="rounded bg-cedar/15 px-2 py-0.5 text-cedar">{c.valueRealization.status}</span> {c.valueRealization.note}</p>
        </section>
      )}

      {c.summary && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">Summary <span className="text-xs font-sans font-normal text-ink3">(citation-anchored)</span></h2>
          <ul className="mt-1 space-y-1 text-sm text-ink2">
            {c.summary.claims.map((cl, i) => (
              <li key={i}>{cl.text} <a href={cl.sourceUrl} className="text-xs text-amber hover:underline" target="_blank" rel="noreferrer">[{cl.sourceParagraph}]</a></li>
            ))}
          </ul>
        </section>
      )}

      {!c.outcome.holding && !c.fullTextAvailable && (
        <p className="mt-4 rounded border border-line bg-ink/5 px-3 py-2 text-sm text-ink3">
          Not yet curated, and no full text is available for this record. See the official source below.
        </p>
      )}

      {c.chunks && c.chunks.length > 0 && <FullTextReader chunks={c.chunks} q={q} />}

      <section className="mt-4">
        <h2 className="font-serif text-lg">Citations</h2>
        <p className="text-sm text-ink2">Cited by {c.citingCount} case(s).</p>
        <div className="mt-1 grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-xs text-ink3">Cites</div>{graph.cited.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:text-amber hover:underline">{g.styleOfCause}</Link>)}</div>
          <div><div className="text-xs text-ink3">Cited by</div>{graph.citing.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:text-amber hover:underline">{g.styleOfCause}</Link>)}</div>
        </div>
      </section>

      <ProvenanceFooter c={c} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/app/cases/[id]/page.tsx
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): detail page — full-text reader + tier badge + graceful empty enriched

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Activation dashboard — $ aggregates

**Files:** Modify `src/app/cases/activation/page.tsx` (replace the whole file; reuse `StatCard`/`Bar` from `ui.tsx`).

- [ ] **Step 1: Implement** — replace `src/app/cases/activation/page.tsx` with:
```tsx
import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import { StatCard, Bar } from "../ui";

const cad = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);

export default async function ActivationPage() {
  const s = await casesRepo.getActivationSummary();
  const themes = Object.entries(s.byTheme);
  const maxTheme = Math.max(1, ...themes.map(([, n]) => n));
  const real = s.valueRealization;
  const ev = s.economicValue;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Activation dashboard</h1>
      <p className="mt-1 text-sm text-ink3">Turning Indigenous legal wins into economic intelligence (curated core cases).</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatCard label="curated cases" value={s.totalCases} />
        <StatCard label="value realized" value={real.realized ?? 0} />
        <StatCard label="negotiating" value={real.negotiating ?? 0} />
      </div>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Economic value <span className="text-xs font-sans font-normal text-ink3">(recorded across core cases)</span></h2>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <StatCard label="settlements" value={cad(ev.settlement)} />
          <StatCard label="resource revenue" value={cad(ev.resourceRevenue)} />
          <StatCard label="equity stake %" value={ev.equity} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">By theme</h2>
        <div className="mt-2 space-y-1">
          {themes.map(([t, n]) => <Bar key={t} label={t.replace(/_/g, " ")} n={n} max={maxTheme} />)}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Value-realization funnel</h2>
        <div className="mt-2 flex gap-3 text-sm">
          {(["declared", "negotiating", "realized", "stalled"] as const).map((k) => (
            <div key={k} className="rounded border border-line bg-panel px-3 py-2">
              <div className="font-serif text-lg">{real[k] ?? 0}</div><div className="text-xs text-ink3">{k}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Landmark cases <span className="text-xs font-sans font-normal text-ink3">(by citation authority)</span></h2>
        <ul className="mt-1 text-sm">
          {s.landmarkCases.map((c) => (
            <li key={c.id}><Link href={`/cases/${c.id}`} className="hover:text-amber hover:underline">{c.styleOfCause}</Link> <span className="text-ink3">cited {c.citingCount}×</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/app/cases/activation/page.tsx
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): activation dashboard — economic \$ aggregates + shared StatCard/Bar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Methodology page

**Files:** Create `src/app/cases/methodology/page.tsx`.

- [ ] **Step 1: Implement** — `src/app/cases/methodology/page.tsx`:
```tsx
import { casesRepo } from "@/lib/cases";
import { StatCard, Bar } from "../ui";

export default async function MethodologyPage() {
  const st = await casesRepo.getCorpusStats();
  const levels = Object.entries(st.byLevel);
  const maxLevel = Math.max(1, ...levels.map(([, n]) => n));
  const decades = Object.entries(st.byDecade);
  const maxDecade = Math.max(1, ...decades.map(([, n]) => n));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Methodology</h1>
      <p className="mt-1 text-sm text-ink3">How this corpus is built, labeled, and evaluated — transparent by design.</p>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <StatCard label="total cases" value={st.total} />
        <StatCard label="curated core" value={st.core} />
        <StatCard label="substrate" value={st.substrate} />
        <StatCard label="full text" value={st.fullText} />
      </div>

      <section className="mt-6">
        <h2 className="font-serif text-lg">By court level</h2>
        <div className="mt-2 space-y-1">{levels.map(([l, n]) => <Bar key={l} label={l.replace(/_/g, " ")} n={n} max={maxLevel} />)}</div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">By decade</h2>
        <div className="mt-2 space-y-1">{decades.map(([d, n]) => <Bar key={d} label={d} n={n} max={maxDecade} />)}</div>
      </section>

      <section className="mt-6 space-y-4 text-sm text-ink2">
        <div>
          <h2 className="font-serif text-lg">Two-tier corpus</h2>
          <p>A broad <strong>substrate</strong> (full-text judgments, the retrieval haystack) plus a curated <strong>core</strong> (labeled themes, outcome classification, economic dimension, citation-anchored summary). Substrate records are shown as “index only” or “full text”; only core carries curated fields.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Sources &amp; provenance</h2>
          <p>Cases are harvested from the open A2AJ API (metadata + citation graph) and matched to official court decisions for full text. All displayed judgment text is an <strong>unofficial reproduction</strong> of a public decision, linked to its official source; nothing is generated.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Selection (PRISMA-style)</h2>
          <p>Inclusion is an explicit, logged filter (Indigenous + economic-justice signal), so the corpus boundary is auditable rather than editorial.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Labeling</h2>
          <p>Themes and outcome tags on core cases are assigned by dual-model cross-labeling — inter-model agreement measures <em>consistency</em>; accuracy is validated against a human-checked gold sample. Labels are <strong>metadata only</strong>; displayed legal content stays extractive and citation-anchored.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Retrieval evaluation</h2>
          <p>Search quality is measured (nDCG@10 / recall@10 / MRR) on a graded gold set, comparing lexical (BM25) against hybrid retrieval, so ranking changes are evidence-based, not asserted.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Data sovereignty</h2>
          <p>Built to respect OCAP® and CARE principles: public court records only, clearly framed, with community-sensitive material kept out of third-party pipelines.</p>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/app/cases/methodology/page.tsx
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): methodology page — live corpus stats + transparency narrative

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Integration — build, tests, verify, manual smoke

**Files:** none new (runs + verifies).

- [ ] **Step 1: Full offline test sweep**

```bash
cd /c/Users/chntw/Documents/7980/demo && for t in filter-tier corpusstats highlight metrics retrieval eval-queries pack bm25 hybrid embedder chunk embed-helper fulltext; do printf "%-14s " "$t:"; npx tsx scripts/test-cases-$t.ts 2>&1 | tail -1; done
```
Expected: every line prints its `✅ … passed`.

- [ ] **Step 2: Typecheck + production build**

```bash
cd /c/Users/chntw/Documents/7980/demo && npm run typecheck && npm run build
```
Expected: typecheck exit 0; `npm run build` compiles all `/cases` routes (`/cases`, `/cases/[id]`, `/cases/activation`, `/cases/methodology`) with no type/render errors.

- [ ] **Step 3: Golden suite (needs Docker + `npm run ddb:up`)**

```bash
cd /c/Users/chntw/Documents/7980/demo && npm run verify
```
Expected: `🎉 ALL PASS` including `cases: getCorpusStats mock≡dynamo` and `cases: tier:all returns both tiers`.

- [ ] **Step 4: Manual smoke (dynamo, corpus loaded) — record results**

Note: `npm run verify` resets `LegalCases` to the 4 fixtures. To smoke against the full corpus, re-load first if needed (`npm run cases:ingest && npm run cases:fetch-fulltext`, cache-backed). Then run the dev server and check, or spot-check via the repo:
```bash
cd /c/Users/chntw/Documents/7980/demo && DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo npx tsx -e "import('./src/lib/cases').then(async ({casesRepo})=>{const s=await casesRepo.getCorpusStats();console.log('stats',s.total,s.core,s.substrate,s.fullText);const r=await casesRepo.hybridSearch('duty to consult',{tier:'all'});console.log('search hits',r.length, r.slice(0,3).map(c=>c.id));})"
```
Expected: stats print non-trivial totals (e.g. ~3489 / core / substrate / fullText); search returns ranked hits including substrate ids. (Full UI smoke is via `npm run dev` → visit `/cases`, `/cases/<id>?q=consult`, `/cases/activation`, `/cases/methodology`.)

- [ ] **Step 5: Final commit (only if Step 4 produced tracked changes — normally none)**

If `git -C /c/Users/chntw/Documents/7980/demo status --short` shows tracked changes, investigate; otherwise this task is verification-only.

---

## Self-Review

**Spec coverage:** §1 layout → Task 5. Search (substrate-inclusive, filters, tier toggle) → Task 6 (+ tier rule from §5). Detail full-text reader + core sections + empty handling → Task 7. Activation $ aggregates → Task 8. Methodology page → Task 9. Query-layer additions (`tier:"all"`, `buildCorpusStats`/`getCorpusStats`, `dynamo≡mock`) → Tasks 1–2. Components (`TierBadge`/`CaseListItem`/`StatCard`/`Bar`/`ProvenanceFooter`/`FullTextReader`) → Task 4; `highlight` → Task 3. Governance (extractive, disclaimer, tier labels) → layout (Task 5) + `ProvenanceFooter`/`TierBadge` (Task 4) + methodology narrative (Task 9). Testing (pure units + verify parity + build) → Tasks 1/2/3 + Task 10. ✓
  - Deviation from spec §4: `FacetFilters`/`TierToggle` are **not** separate components — the filter UI is a single GET `<form>` inline in the search page (Task 6). Rationale: no client JS, page-specific, avoids premature extraction. Same behavior; documented here.
  - `highlight` lives at `src/app/cases/highlight.ts` (pure, testable) rather than inside `ui.tsx`, so it can be unit-tested without React. Consistent across Tasks 3–4.

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to Task N". Every code step shows complete file/edit content. The §8 spec open-questions are deferred decisions, not plan gaps.

**Type consistency:** `CorpusStats` (Task 1) is returned by `getCorpusStats` (Tasks 1–2) and consumed by the methodology page (Task 9). `CaseFilter.tier: CorpusTier | "all"` (Task 1) is used by `filterCases` (Task 1), the search page (Task 6), and the verify `tier:"all"` check (Task 2). `splitHighlight`/`Seg` (Task 3) consumed by `FullTextReader` (Task 4). `TierBadge({tier, fullTextAvailable})`, `CaseListItem({c, q})`, `StatCard({label, value})`, `Bar({label, n, max})`, `ProvenanceFooter({c})`, `FullTextReader({chunks, q})` signatures identical between definition (Task 4) and all call sites (Tasks 6–9). Repo methods match the `CaseRepo` interface (Task 1). `@/lib/cases` re-exports `LegalCase`/`CaseChunk`/`Theme`/`CourtLevel`/`WinType`/`CorpusTier` — Tasks 4 & 6 add any missing name to the `index.ts` re-export list.
