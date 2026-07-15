// Tests for human-readable enum labels (spec 2026-07-14). Offline, no network.
import assert from "node:assert/strict";

(async () => {
  const { courtLevelLabel, COURT_LEVELS } = await import("../src/lib/cases/labels");

  assert.equal(courtLevelLabel("scc"), "Supreme Court of Canada (SCC)");
  assert.equal(courtLevelLabel("fca"), "Federal Court of Appeal (FCA)");
  assert.equal(courtLevelLabel("fc"), "Federal Court (FC)");
  assert.equal(courtLevelLabel("provincial_appeal"), "Provincial Court of Appeal");
  assert.equal(courtLevelLabel("provincial_superior"), "Provincial Superior Court");
  assert.equal(courtLevelLabel("tribunal"), "Tribunal (administrative)");

  // every canonical level has a non-empty label distinct from its raw code
  for (const l of COURT_LEVELS) {
    const label = courtLevelLabel(l);
    assert.ok(label.length > 0, `label for ${l} is empty`);
    assert.notEqual(label, l, `label for ${l} was not humanized`);
  }

  // unknown value falls back to underscore→space (never blank)
  assert.equal(courtLevelLabel("something_else"), "something else");

  console.log("✅ test-cases-labels passed");
})().catch((e) => { console.error(e); process.exit(1); });
