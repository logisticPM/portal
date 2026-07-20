# Citation Treatment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the case-detail "Citations" section to show the verbatim passage where each later case cites this decision (extractive, anchored) — no treatment classification, no new storage, no ops.

**Architecture:** A pure `treatment.ts` (`findCitingPassage`) matches a citing case's chunks against this case's citation/style-of-cause and returns a windowed verbatim excerpt. `[id]/page.tsx` fetches each resolved citing case's chunks (`getCase`, capped 10) and renders the excerpts. No repo interface change.

**Tech Stack:** TypeScript, Next.js 14 RSC, Node test via `tsx`, Tailwind.

**Spec:** `docs/specs/2026-07-19-citation-treatment-design.md`

---

## File Structure

| File | Change |
|---|---|
| `src/lib/cases/treatment.ts` | **New pure.** `leadParty`, `findCitingPassage`, `CitingPassage`/`CiteTarget`. |
| `scripts/test-cases-treatment.ts` | **New** unit tests. |
| `src/app/cases/[id]/page.tsx` | Compute treatments (getCase per citing, capped 10) + restructure Citations section. |
| `src/app/cases/methodology/page.tsx` | Short methodology note. |

Unchanged: `getCitationGraph`, `CaseRepo`, storage, ingest. `LegalCase.chunks?: CaseChunk[]` is populated by `getCase` (reassembleCase); `CaseChunk = { paragraph: string; text: string }`; `LegalCase` has `citation: string`, `citation2?: string`, `styleOfCause`, `court`, `year`, `citingCount`.

---

### Task 1: Pure treatment module + tests (TDD)

**Files:**
- Create: `src/lib/cases/treatment.ts`
- Create: `scripts/test-cases-treatment.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-treatment.ts`:

```ts
// Tests for the pure citation-treatment module (spec 2026-07-19). Offline, no network.
import assert from "node:assert/strict";

(async () => {
  const { leadParty, findCitingPassage } = await import("../src/lib/cases/treatment");
  const ch = (paragraph: string, text: string) => ({ paragraph, text });
  const target = { citation: "2004 SCC 73", citation2: "[2004] 3 SCR 511", styleOfCause: "Haida Nation v. British Columbia (Minister of Forests)" };

  // --- leadParty ---
  assert.equal(leadParty("Haida Nation v. British Columbia (Minister of Forests)"), "Haida Nation");
  assert.equal(leadParty("R. v. Sparrow"), "R.");
  assert.equal(leadParty("Reference re Secession of Quebec"), "Reference re Secession of Quebec");

  // --- citation match ---
  const p1 = findCitingPassage([ch("para-5", "The court applied Haida Nation, 2004 SCC 73, to these facts.")], target);
  assert.ok(p1 && p1.paragraph === "para-5" && p1.text.includes("2004 SCC 73"));

  // --- citation2 fallback (no neutral cite in text) ---
  const p2 = findCitingPassage([ch("para-2", "See [2004] 3 SCR 511 on the duty to consult.")], target);
  assert.ok(p2 && p2.text.includes("[2004] 3 SCR 511"));

  // --- leadParty fallback ---
  const p3 = findCitingPassage([ch("para-1", "As held in Haida Nation, consultation is required.")], target);
  assert.ok(p3 && p3.text.includes("Haida Nation"));

  // --- precedence: citation (later chunk) beats leadParty (earlier chunk) ---
  const p4 = findCitingPassage([
    ch("para-1", "Following Haida Nation broadly."),
    ch("para-9", "precisely per 2004 SCC 73 at para 35."),
  ], target);
  assert.equal(p4?.paragraph, "para-9");

  // --- short lead party (<4 chars) not used → no false match ---
  const p5 = findCitingPassage([ch("para-1", "In R. the accused argued ...")], { citation: "1990 SCC 1", styleOfCause: "R. v. Sparrow" });
  assert.equal(p5, null);

  // --- no reference → null ---
  assert.equal(findCitingPassage([ch("para-1", "entirely unrelated text")], target), null);

  // --- windowing: long chunk truncated with … and excerpt is a verbatim substring ---
  const long = "x".repeat(300) + "2004 SCC 73" + "y".repeat(300);
  const p6 = findCitingPassage([ch("para-1", long)], target);
  assert.ok(p6 && p6.truncated && p6.text.startsWith("…") && p6.text.endsWith("…"));
  assert.ok(long.includes(p6!.text.replace(/^…/, "").replace(/…$/, "")));

  // --- short chunk fully shown: no truncation, no ellipsis, verbatim ---
  const short = "See 2004 SCC 73 here.";
  const p7 = findCitingPassage([ch("para-1", short)], target);
  assert.ok(p7 && !p7.truncated && !p7.text.includes("…") && p7.text === short);

  console.log("✅ test-cases-treatment passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-treatment.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/treatment'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/cases/treatment.ts`:

```ts
// Pure citation-treatment (spec 2026-07-19): find the verbatim passage where a CITING case
// references this decision. Extractive + anchored; no classification, no LLM.
import type { CaseChunk } from "./types";

export interface CitingPassage { text: string; paragraph: string; truncated: boolean }
export interface CiteTarget { citation: string; citation2?: string; styleOfCause: string }

const WINDOW = 200;

// Lead party (appellant/plaintiff): the token before " v." — usually the distinctive name,
// e.g. "Haida Nation v. British Columbia…" → "Haida Nation". No " v." → the whole string.
export function leadParty(styleOfCause: string): string {
  return styleOfCause.split(/\s+v\.?\s+/i)[0].trim();
}

// Search chunks for a reference to `target`, in precedence order (citation, citation2, lead
// party — the last only if ≥4 chars, to avoid noise like "R."). Returns a windowed verbatim
// excerpt (±WINDOW chars, "…"-marked when trimmed) from the first matching chunk, or null.
export function findCitingPassage(chunks: CaseChunk[], target: CiteTarget): CitingPassage | null {
  const needles = [target.citation, target.citation2 ?? ""].filter((s) => s.length >= 3);
  const lp = leadParty(target.styleOfCause);
  if (lp.length >= 4) needles.push(lp);

  for (const n of needles) {
    const nl = n.toLowerCase();
    for (const ch of chunks) {
      const i = ch.text.toLowerCase().indexOf(nl);
      if (i < 0) continue;
      const start = Math.max(0, i - WINDOW);
      const end = Math.min(ch.text.length, i + n.length + WINDOW);
      let text = ch.text.slice(start, end);
      const truncated = start > 0 || end < ch.text.length;
      if (start > 0) text = "…" + text;
      if (end < ch.text.length) text = text + "…";
      return { text, paragraph: ch.paragraph, truncated };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-treatment.ts`  → expect `✅ test-cases-treatment passed`.
Also `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/treatment.ts scripts/test-cases-treatment.ts
git commit -m "feat: pure citation-treatment findCitingPassage + tests"
```

---

### Task 2: Wire case-detail + methodology note

**Files:**
- Modify: `src/app/cases/[id]/page.tsx`
- Modify: `src/app/cases/methodology/page.tsx`

Presentation — verified by `typecheck` + `build`.

- [ ] **Step 1: Import + compute treatments in `[id]/page.tsx`**

Add the import (with the other `@/lib/cases` imports near the top):

```tsx
import { findCitingPassage } from "@/lib/cases/treatment";
```

Immediately AFTER the existing line `const graph = await casesRepo.getCitationGraph(c.id);`, add:

```tsx
  const citingTop = [...graph.citing]
    .sort((a, b) => b.year - a.year || b.citingCount - a.citingCount)
    .slice(0, 10);
  const citeTarget = { citation: c.citation, citation2: c.citation2, styleOfCause: c.styleOfCause };
  const treated = await Promise.all(citingTop.map(async (g) => {
    const full = await casesRepo.getCase(g.id);
    const passage = full?.chunks?.length ? findCitingPassage(full.chunks, citeTarget) : null;
    return { case: g, passage };
  }));
  const withSnippet = treated.filter((t) => t.passage).length;
```

- [ ] **Step 2: Replace the Citations section**

Replace this exact block:

```tsx
      <section className="mt-4">
        <h2 className="font-serif text-lg">Citations</h2>
        <p className="text-sm text-ink2">Cited by {c.citingCount} case(s).</p>
        <div className="mt-1 grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-xs text-ink3">Cites</div>{graph.cited.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:text-amber hover:underline">{g.styleOfCause}</Link>)}</div>
          <div><div className="text-xs text-ink3">Cited by</div>{graph.citing.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:text-amber hover:underline">{g.styleOfCause}</Link>)}</div>
        </div>
      </section>
```

with:

```tsx
      <section className="mt-4">
        <h2 className="font-serif text-lg">Citations</h2>
        <p className="text-sm text-ink3">
          Cited by {c.citingCount} case(s) · {graph.citing.length} in this library · {withSnippet} shown with the citing passage.
        </p>
        {graph.cited.length > 0 && (
          <div className="mt-2 text-sm">
            <div className="text-xs text-ink3">Cites</div>
            {graph.cited.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:text-amber hover:underline">{g.styleOfCause}</Link>)}
          </div>
        )}
        {treated.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-ink3">Later cases citing this decision</div>
            <p className="mt-1 text-xs text-ink3">The passage where each later case cites this decision — read it to see how the case was used. This is the record, not a verdict on whether the decision still governs. Unofficial; verify against the source.</p>
            <div className="mt-2 space-y-3">
              {treated.map(({ case: g, passage }) => (
                <div key={g.id} className="rounded border border-line bg-panel p-3 text-sm">
                  <Link href={`/cases/${g.id}`} className="font-serif hover:text-amber hover:underline">{g.styleOfCause} ({g.court}, {g.year})</Link>
                  {passage
                    ? <p className="mt-1 text-ink2">&ldquo;{passage.text}&rdquo; <span className="text-xs text-ink3">({passage.paragraph})</span></p>
                    : <p className="mt-1 text-xs text-ink3">In this library; citing passage not located in the available text.</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
```

- [ ] **Step 3: Methodology note**

In `src/app/cases/methodology/page.tsx`, add a new sibling `<div>` section among the existing method sections (e.g. after the "Find similar cases" section), matching the surrounding markup:

```tsx
        <div>
          <h2 className="font-serif text-lg">Citation treatment</h2>
          <p>On a case page, "later cases citing this decision" shows the <strong>verbatim passage</strong> where each in-corpus later case cites it, with its paragraph anchor — so a reader can see <em>how</em> the case was used. It is deliberately <strong>extractive only</strong>: no "followed / distinguished / overruled" classification (a legal conclusion we don't assert), and it is bounded to cases in this library.</p>
        </div>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed; `/cases/[id]` compiles.

- [ ] **Step 5: Commit**

```bash
git add "src/app/cases/[id]/page.tsx" src/app/cases/methodology/page.tsx
git commit -m "feat: extractive citing-passage treatment on case pages"
```

---

## Self-Review

**Spec coverage:** `findCitingPassage`/`leadParty` + windowing + precedence (T1) ✓; citing-passage render, capped-10, coverage line, no-passage degradation, governance framing (T2 steps 1-2) ✓; methodology note (T2 step 3) ✓; tests (T1 step 1) ✓; no repo change / no ops (inherent) ✓; no treatment classification (absent by construction) ✓.

**Placeholder scan:** none — every code step is complete.

**Type/name consistency:** `findCitingPassage(chunks, target)` + `CiteTarget {citation, citation2?, styleOfCause}` defined in T1, called identically in T1's test and T2's page. `passage.text`/`.paragraph`/`.truncated` match `CitingPassage`. `getCase`, `getCitationGraph`, `LegalCase.chunks`, `citation`/`citation2`/`styleOfCause`/`court`/`year`/`citingCount` all exist on this branch.
