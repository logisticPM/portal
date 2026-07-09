# `/cases` Browse & Search Pagination — Design

**Date:** 2026-07-09 · **Status:** approved (design), pre-implementation · **Domain:** `src/app/cases/*`, `src/lib/cases/pagination.ts`

## Motivation

The `/cases` page renders **every** result in one list — 541 in the default core browse — producing a very long page that is slow to scan. Add server-side pagination so each page shows a small, readable slice, consistent with the page's existing **RSC + URL-param, zero-client-JS** pattern (mirrors the filter form and the lens switcher).

## Decisions (confirmed)

- **Page size: 10** per page (541 core → 55 pages).
- **Windowed numbered pager:** `« Prev  1 … 5 6 [7] 8 9 … 55  Next »` — server-rendered `<Link>`s, current page not linked, allows jumping. Better than plain Prev/Next at 55 pages.
- Applies to **both** browse and search (both render the same `ordered` list).

## Architecture

### New pure module — `src/lib/cases/pagination.ts`

All page math is pure and unit-tested here; the component in `ui.tsx` only renders.

```ts
export const PAGE_SIZE = 10;

// Parse ?page (1-based) and clamp into [1, totalPages]. Invalid / out-of-range → nearest valid.
export function clampPage(raw: string | undefined, totalPages: number): number;

// The compact page-number window: always 1 and totalPages, plus current ±2, with
// "ellipsis" markers where a gap is skipped. e.g. (7, 55) → [1,"ellipsis",5,6,7,8,9,"ellipsis",55].
export function paginationWindow(page: number, totalPages: number): (number | "ellipsis")[];

// Build the href for a target page, preserving ALL current query params (q, tier, theme,
// level, winType, nation, yearFrom, yearTo, lens) and overriding `page`. Mirrors lensHref:
// URLSearchParams, skip empties. `page` is omitted when target === 1 (clean base URL).
export function pageHref(params: Record<string, string | undefined>, page: number): string;
```

- `clampPage`: `const n = Math.floor(Number(raw)); return Number.isFinite(n) && n >= 1 ? Math.min(n, totalPages) : 1;` (with `totalPages >= 1` guaranteed by the caller).
- `paginationWindow`: build the set `{1, totalPages} ∪ {page-2 … page+2}` (clamped to `[1, totalPages]`), sort ascending, dedupe, then walk inserting `"ellipsis"` wherever `next - prev > 1`.
- `pageHref`: `const p = new URLSearchParams(); for ([k,v] of entries) if (k!=="page" && v!=null && v!=="") p.set(k,v); if (page > 1) p.set("page", String(page)); const s = p.toString(); return s ? \`/cases?${s}\` : "/cases";`

### `src/app/cases/ui.tsx` — new `Pagination` component

```tsx
export function Pagination({ page, totalPages, params }: {
  page: number; totalPages: number; params: Record<string, string | undefined>;
}) { … }
```

- Returns `null` when `totalPages <= 1` (nothing to paginate).
- Renders a nav row: **« Prev** (rendered as a `<Link>` when `page > 1`, otherwise a disabled/muted span), the `paginationWindow(page, totalPages)` entries (each number a `<Link href={pageHref(params, n)}>`; the **current** page a non-link bold span with `aria-current="page"`; each `"ellipsis"` a muted `…`), and **Next »** (link when `page < totalPages`, else muted span).
- Styling follows the page's existing utility-class vocabulary (`rounded border border-line`, `text-ink2/3`, `hover:text-amber`, current = `bg-amber/20 text-amber`), matching `LensSwitcher`.

### `src/app/cases/page.tsx` — slice + render pager

After `ordered` is computed (unchanged retrieval/lens logic):

```tsx
const total = ordered.length;
const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
const page = clampPage(searchParams.page, totalPages);
const start = (page - 1) * PAGE_SIZE;
const pageItems = ordered.slice(start, start + PAGE_SIZE);
```

- Render `pageItems` (not `ordered`) in the `<ul>`; the empty-state `<li>` shows when `total === 0`.
- Count line gains the window when there are results:
  `{total} result{s} · {total > 0 ? \`showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} · \` : ""}{q ? "ranked by relevance" : "browse"} · tier: {tier}`
- Add `<Pagination page={page} totalPages={totalPages} params={searchParams} />` immediately after the `<ul>`.

### Filter/search interaction (no extra work)

The filter `<form action="/cases">` does **not** carry a `page` field, so any new search/filter submission (and the "clear" link) naturally returns to page 1. Lens reordering happens on the full `ordered` list **before** slicing, so page contents are stable across navigation.

## Testing (offline, TDD)

New `scripts/test-cases-pagination.ts` (Node + `tsx`, no network), unit-testing the pure helpers:

- `clampPage`: `undefined→1`, `"3"→3`, `"0"→1`, `"-5"→1`, `"abc"→1`, `"999"(tp=55)→55`, `"2"→2`.
- `paginationWindow`: `(1,1)→[1]`; `(3,5)→[1,2,3,4,5]`; `(1,55)→[1,2,3,"ellipsis",55]`; `(7,55)→[1,"ellipsis",5,6,7,8,9,"ellipsis",55]`; `(55,55)→[1,"ellipsis",53,54,55]`.
- `pageHref`: `({q:"x",tier:"core",page:"3"}, 2) → "/cases?q=x&tier=core&page=2"`; `({}, 1) → "/cases"`; `({theme:"treaty"}, 1) → "/cases?theme=treaty"` (page dropped on 1); lens preserved.

Gate: `npx tsx scripts/test-cases-pagination.ts` passes; `npm run typecheck` clean; `npm run build` compiles. (Pages are RSC with no existing unit tests; the `Pagination` component is verified by build + an optional browser spot-check.)

## Explicitly NOT doing (YAGNI)

- No client-side JS / infinite scroll — server pagination only.
- No configurable page size UI — `PAGE_SIZE` is a constant.
- No change to retrieval, lens, filters, or storage.

## Success criteria

- Browse and search show 10 results per page with a working windowed pager; page links preserve all active filters/search/lens; out-of-range `?page` clamps safely; a new search/filter resets to page 1.
- Pure-helper tests green; typecheck + build clean; no change to any non-`/cases` behavior.
