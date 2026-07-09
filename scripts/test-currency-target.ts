// The $-committed KPI/measure works for the commitments source: commitmentsToFacts
// parses dollar magnitudes out of the free-text target into targetValue+currency,
// and leaves percentage/head-count/qualitative targets as non-currency (null).
import assert from "node:assert/strict";
import { parseCurrencyTarget, commitmentsToFacts } from "../src/lib/rap-index/commitments-to-facts";
import { reduceMeasure } from "../src/lib/rap/analytics";
import type { Commitment } from "../src/lib/commitments/types";

// --- parser ---
assert.equal(parseCurrencyTarget("$10M per year (exceeded)"), 10_000_000);
assert.equal(parseCurrencyTarget("$1.2B cumulative (2019 to 2025)"), 1_200_000_000);
assert.equal(parseCurrencyTarget("C$3B cumulative by 2030"), 3_000_000_000);
assert.equal(parseCurrencyTarget("over $7B cumulative since 2008"), 7_000_000_000);
assert.equal(parseCurrencyTarget("$100K ITAC sponsorship"), 100_000);
assert.equal(parseCurrencyTarget("$780K to Indigenous organizations"), 780_000);
assert.equal(parseCurrencyTarget("$5.5M Indigenous legacy fund"), 5_500_000);
assert.equal(parseCurrencyTarget("49% Indigenous equity (~$503M)"), 503_000_000); // $ inside a % target
assert.equal(parseCurrencyTarget("5% of annual procurement"), null);  // percent, no $
assert.equal(parseCurrencyTarget("2 community benefit agreements"), null); // count
assert.equal(parseCurrencyTarget("grow Indigenous procurement"), null); // qualitative
assert.equal(parseCurrencyTarget(null), null);
assert.equal(parseCurrencyTarget(undefined), null);

// --- integration: currency measure is now non-zero, non-$ targets contribute 0 ---
const mk = (id: string, targetText: string | undefined): Commitment => ({
  id, orgName: "Org", sector: "finance", orgSize: "enterprise", type: "procurement",
  title: "t", targetYear: 2030, status: "reported", progressPct: 50, history: [],
  createdAt: "2025-01-01", targetText,
});
const facts = commitmentsToFacts([mk("a", "$10M per year"), mk("b", "5% of spend"), mk("c", undefined)]);
assert.equal(facts[0].targetUnit, "currency");
assert.equal(facts[0].targetValue, 10_000_000);
assert.equal(facts[1].targetUnit, "percent");
assert.equal(facts[1].targetValue, null);      // percent target has no $ value
assert.equal(facts[2].targetUnit, "none");
assert.equal(reduceMeasure(facts, "currency"), 10_000_000); // only the $ target sums

console.log("✅ test-currency-target passed");
