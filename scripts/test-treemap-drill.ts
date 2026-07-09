// Drilling a treemap leaf must add BOTH the parent (sector) and leaf (type)
// filters, so two leaves of the same type under different sectors differ.
import assert from "node:assert/strict";

type Filter = { dim: string; key: string };
function drillLeaf(existing: Filter[], primary: string, secondary: string, leafKey: string, parentKey?: string): Filter[] {
  const add = (cur: Filter[], dim: string, key: string) =>
    cur.some((f) => f.dim === dim && f.key === key) ? cur : [...cur, { dim, key }];
  let next = existing;
  if (parentKey) next = add(next, primary, parentKey);
  next = add(next, secondary, leafKey);
  return next;
}

const a = drillLeaf([], "sector", "commitmentType", "relationships", "energy");
const b = drillLeaf([], "sector", "commitmentType", "relationships", "transport");
assert.deepEqual(a, [{ dim: "sector", key: "energy" }, { dim: "commitmentType", key: "relationships" }]);
assert.notDeepEqual(a, b); // same type, different sector -> different filters
console.log("✅ test-treemap-drill passed");
