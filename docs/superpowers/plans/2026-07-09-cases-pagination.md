# `/cases` Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side pagination (10/page, windowed numbered pager) to the `/cases` browse & search list, consistent with the page's zero-client-JS RSC + URL-param pattern.

**Architecture:** A new pure module `src/lib/cases/pagination.ts` holds all page math (`PAGE_SIZE`, `clampPage`, `paginationWindow`, `pageHref`) and is unit-tested. A `Pagination` component in `ui.tsx` renders `<Link>`s using those helpers. `page.tsx` slices the already-ordered list by `?page` and renders the current slice + the pager.

**Tech Stack:** TypeScript, Next.js 14 App Router (RSC), `URLSearchParams`, Node test script via `tsx`, Tailwind utility classes.

**Spec:** `docs/specs/2026-07-09-cases-pagination-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/pagination.ts` | **New.** Pure page math: `PAGE_SIZE`, `clampPage`, `paginationWindow`, `pageHref`. |
| `scripts/test-cases-pagination.ts` | **New.** Unit tests for the pure helpers. |
| `src/app/cases/ui.tsx` | Add the `Pagination` render component. |
| `src/app/cases/page.tsx` | Slice by `?page`; render slice + count-line window + `<Pagination>`. |

No other files change. Retrieval, lens, filters, and storage are untouched.

---

### Task 1: Pure pagination module + tests (TDD)

**Files:**
- Create: `src/lib/cases/pagination.ts`
- Create (test): `scripts/test-cases-pagination.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-pagination.ts`:

```ts
// Tests for the pure pagination helpers (spec 2026-07-09). Offline, no network.
import assert from "node:assert/strict";

(async () => {
  const { PAGE_SIZE, clampPage, paginationWindow, pageHref } =
    await import("../src/lib/cases/pagination");

  // --- PAGE_SIZE ---
  assert.equal(PAGE_SIZE, 10);

  // --- clampPage: invalid / out-of-range → nearest valid ---
  assert.equal(clampPage(undefined, 55), 1);
  assert.equal(clampPage("3", 55), 3);
  assert.equal(clampPage("0", 55), 1);
  assert.equal(clampPage("-5", 55), 1);
  assert.equal(clampPage("abc", 55), 1);
  assert.equal(clampPage("999", 55), 55);
  assert.equal(clampPage("2", 55), 2);
  assert.equal(clampPage("2.5", 55), 2);

  // --- paginationWindow: first+last always, current ±2, ellipsis on gaps ---
  assert.deepEqual(paginationWindow(1, 1), [1]);
  assert.deepEqual(paginationWindow(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(paginationWindow(1, 55), [1, 2, 3, "ellipsis", 55]);
  assert.deepEqual(paginationWindow(7, 55), [1, "ellipsis", 5, 6, 7, 8, 9, "ellipsis", 55]);
  assert.deepEqual(paginationWindow(55, 55), [1, "ellipsis", 53, 54, 55]);

  // --- pageHref: preserves params, overrides page, drops page on 1 ---
  assert.equal(pageHref({ q: "x", tier: "core", page: "3" }, 2), "/cases?q=x&tier=core&page=2");
  assert.equal(pageHref({}, 1), "/cases");
  assert.equal(pageHref({ theme: "treaty" }, 1), "/cases?theme=treaty");
  assert.equal(pageHref({ lens: "corporate" }, 3), "/cases?lens=corporate&page=3");

  console.log("✅ test-cases-pagination passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-pagination.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/pagination'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/cases/pagination.ts`:

```ts
// Pure pagination helpers for /cases browse & search (spec 2026-07-09). All page
// math lives here (unit-tested); the Pagination component in ui.tsx only renders.
export const PAGE_SIZE = 10;

// Parse the 1-based ?page param and clamp into [1, totalPages]. Invalid / out-of-range
// values fall back to the nearest valid page. Caller guarantees totalPages >= 1.
export function clampPage(raw: string | undefined, totalPages: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, totalPages);
}

// Compact page-number window: always 1 and totalPages, plus current ±2, with "ellipsis"
// markers where a run of pages is skipped. e.g. (7, 55) → [1,"ellipsis",5,6,7,8,9,"ellipsis",55].
export function paginationWindow(page: number, totalPages: number): (number | "ellipsis")[] {
  const set = new Set<number>([1, totalPages]);
  for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= totalPages) set.add(p);
  const pages = [...set].sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of pages) {
    if (prev && p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}

// Href for a target page, preserving all current query params (q, tier, theme, level,
// winType, nation, yearFrom, yearTo, lens) and overriding `page`. Mirrors lensHref:
// URLSearchParams, skip empties. `page` is omitted when target === 1 (clean base URL).
export function pageHref(params: Record<string, string | undefined>, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "page") continue;
    if (v != null && v !== "") p.set(k, v);
  }
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/cases?${s}` : "/cases";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-pagination.ts`
Expected: PASS — `✅ test-cases-pagination passed`.

Also run `npm run typecheck` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/pagination.ts scripts/test-cases-pagination.ts
git commit -m "feat: add pure pagination helpers for /cases"
```

---

### Task 2: `Pagination` component + wire `page.tsx`

**Files:**
- Modify: `src/app/cases/ui.tsx` (add `Pagination`; `Link` is already imported at the top)
- Modify: `src/app/cases/page.tsx` (imports, slice, count line, render slice + pager)

No unit test (RSC/presentation). Verified by `npm run typecheck` + `npm run build`.

- [ ] **Step 1: Add the `Pagination` component to `ui.tsx`**

Add this import near the top of `src/app/cases/ui.tsx` (after the existing imports):

```tsx
import { paginationWindow, pageHref } from "@/lib/cases/pagination";
```

Append this component to `src/app/cases/ui.tsx`:

```tsx
export function Pagination({ page, totalPages, params }: {
  page: number; totalPages: number; params: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;
  const cell = "rounded border border-line px-3 py-1 text-sm";
  const link = `${cell} text-ink2 hover:border-amber/50 hover:text-amber`;
  const muted = `${cell} text-ink3/50`;
  const current = `${cell} bg-amber/20 text-amber`;
  return (
    <nav className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Pagination">
      {page > 1
        ? <Link href={pageHref(params, page - 1)} className={link}>« Prev</Link>
        : <span className={muted} aria-disabled="true">« Prev</span>}
      {paginationWindow(page, totalPages).map((p, i) =>
        p === "ellipsis"
          ? <span key={`e${i}`} className="px-1 text-ink3">…</span>
          : p === page
            ? <span key={p} aria-current="page" className={current}>{p}</span>
            : <Link key={p} href={pageHref(params, p)} className={link}>{p}</Link>)}
      {page < totalPages
        ? <Link href={pageHref(params, page + 1)} className={link}>Next »</Link>
        : <span className={muted} aria-disabled="true">Next »</span>}
    </nav>
  );
}
```

- [ ] **Step 2: Wire `page.tsx`**

In `src/app/cases/page.tsx`:

(a) Update the `./ui` import to include `Pagination`:

```tsx
import { CaseListItem, LensSwitcher, Pagination } from "./ui";
```

(b) Add the pagination-module import (near the other `@/lib/cases` imports):

```tsx
import { PAGE_SIZE, clampPage } from "@/lib/cases/pagination";
```

(c) Immediately AFTER the line `const ordered = q ? cases : applyLens(cases, lens);`, add:

```tsx
  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = clampPage(searchParams.page, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = ordered.slice(start, start + PAGE_SIZE);
```

(d) Replace the count-line block:

```tsx
      <div className="mt-3 text-xs text-ink3">
        {cases.length} result{cases.length === 1 ? "" : "s"} · {q ? "ranked by relevance" : "browse"} · tier: {tier}
      </div>
```

with:

```tsx
      <div className="mt-3 text-xs text-ink3">
        {total} result{total === 1 ? "" : "s"} · {total > 0 ? `showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} · ` : ""}{q ? "ranked by relevance" : "browse"} · tier: {tier}
      </div>
```

(e) Replace the `<ul>` block:

```tsx
      <ul className="mt-3 divide-y divide-line">
        {ordered.map((c) => <CaseListItem key={c.id} c={c} q={q} />)}
        {ordered.length === 0 && (
          <li className="py-3 text-ink3">
            {q
              ? "No cases match."
              : "No cases in this view yet — the corpus may not be loaded in this environment. See Methodology for corpus status."}
          </li>
        )}
      </ul>
```

with (render the slice; add the pager after the list):

```tsx
      <ul className="mt-3 divide-y divide-line">
        {pageItems.map((c) => <CaseListItem key={c.id} c={c} q={q} />)}
        {total === 0 && (
          <li className="py-3 text-ink3">
            {q
              ? "No cases match."
              : "No cases in this view yet — the corpus may not be loaded in this environment. See Methodology for corpus status."}
          </li>
        )}
      </ul>

      <Pagination page={page} totalPages={totalPages} params={searchParams} />
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed; `/cases` compiles.

- [ ] **Step 4: Commit**

```bash
git add src/app/cases/ui.tsx src/app/cases/page.tsx
git commit -m "feat: paginate /cases browse & search (10/page, windowed pager)"
```

---

## Self-Review

**Spec coverage:**
- `pagination.ts` (`PAGE_SIZE`/`clampPage`/`paginationWindow`/`pageHref`) → Task 1. ✓
- `Pagination` component → Task 2 step 1. ✓
- Slice + count-line window + pager render in `page.tsx` → Task 2 step 2. ✓
- Tests (clamp/window/href) → Task 1 step 1. ✓
- Browse + search both paginate (both use `ordered`/`pageItems`) → Task 2 step 2c/2e. ✓
- Filter form resets to page 1 (form has no `page` field) — inherent, no code needed. ✓

**Placeholder scan:** none — every code step is complete.

**Type/name consistency:** `clampPage(raw: string | undefined, totalPages)`, `paginationWindow(page, totalPages)`, `pageHref(params, page)`, and `PAGE_SIZE` are defined in Task 1 and imported/called identically in Task 1's test and Task 2 (`page.tsx` imports `PAGE_SIZE, clampPage`; `ui.tsx` imports `paginationWindow, pageHref`). The `"ellipsis"` marker string matches between `paginationWindow`, the test, and the component's render check.
