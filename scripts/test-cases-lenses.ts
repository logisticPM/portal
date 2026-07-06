// Audience lens (spec 2026-07-06): resolve/config/reorder/href — all pure.
import assert from "node:assert/strict";

(async () => {
  const { resolveLens, lensConfig, applyLens, lensHref, LENSES } =
    await import("../src/lib/cases/lenses");
  type LC = import("../src/lib/cases/types").LegalCase;

  const mk = (id: string, themes: string[], citingCount: number, level = "provincial_superior"): LC => ({
    id, citation: id, styleOfCause: id, court: level, level: level as LC["level"], year: 2010,
    jurisdiction: "CA", nations: [], themes: themes as LC["themes"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "", holding: "" },
    casesCited: [], casesCiting: [], citingCount, enrichmentLevel: "index", corpusTier: "core",
    fullTextAvailable: true,
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026", unofficial: true },
  });

  assert.equal(resolveLens("legal_advisor", { kind: "company" }), "legal_advisor");
  assert.equal(resolveLens(undefined, { kind: "indigenomics" }), "indigenous_gov");
  assert.equal(resolveLens(undefined, { kind: "company" }), "corporate");
  assert.equal(resolveLens(undefined, { kind: "supplier" }), "corporate");
  assert.equal(resolveLens(undefined, null), "corporate");
  assert.equal(resolveLens("bogus", null), "corporate");
  assert.equal(resolveLens("indigenous_gov", null), "indigenous_gov");

  assert.deepEqual(LENSES, ["indigenous_gov", "legal_advisor", "corporate"]);
  const ig = lensConfig("indigenous_gov");
  assert.ok(ig.label && ig.tagline && Array.isArray(ig.emphasisThemes));
  assert.ok(ig.emphasisThemes.includes("self_determination"));
  assert.equal(lensConfig("legal_advisor").sortByStrength, true);
  assert.deepEqual(lensConfig("legal_advisor").emphasisThemes, []);
  assert.ok(lensConfig("corporate").emphasisThemes.includes("duty_to_consult"));

  const input = [
    mk("a", ["treaty"], 5),
    mk("b", ["self_determination", "land_rights"], 1),
    mk("c", [], 99),
    mk("d", ["resource_revenue"], 2),
  ];
  const out = applyLens(input, "indigenous_gov");
  assert.equal(out.length, input.length);
  assert.deepEqual([...out.map((x) => x.id)].sort(), ["a", "b", "c", "d"]);
  assert.ok(out.findIndex((x) => x.id === "b") < out.findIndex((x) => x.id === "a"));
  assert.ok(out.findIndex((x) => x.id === "d") < out.findIndex((x) => x.id === "c"));
  assert.ok(out.findIndex((x) => x.id === "c") < out.findIndex((x) => x.id === "a"));
  assert.ok(out.findIndex((x) => x.id === "b") < out.findIndex((x) => x.id === "d"));

  const byLevel = [mk("low", ["treaty"], 100, "tribunal"), mk("high", [], 1, "scc")];
  const la = applyLens(byLevel, "legal_advisor");
  assert.equal(la[0].id, "high", "SCC ranks above tribunal regardless of citingCount/theme");

  const before = input.map((x) => x.id).join(",");
  applyLens(input, "corporate");
  assert.equal(input.map((x) => x.id).join(","), before, "input not mutated");

  assert.equal(lensHref({ q: "treaty", tier: "all", theme: "" }, "corporate"),
    "/cases?q=treaty&tier=all&lens=corporate");
  assert.equal(lensHref({ lens: "corporate" }, "legal_advisor"), "/cases?lens=legal_advisor");
  assert.equal(lensHref({}, "indigenous_gov"), "/cases?lens=indigenous_gov");

  // governance invariant holds for edge inputs (never drops/dupes a case)
  assert.deepEqual(applyLens([], "corporate"), []);
  const one = [mk("solo", ["treaty"], 3)];
  assert.deepEqual(applyLens(one, "legal_advisor").map((x) => x.id), ["solo"]);
  // duplicate ids: both survive, length preserved
  const dups = [mk("x", ["treaty"], 1), mk("x", ["land_rights"], 2), mk("y", [], 0)];
  const outDup = applyLens(dups, "indigenous_gov");
  assert.equal(outDup.length, 3);
  assert.deepEqual(outDup.map((c) => c.id).slice().sort(), ["x", "x", "y"]);

  console.log("✅ test-cases-lenses passed");
})().catch((e) => { console.error(e); process.exit(1); });
