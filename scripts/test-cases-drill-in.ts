import assert from "node:assert/strict";
import { filterCases, caseFixtures } from "../src/lib/cases/query";
import { describeDrillIns } from "../src/lib/cases/drill-in";
import type { LegalCase } from "../src/lib/cases/types";

// --- describeDrillIns ---
assert.deepEqual(describeDrillIns({}), [], "no params → no chips");
assert.deepEqual(describeDrillIns({ theme: "land_rights" }), [],
  "theme has its own <select>, so it is not a drill-in chip");

{
  const [chip, ...rest] = describeDrillIns({ realization: "realized", tier: "core" });
  assert.equal(rest.length, 0);
  assert.equal(chip.label, "Value realized");
  assert.equal(chip.without, "/cases?tier=core", "removing the chip preserves the other params");
}

// A stale page number must not survive filter removal: the reader would land past the end
// of a now-longer/shorter list and see an empty page.
assert.equal(describeDrillIns({ realization: "stalled", page: "4" })[0].without, "/cases",
  "page is dropped when a filter is removed");

// Removing one chip leaves the other in place.
{
  const chips = describeDrillIns({ realization: "declared", fullText: "no" });
  assert.equal(chips.length, 2);
  assert.equal(chips.find((c) => c.key === "realization")!.without, "/cases?fullText=no");
  assert.equal(chips.find((c) => c.key === "fullText")!.without, "/cases?realization=declared");
}

// Junk values are ignored rather than rendered as a chip with a blank label.
assert.deepEqual(describeDrillIns({ realization: "bogus", figureKind: "nope", fullText: "maybe" }), []);

// --- filterCases: the three new dimensions ---
// caseFixtures[0] carries its own valueRealization/extractedFigures. Clearing them in the
// factory is what makes each row below test exactly one dimension — without it every clone
// inherits the fixture's status and the assertions pass or fail for the wrong reason.
const base: LegalCase = { ...caseFixtures[0], valueRealization: undefined, extractedFigures: [], corpusTier: "core" };
const mk = (over: Partial<LegalCase>): LegalCase => ({ ...base, ...over });

const pool: LegalCase[] = [
  mk({ id: "r-realized", valueRealization: { status: "realized", note: "", asOf: "2026-01-01" } }),
  mk({ id: "r-stalled", valueRealization: { status: "stalled", note: "", asOf: "2026-01-01" } }),
  mk({ id: "r-none", valueRealization: undefined }),
  mk({ id: "f-settlement", extractedFigures: [{ kind: "settlement", amount: 1, unit: "CAD", quote: "", sourceParagraph: "para-1" } as never] }),
  mk({ id: "f-equity", extractedFigures: [{ kind: "equity", amount: 1, unit: "%", quote: "", sourceParagraph: "para-1" } as never] }),
  mk({ id: "f-none", extractedFigures: [] }),
  mk({ id: "t-yes", fullTextAvailable: true }),
  mk({ id: "t-no", fullTextAvailable: false }),
];

const ids = (f: Parameters<typeof filterCases>[1]) => filterCases(pool, f).map((c) => c.id).sort();

assert.deepEqual(filterCases(pool, { realization: "realized" }).map((c) => c.id), ["r-realized"]);
// The load-bearing one: a case that was never assessed is NOT "unknown". Folding absence
// into a status would silently pad whichever funnel bucket the reader clicked.
assert.deepEqual(filterCases(pool, { realization: "unknown" }).map((c) => c.id), [],
  "a case with no valueRealization must not answer to any status");

assert.deepEqual(filterCases(pool, { figureKind: "settlement" }).map((c) => c.id), ["f-settlement"]);
assert.deepEqual(filterCases(pool, { figureKind: "damages" }).map((c) => c.id), [],
  "a kind nobody recorded returns nothing, not everything");

assert.ok(ids({ fullText: "no" }).includes("t-no"));
assert.ok(!ids({ fullText: "no" }).includes("t-yes"));
assert.equal(ids({ fullText: "yes" }).length + ids({ fullText: "no" }).length, pool.length,
  "yes and no partition the pool — no case is invisible to both");

// New dimensions compose with the old ones rather than replacing them.
assert.deepEqual(
  filterCases(pool, { realization: "realized", level: base.level }).map((c) => c.id),
  ["r-realized"]);
assert.deepEqual(filterCases(pool, { realization: "realized", level: "tribunal" }).map((c) => c.id), [],
  "an AND that excludes everything returns nothing, not the wider set");

console.log("✅ test-cases-drill-in passed");
