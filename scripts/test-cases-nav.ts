import assert from "node:assert/strict";
import { activeHref, CASES_TABS } from "../src/app/cases/nav-active";

// Each tab owns its own route.
for (const t of CASES_TABS) assert.equal(activeHref(t.href), t.href, `${t.href} owns itself`);

// Sub-routes belong to their section, not to /cases.
assert.equal(activeHref("/cases/briefings/abc-123"), "/cases/briefings");

// A case-detail URL owns no tab, so it falls back to Cases rather than lighting up nothing.
assert.equal(activeHref("/cases/2024-scc-1"), "/cases");
assert.equal(activeHref("/cases/2018-bcsc-822"), "/cases");

// The bug a naive startsWith would produce: every route begins with "/cases", so Cases
// must NOT win on a sibling route.
assert.notEqual(activeHref("/cases/activation"), "/cases");
assert.notEqual(activeHref("/cases/methodology"), "/cases");

// A prefix that is not a path segment must not match: "/cases/similarity" is not
// "/cases/similar".
assert.equal(activeHref("/cases/similarity"), "/cases",
  "segment boundary matters — startsWith(href) alone would wrongly claim this");

// Exactly one tab can be active for any path.
for (const p of ["/cases", "/cases/similar", "/cases/briefings/x", "/cases/2024-scc-1", "/cases/similarity"]) {
  const a = activeHref(p);
  assert.equal(CASES_TABS.filter((t) => t.href === a).length, 1, `${p} → exactly one active tab`);
}

console.log("✅ test-cases-nav passed");
