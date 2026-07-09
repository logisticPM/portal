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
