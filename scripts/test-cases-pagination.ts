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
